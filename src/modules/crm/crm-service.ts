import { z } from "zod";
import type { Channel, ConsentPurpose } from "@/generated/prisma/enums";
import { assertCan, type AuthContext } from "@/modules/identity";
import { audit, type Actor } from "@/shared/audit";
import { deriveKey, hmacSha256, safeEqual } from "@/shared/crypto";
import { db, type Tx } from "@/shared/db";
import { appUrl, env } from "@/shared/env";
import { notFound } from "@/shared/errors";
import { parseInput } from "@/shared/validation";

export async function listCustomers(ctx: AuthContext, opts: { q?: string; take?: number } = {}) {
  assertCan(ctx, "customers.view");
  const q = opts.q?.trim();
  return db.customer.findMany({
    where: {
      tenantId: ctx.tenantId,
      anonymizedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { phoneE164: { contains: q.replace(/[^\d+]/g, "") || q } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: opts.take ?? 100,
  });
}

export async function getCustomerDetail(ctx: AuthContext, customerId: string) {
  assertCan(ctx, "customers.view");
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId: ctx.tenantId },
    include: {
      consents: true,
      appointments: {
        orderBy: { startsAt: "desc" },
        take: 50,
        include: { barber: { select: { displayName: true } } },
      },
      notifications: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!customer) throw notFound("Cliente");
  const visits = customer.appointments.filter((a) => a.status === "COMPLETED");
  let avgDaysBetween: number | null = null;
  if (visits.length >= 2) {
    const first = visits.at(-1)!.startsAt.getTime();
    const last = visits[0]!.startsAt.getTime();
    avgDaysBetween = Math.round((last - first) / 86400000 / (visits.length - 1));
  }
  return { ...customer, stats: { completed: visits.length, avgDaysBetween } };
}

const customerUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z
    .union([z.email(), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null)),
  notes: z.string().trim().max(2000).optional().nullable(),
  preferences: z.string().trim().max(1000).optional().nullable(),
});

export async function updateCustomer(
  ctx: AuthContext,
  customerId: string,
  input: z.input<typeof customerUpdateSchema>,
) {
  assertCan(ctx, "customers.manage");
  const data = parseInput(customerUpdateSchema, input);
  const r = await db.customer.updateMany({ where: { id: customerId, tenantId: ctx.tenantId }, data });
  if (r.count !== 1) throw notFound("Cliente");
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "customer.updated",
    entityType: "Customer",
    entityId: customerId,
  });
}

// ───────────── Consentimientos ─────────────

export async function hasConsent(
  customerId: string,
  channel: Channel,
  purpose: ConsentPurpose,
  client: Tx = db,
): Promise<boolean> {
  const c = await client.communicationConsent.findUnique({
    where: { customerId_channel_purpose: { customerId, channel, purpose } },
  });
  return !!c?.granted;
}

export async function setConsent(
  tenantId: string,
  customerId: string,
  channel: Channel,
  purpose: ConsentPurpose,
  granted: boolean,
  source: string,
  actor: Actor,
): Promise<void> {
  const customer = await db.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) throw notFound("Cliente");
  await db.communicationConsent.upsert({
    where: { customerId_channel_purpose: { customerId, channel, purpose } },
    create: { tenantId, customerId, channel, purpose, granted, source },
    update: { granted, source },
  });
  // Historial del consentimiento en la auditoría (prueba de cuándo y cómo se otorgó/revocó).
  await audit({
    tenantId,
    actor,
    action: granted ? "consent.granted" : "consent.revoked",
    entityType: "Customer",
    entityId: customerId,
    metadata: { channel, purpose, source },
  });
}

export async function setConsentAsStaff(
  ctx: AuthContext,
  customerId: string,
  channel: Channel,
  purpose: ConsentPurpose,
  granted: boolean,
) {
  assertCan(ctx, "customers.manage");
  await setConsent(ctx.tenantId, customerId, channel, purpose, granted, "admin", {
    type: "STAFF",
    userId: ctx.userId,
  });
}

/** Revoca todas las comunicaciones de WhatsApp de un número (p. ej. escribió "BAJA"). */
export async function revokeWhatsAppConsentByPhone(tenantId: string, phoneE164: string): Promise<boolean> {
  const customer = await db.customer.findUnique({ where: { tenantId_phoneE164: { tenantId, phoneE164 } } });
  if (!customer) return false;
  for (const purpose of ["TRANSACTIONAL", "MARKETING"] as const) {
    await setConsent(tenantId, customer.id, "WHATSAPP", purpose, false, "whatsapp", { type: "CUSTOMER" });
  }
  return true;
}

// ── Enlace de baja de correo (sin login): HMAC de (cliente, canal) ──

function unsubscribeKey() {
  return deriveKey(env().SESSION_SECRET, "unsubscribe");
}

export function unsubscribeUrl(customerId: string): string {
  const sig = hmacSha256(unsubscribeKey(), `${customerId}:EMAIL`, "base64url").slice(0, 32);
  return appUrl(`/baja/${customerId}.${sig}`);
}

export async function unsubscribeByToken(token: string): Promise<boolean> {
  const [customerId, sig] = token.split(".");
  if (!customerId || !sig || !/^[0-9a-f-]{36}$/.test(customerId)) return false;
  const expected = hmacSha256(unsubscribeKey(), `${customerId}:EMAIL`, "base64url").slice(0, 32);
  if (!safeEqual(sig, expected)) return false;
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return false;
  for (const purpose of ["TRANSACTIONAL", "MARKETING"] as const) {
    await setConsent(customer.tenantId, customer.id, "EMAIL", purpose, false, "unsubscribe_link", {
      type: "CUSTOMER",
    });
  }
  return true;
}

// ───────────── Derechos sobre los datos ─────────────

/** Exporta los datos de un cliente (derecho de acceso/portabilidad). */
export async function exportCustomerData(ctx: AuthContext, customerId: string) {
  assertCan(ctx, "customers.manage");
  const data = await db.customer.findFirst({
    where: { id: customerId, tenantId: ctx.tenantId },
    include: {
      consents: true,
      appointments: {
        select: {
          id: true,
          startsAt: true,
          status: true,
          serviceName: true,
          priceAmount: true,
          currency: true,
          source: true,
        },
      },
      notifications: { select: { channel: true, status: true, createdAt: true, trigger: true } },
    },
  });
  if (!data) throw notFound("Cliente");
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "customer.exported",
    entityType: "Customer",
    entityId: customerId,
  });
  return data;
}

/**
 * Anonimiza un cliente (derecho de supresión) conservando las citas para la contabilidad,
 * pero sin datos que identifiquen a la persona.
 */
export async function anonymizeCustomer(ctx: AuthContext, customerId: string) {
  assertCan(ctx, "customers.manage");
  const customer = await db.customer.findFirst({ where: { id: customerId, tenantId: ctx.tenantId } });
  if (!customer) throw notFound("Cliente");
  await db.$transaction([
    db.customer.update({
      where: { id: customerId },
      data: {
        name: "Cliente anonimizado",
        phoneE164: `anon-${customerId}`,
        email: null,
        notes: null,
        preferences: null,
        anonymizedAt: new Date(),
      },
    }),
    db.communicationConsent.deleteMany({ where: { customerId } }),
    db.notification.updateMany({
      where: { customerId },
      data: { destination: "[anonimizado]", body: "[anonimizado]" },
    }),
    db.conversation.deleteMany({ where: { tenantId: ctx.tenantId, waPhone: customer.phoneE164 } }),
  ]);
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "customer.anonymized",
    entityType: "Customer",
    entityId: customerId,
  });
}
