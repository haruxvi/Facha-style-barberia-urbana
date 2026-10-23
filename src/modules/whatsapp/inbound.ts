import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { assertCan, type AuthContext } from "@/modules/identity";
import { enqueueJob } from "@/modules/jobs";
import { applyDeliveryStatus, getWhatsAppSender } from "@/modules/messaging";
import { findTenantByWhatsappNumber } from "@/modules/tenancy";
import { audit } from "@/shared/audit";
import { db, isUniqueViolation } from "@/shared/db";
import { notFound, policy } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { waIdToE164 } from "@/shared/phone";
import { parseInput } from "@/shared/validation";
import { handleBotMessage, type BotContext, type BotPorts, type BotState } from "./bot";
import { parseWebhookPayload, verifySignature } from "./webhook";

export type BotPortsFactory = (args: {
  tenantId: string;
  waPhone: string;
  conversationId: string;
}) => Promise<BotPorts>;

/**
 * Recibe el webhook POST: valida la firma, identifica la barbería por el número receptor,
 * guarda los mensajes de forma idempotente (el id de Meta es único) y encola su procesamiento.
 * Debe responder rápido: el procesamiento del bot ocurre después (after() / cola).
 */
export async function ingestWhatsAppWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<{ ok: boolean; inbound: string[] }> {
  if (!verifySignature(rawBody, signatureHeader)) {
    logger.warn("whatsapp.invalid_signature");
    return { ok: false, inbound: [] };
  }
  const { messages, statuses } = parseWebhookPayload(rawBody);
  const inbound: string[] = [];

  for (const m of messages) {
    const tenantId = await findTenantByWhatsappNumber(m.phoneNumberId);
    if (!tenantId) {
      logger.warn("whatsapp.unknown_number", { phoneNumberId: m.phoneNumberId });
      continue;
    }
    const waPhone = waIdToE164(m.from);
    if (!waPhone) continue;
    const at = m.timestamp ? new Date(m.timestamp * 1000) : new Date();
    const conversation = await db.conversation.upsert({
      where: { tenantId_waPhone: { tenantId, waPhone } },
      create: { tenantId, waPhone, lastInboundAt: at },
      update: { lastInboundAt: at },
    });
    try {
      const saved = await db.conversationMessage.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          direction: "INBOUND",
          providerMessageId: m.id,
          type: m.type,
          body: m.text || `[${m.type}]`,
          status: "received",
        },
      });
      await enqueueJob(db, {
        type: "whatsapp.inbound",
        tenantId,
        payload: { messageId: saved.id },
        dedupeKey: `wa-in:${m.id}`,
      });
      inbound.push(saved.id);
    } catch (err) {
      if (isUniqueViolation(err)) continue; // Meta reenvió un mensaje ya recibido
      throw err;
    }
  }

  for (const s of statuses) {
    const map = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as const;
    const status = map[s.status as keyof typeof map];
    if (status) await applyDeliveryStatus(s.id, status, s.error ?? undefined);
    await db.conversationMessage.updateMany({
      where: { providerMessageId: s.id },
      data: { status: s.status },
    });
  }
  return { ok: true, inbound };
}

/** Procesa un mensaje entrante con el bot. Idempotente: reclama el mensaje antes de responder. */
export async function processInboundMessage(messageId: string, portsFactory: BotPortsFactory): Promise<void> {
  const claimed = await db.conversationMessage.updateMany({
    where: { id: messageId, status: "received" },
    data: { status: "processing" },
  });
  if (claimed.count !== 1) return;
  const msg = await db.conversationMessage.findUniqueOrThrow({
    where: { id: messageId },
    include: { conversation: true },
  });
  const conv = msg.conversation;

  if (conv.handoff) {
    await db.conversationMessage.update({ where: { id: msg.id }, data: { status: "handoff" } });
    return; // una persona del equipo atiende esta conversación
  }

  const ports = await portsFactory({
    tenantId: conv.tenantId,
    waPhone: conv.waPhone,
    conversationId: conv.id,
  });
  const result = await handleBotMessage(conv.state as BotState, conv.context as BotContext, msg.body, ports);

  await db.conversation.update({
    where: { id: conv.id },
    data: {
      state: result.state,
      context: result.context as Prisma.InputJsonValue,
      ...(result.handoff ? { handoff: true } : {}),
    },
  });

  const sender = await getWhatsAppSender(conv.tenantId);
  for (const reply of result.replies) {
    // Respuesta dentro de la ventana de 24 h abierta por el cliente: texto libre permitido.
    const sent = await sender.sendText(conv.waPhone, reply);
    await db.conversationMessage.create({
      data: {
        tenantId: conv.tenantId,
        conversationId: conv.id,
        direction: "OUTBOUND",
        providerMessageId: sent.providerMessageId,
        body: reply,
        status: "sent",
      },
    });
  }
  await db.conversationMessage.update({ where: { id: msg.id }, data: { status: "processed" } });
}

// ───────────── Bandeja de conversaciones (panel) ─────────────

export async function listConversations(ctx: AuthContext) {
  assertCan(ctx, "messages.send");
  return db.conversation.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ handoff: "desc" }, { updatedAt: "desc" }],
    take: 50,
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}

export async function getConversation(ctx: AuthContext, conversationId: string) {
  assertCan(ctx, "messages.send");
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, tenantId: ctx.tenantId },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  if (!conv) throw notFound("Conversación");
  return conv;
}

const replySchema = z.object({ body: z.string().trim().min(1).max(2000) });

export async function replyToConversation(
  ctx: AuthContext,
  conversationId: string,
  input: z.input<typeof replySchema>,
) {
  assertCan(ctx, "messages.send");
  const { body } = parseInput(replySchema, input);
  const conv = await db.conversation.findFirst({ where: { id: conversationId, tenantId: ctx.tenantId } });
  if (!conv) throw notFound("Conversación");
  if (!conv.lastInboundAt || Date.now() - conv.lastInboundAt.getTime() > 24 * 3600 * 1000) {
    throw policy(
      "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp exige usar una plantilla aprobada",
    );
  }
  const sender = await getWhatsAppSender(ctx.tenantId);
  const sent = await sender.sendText(conv.waPhone, body);
  await db.conversationMessage.create({
    data: {
      tenantId: ctx.tenantId,
      conversationId: conv.id,
      direction: "OUTBOUND",
      providerMessageId: sent.providerMessageId,
      body,
      status: "sent",
    },
  });
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "whatsapp.staff_reply",
    entityType: "Conversation",
    entityId: conv.id,
  });
}

/** Devuelve la conversación al bot. */
export async function resolveHandoff(ctx: AuthContext, conversationId: string) {
  assertCan(ctx, "messages.send");
  const r = await db.conversation.updateMany({
    where: { id: conversationId, tenantId: ctx.tenantId },
    data: { handoff: false, state: "idle", context: {} },
  });
  if (r.count !== 1) throw notFound("Conversación");
}
