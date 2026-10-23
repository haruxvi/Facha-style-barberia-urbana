import { z } from "zod";
import type { Channel, NotificationStatus } from "@/generated/prisma/enums";
import { createManageToken } from "@/modules/booking";
import { hasConsent, unsubscribeUrl } from "@/modules/crm";
import { assertCan, type AuthContext } from "@/modules/identity";
import { enqueueJob, NonRetryableError } from "@/modules/jobs";
import { publicBookingUrl } from "@/modules/tenancy";
import { audit } from "@/shared/audit";
import { sha256 } from "@/shared/crypto";
import { appUrl } from "@/shared/env";
import { db, type Tx } from "@/shared/db";
import { escapeHtml } from "@/shared/html";
import { notFound, validation } from "@/shared/errors";
import { formatMoney } from "@/shared/money";
import { formatDate, formatTime } from "@/shared/time";
import { parseInput } from "@/shared/validation";
import { getEmailProvider, getWhatsAppSender, ProviderError } from "./providers";
import {
  orderedValues,
  renderTemplate,
  textToEmailHtml,
  unknownVariables,
  type TemplateVars,
} from "./templates";

export type Purpose = "TRANSACTIONAL" | "MARKETING" | "INTERNAL";

export interface EnqueueNotificationInput {
  tenantId: string;
  channel: Channel;
  customerId: string | null;
  appointmentId?: string | null;
  trigger: string;
  templateKey?: string | null;
  body?: string;
  subject?: string | null;
  /** Solo para avisos internos (al dueño). Para clientes se toma de su ficha. */
  destination?: string;
  dedupeKey: string;
  scheduledFor?: Date;
  createdById?: string | null;
  purpose: Purpose;
  /** Para recordatorios: si la cita se movió, el mensaje se descarta. */
  expectedStartsAt?: string;
}

const MAX_SEND_ATTEMPTS = 3;

/**
 * Registra una notificación y su trabajo de envío. Idempotente por (tenant, dedupeKey):
 * un reintento del proceso nunca duplica mensajes.
 */
export async function enqueueNotification(tx: Tx, input: EnqueueNotificationInput): Promise<string | null> {
  let destination = input.destination ?? null;
  if (input.customerId) {
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, tenantId: input.tenantId },
    });
    if (!customer || customer.anonymizedAt) return null;
    destination = input.channel === "WHATSAPP" ? customer.phoneE164 : customer.email;
  }
  if (!destination) return null;
  await tx.notification.createMany({
    data: [
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        appointmentId: input.appointmentId ?? null,
        channel: input.channel,
        trigger: input.trigger,
        templateKey: input.templateKey ?? null,
        destination,
        subject: input.subject ?? null,
        body: input.body ?? "",
        dedupeKey: input.dedupeKey,
        scheduledFor: input.scheduledFor ?? new Date(),
        createdById: input.createdById ?? null,
      },
    ],
    skipDuplicates: true,
  });
  const n = await tx.notification.findUniqueOrThrow({
    where: { tenantId_dedupeKey: { tenantId: input.tenantId, dedupeKey: input.dedupeKey } },
  });
  await enqueueJob(tx, {
    type: "notification.send",
    tenantId: input.tenantId,
    payload: {
      notificationId: n.id,
      purpose: input.purpose,
      expectedStartsAt: input.expectedStartsAt ?? null,
    },
    runAt: n.scheduledFor,
    dedupeKey: `notif:${n.id}`,
  });
  return n.id;
}

/** Variables de una cita para las plantillas. Regenera el enlace de gestión (no se guarda en BD). */
export async function buildAppointmentVars(tenantId: string, appointmentId: string): Promise<TemplateVars> {
  const a = await db.appointment.findFirst({
    where: { id: appointmentId, tenantId },
    include: { tenant: true, barber: true, branch: true, customer: true },
  });
  if (!a) return {};
  const tz = a.branch.timezone;
  return {
    customer_name: a.customer.name.split(" ")[0] ?? a.customer.name,
    barbershop_name: a.tenant.name,
    service_name: a.serviceName,
    appointment_date: formatDate(a.startsAt, tz),
    appointment_time: formatTime(a.startsAt, tz),
    barber_name: a.barber.displayName,
    branch_name: a.branch.name,
    branch_address: a.branch.address ?? "",
    management_url: a.manageTokenRevokedAt
      ? ""
      : appUrl(`/reservas/gestionar/${createManageToken(a.id, a.manageTokenVersion)}`),
    booking_url: publicBookingUrl(a.tenant.slug),
    amount_due: formatMoney(a.amountDue, a.currency),
  };
}

/**
 * Comprueba en el momento del envío que el mensaje sigue teniendo sentido:
 * una cita cancelada no recibe recordatorios; una reprogramada no recibe el recordatorio viejo.
 */
async function stillRelevant(
  n: { appointmentId: string | null; trigger: string | null },
  expectedStartsAt: string | null,
): Promise<string | null> {
  if (!n.appointmentId) return null;
  const a = await db.appointment.findUnique({ where: { id: n.appointmentId } });
  if (!a) return "La reserva ya no existe";
  const sameTime = !expectedStartsAt || a.startsAt.toISOString() === expectedStartsAt;
  switch (n.trigger) {
    case "REMINDER":
      if (a.status !== "CONFIRMED") return `Reserva en estado ${a.status}`;
      if (!sameTime) return "La reserva cambió de hora";
      if (a.startsAt <= new Date()) return "La cita ya pasó";
      return null;
    case "BOOKING_CONFIRMED":
      return ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(a.status)
        ? null
        : `Reserva en estado ${a.status}`;
    case "RESCHEDULED":
      return a.status === "CONFIRMED" && sameTime ? null : "La reserva cambió de nuevo";
    case "CANCELLED":
      return a.status === "CANCELLED" ? null : "La reserva ya no está cancelada";
    case "POST_VISIT":
    case "REVIEW_REQUEST":
      return a.status === "COMPLETED" ? null : "La cita no se completó";
    default:
      return null;
  }
}

async function finish(
  id: string,
  status: NotificationStatus,
  data: { error?: string; provider?: string; providerMessageId?: string } = {},
) {
  await db.notification.update({
    where: { id },
    data: {
      status,
      error: data.error?.slice(0, 500) ?? null,
      provider: data.provider,
      providerMessageId: data.providerMessageId,
      ...(status === "SENT" ? { sentAt: new Date() } : {}),
    },
  });
  return status;
}

/**
 * Envía una notificación (handler del trabajo "notification.send").
 * La reclamación QUEUED→SENDING es atómica: dos procesos no pueden enviar el mismo mensaje.
 * Si el proceso muere después de llamar al proveedor, queda en SENDING y NO se reintenta
 * automáticamente (preferimos no duplicar); el panel lo muestra para revisión manual.
 */
export async function sendNotification(
  notificationId: string,
  opts: { purpose: Purpose; expectedStartsAt?: string | null },
): Promise<NotificationStatus> {
  const claimed = await db.notification.updateMany({
    where: { id: notificationId, status: "QUEUED" },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    return (await db.notification.findUnique({ where: { id: notificationId } }))?.status ?? "FAILED";
  }
  const n = await db.notification.findUniqueOrThrow({ where: { id: notificationId } });

  const irrelevant = await stillRelevant(n, opts.expectedStartsAt ?? null);
  if (irrelevant) return finish(n.id, "SKIPPED", { error: irrelevant });

  if (n.customerId && opts.purpose !== "INTERNAL") {
    const ok = await hasConsent(
      n.customerId,
      n.channel,
      opts.purpose === "MARKETING" ? "MARKETING" : "TRANSACTIONAL",
    );
    if (!ok) return finish(n.id, "SKIPPED", { error: "El cliente no tiene consentimiento para este canal" });
  }

  // Render en el momento del envío: refleja los datos actuales de la cita.
  let body = n.body;
  let subject = n.subject;
  let waTemplate: { name: string; language: string; params: string[] } | null = null;
  if (n.templateKey) {
    const tpl = await db.messageTemplate.findUnique({
      where: { tenantId_key_channel: { tenantId: n.tenantId, key: n.templateKey, channel: n.channel } },
    });
    if (!tpl || !tpl.active) return finish(n.id, "SKIPPED", { error: "Plantilla inexistente o inactiva" });
    const vars = n.appointmentId ? await buildAppointmentVars(n.tenantId, n.appointmentId) : {};
    body = renderTemplate(tpl.body, vars, "text");
    subject = tpl.subject ? renderTemplate(tpl.subject, vars, "text") : subject;
    if (n.channel === "WHATSAPP" && tpl.waTemplateName) {
      waTemplate = {
        name: tpl.waTemplateName,
        language: tpl.waLanguage ?? "es",
        params: orderedValues(tpl.body, vars),
      };
    }
    await db.notification.update({ where: { id: n.id }, data: { body, subject } });
  }

  try {
    let result: { providerMessageId: string };
    let providerName: string;
    if (n.channel === "EMAIL") {
      const provider = getEmailProvider();
      providerName = provider.name;
      const footer =
        n.customerId && opts.purpose !== "INTERNAL"
          ? `<p style="font-size:12px;color:#666;margin-top:24px">¿No quieres recibir más correos? <a href="${unsubscribeUrl(n.customerId)}">Darse de baja</a></p>`
          : "";
      result = await provider.send({
        to: n.destination,
        subject: subject ?? "Mensaje de tu barbería",
        text: body,
        // El cuerpo ya está renderizado: se escapa completo para que ningún valor inyecte HTML.
        html: textToEmailHtml(escapeHtml(body), footer),
        idempotencyKey: n.id,
      });
    } else {
      const sender = await getWhatsAppSender(n.tenantId);
      providerName = sender.name;
      if (waTemplate) {
        result = await sender.sendTemplate(
          n.destination,
          waTemplate.name,
          waTemplate.language,
          waTemplate.params,
        );
      } else {
        // Fuera de la ventana de 24 h Meta exige una plantilla aprobada.
        if (!sender.simulated) {
          const conv = await db.conversation.findUnique({
            where: { tenantId_waPhone: { tenantId: n.tenantId, waPhone: n.destination } },
          });
          const open = conv?.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < 24 * 3600 * 1000;
          if (!open) {
            return finish(n.id, "FAILED", {
              error:
                "Fuera de la ventana de 24 h de WhatsApp: configura una plantilla aprobada por Meta para este mensaje",
            });
          }
        }
        result = await sender.sendText(n.destination, body);
      }
    }
    return finish(n.id, "SENT", { provider: providerName, providerMessageId: result.providerMessageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ProviderError && err.retryable && n.attempts < MAX_SEND_ATTEMPTS) {
      await db.notification.update({
        where: { id: n.id },
        data: { status: "QUEUED", error: message.slice(0, 500) },
      });
      throw err; // la cola reintenta con backoff
    }
    await finish(n.id, "FAILED", { error: message });
    if (err instanceof ProviderError) return "FAILED";
    throw new NonRetryableError(message);
  }
}

/** Estados de entrega informados por el proveedor. Nunca retrocede (SENT → DELIVERED → READ). */
export async function applyDeliveryStatus(
  providerMessageId: string,
  status: "SENT" | "DELIVERED" | "READ" | "FAILED",
  error?: string,
) {
  const order: NotificationStatus[] = ["QUEUED", "SENDING", "SENT", "DELIVERED", "READ"];
  const n = await db.notification.findFirst({ where: { providerMessageId } });
  if (!n) return;
  if (status === "FAILED") {
    await db.notification.update({
      where: { id: n.id },
      data: { status: "FAILED", error: error?.slice(0, 500) ?? "Fallo de entrega" },
    });
    return;
  }
  if (order.indexOf(status) <= order.indexOf(n.status)) return;
  await db.notification.update({
    where: { id: n.id },
    data: { status, ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}) },
  });
}

// ───────────── Envío manual desde el panel ─────────────

const manualSchema = z.object({
  customerId: z.uuid(),
  appointmentId: z.uuid().optional().nullable(),
  channel: z.enum(["WHATSAPP", "EMAIL"]),
  subject: z.string().trim().max(150).optional().nullable(),
  body: z.string().trim().min(1, "Escribe un mensaje").max(2000),
});

export async function sendManualMessage(ctx: AuthContext, input: z.input<typeof manualSchema>) {
  assertCan(ctx, "messages.send");
  const data = parseInput(manualSchema, input);
  const bad = unknownVariables(data.body);
  if (bad.length) throw validation(`Variables no permitidas: ${bad.join(", ")}`);
  // Aislamiento: cliente y reserva deben pertenecer a la barbería activa.
  const customer = await db.customer.findFirst({ where: { id: data.customerId, tenantId: ctx.tenantId } });
  if (!customer) throw notFound("Cliente");
  if (data.appointmentId) {
    const a = await db.appointment.findFirst({
      where: { id: data.appointmentId, tenantId: ctx.tenantId, customerId: customer.id },
    });
    if (!a) throw notFound("Reserva");
  }
  if (data.channel === "EMAIL" && !customer.email) throw validation("El cliente no tiene correo registrado");
  const vars = data.appointmentId
    ? await buildAppointmentVars(ctx.tenantId, data.appointmentId)
    : { customer_name: customer.name };
  const body = renderTemplate(data.body, vars, "text");
  // Doble clic / reenvío del formulario en el mismo minuto = mismo mensaje.
  const minute = Math.floor(Date.now() / 60000);
  const dedupeKey = `manual:${sha256(`${ctx.userId}:${customer.id}:${data.channel}:${body}:${minute}`)}`;
  const id = await db.$transaction((tx) =>
    enqueueNotification(tx, {
      tenantId: ctx.tenantId,
      channel: data.channel,
      customerId: customer.id,
      appointmentId: data.appointmentId ?? null,
      trigger: "manual",
      body,
      subject: data.subject ?? `Mensaje de ${ctx.tenantName}`,
      dedupeKey,
      createdById: ctx.userId,
      purpose: "TRANSACTIONAL",
    }),
  );
  if (!id) throw validation("El cliente no tiene un destino para ese canal");
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "message.manual_sent",
    entityType: "Notification",
    entityId: id,
    metadata: { channel: data.channel },
  });
  let status: NotificationStatus;
  try {
    status = await sendNotification(id, { purpose: "TRANSACTIONAL" });
  } catch {
    status = "QUEUED"; // reintento automático por la cola
  }
  return { id, status };
}

/** Reintento manual de una notificación fallida (crea un intento nuevo, no reenvía a ciegas). */
export async function retryNotification(ctx: AuthContext, notificationId: string) {
  assertCan(ctx, "messages.send");
  const n = await db.notification.findFirst({ where: { id: notificationId, tenantId: ctx.tenantId } });
  if (!n) throw notFound("Mensaje");
  if (n.status !== "FAILED") throw validation("Solo se pueden reintentar mensajes fallidos");
  await db.notification.update({ where: { id: n.id }, data: { status: "QUEUED", error: null } });
  try {
    return await sendNotification(n.id, {
      purpose: n.trigger === "INACTIVE_FOLLOWUP" ? "MARKETING" : "TRANSACTIONAL",
    });
  } catch {
    return "QUEUED" as const;
  }
}

export async function listNotifications(
  ctx: AuthContext,
  opts: { status?: NotificationStatus; take?: number } = {},
) {
  assertCan(ctx, "messages.send");
  return db.notification.findMany({
    where: { tenantId: ctx.tenantId, ...(opts.status ? { status: opts.status } : {}) },
    include: { customer: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 100,
  });
}
