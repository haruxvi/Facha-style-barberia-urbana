import { z } from "zod";
import type { AuthContext } from "@/modules/identity";
import { assertCan } from "@/modules/identity";
import { audit } from "@/shared/audit";
import { db } from "@/shared/db";
import { conflict, notFound } from "@/shared/errors";
import { isValidTimeZone, todayIn } from "@/shared/time";
import { parseInput } from "@/shared/validation";

const tz = z.string().refine(isValidTimeZone, "Zona horaria inválida");

export const tenantSettingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  publicPhone: z.string().trim().max(30).optional().nullable(),
  instagram: z.string().trim().max(60).optional().nullable(),
  timezone: tz,
  currency: z.string().trim().length(3).toUpperCase(),
  paymentPolicy: z.enum(["NONE", "OPTIONAL", "DEPOSIT_REQUIRED", "FULL_REQUIRED"]),
  depositAmount: z.coerce.number().int().min(0).max(10_000_000),
  holdMinutes: z.coerce.number().int().min(5).max(120),
  slotIntervalMinutes: z.coerce.number().int().min(5).max(120),
  minNoticeMinutes: z.coerce.number().int().min(0).max(10_080),
  bookingHorizonDays: z.coerce.number().int().min(1).max(365),
  cancellationWindowMinutes: z.coerce.number().int().min(0).max(10_080),
  rescheduleWindowMinutes: z.coerce.number().int().min(0).max(10_080),
  bookingTerms: z.string().trim().max(3000).optional().nullable(),
});

export async function getTenantSettings(ctx: AuthContext) {
  return db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
}

export async function updateTenantSettings(ctx: AuthContext, input: z.input<typeof tenantSettingsSchema>) {
  assertCan(ctx, "settings.manage");
  const data = parseInput(tenantSettingsSchema, input);
  await db.tenant.update({ where: { id: ctx.tenantId }, data });
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "tenant.settings_updated",
    metadata: { paymentPolicy: data.paymentPolicy, depositAmount: data.depositAmount },
  });
}

// ───────────── Sucursales ─────────────

export const branchSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,50}$/, "Usa minúsculas, números y guiones"),
  address: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  timezone: tz,
  active: z.boolean().default(true),
});

export async function listBranches(ctx: AuthContext) {
  return db.branch.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } });
}

export async function saveBranch(ctx: AuthContext, input: z.input<typeof branchSchema>) {
  assertCan(ctx, "branches.manage");
  const data = parseInput(branchSchema, input);
  const dup = await db.branch.findFirst({
    where: { tenantId: ctx.tenantId, slug: data.slug, ...(data.id ? { id: { not: data.id } } : {}) },
  });
  if (dup) throw conflict("Ya existe una sucursal con ese identificador");
  let id = data.id;
  if (id) {
    const r = await db.branch.updateMany({
      where: { id, tenantId: ctx.tenantId },
      data: { ...data, id: undefined },
    });
    if (r.count !== 1) throw notFound("Sucursal");
  } else {
    id = (await db.branch.create({ data: { ...data, tenantId: ctx.tenantId } })).id;
  }
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: data.id ? "branch.updated" : "branch.created",
    entityType: "Branch",
    entityId: id,
  });
  return id;
}

// ───────────── Vista pública (sin login) ─────────────

/** Solo los datos estrictamente necesarios para reservar. Nada de configuración interna ni estadísticas. */
export async function getPublicTenant(slug: string) {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  const tenant = await db.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      description: true,
      publicPhone: true,
      instagram: true,
      logoUrl: true,
      timezone: true,
      currency: true,
      paymentPolicy: true,
      depositAmount: true,
      bookingHorizonDays: true,
      bookingTerms: true,
      cancellationWindowMinutes: true,
      branches: {
        where: { active: true },
        select: { id: true, name: true, address: true, phone: true, timezone: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!tenant || tenant.status !== "ACTIVE") return null;
  const { status: _status, ...publicData } = tenant;
  return publicData;
}

export type PublicTenant = NonNullable<Awaited<ReturnType<typeof getPublicTenant>>>;

/** Cuenta visitas por campaña y día (agregado, sin datos personales). */
export async function recordCampaignVisit(tenantId: string, timezone: string, campaign: string | null) {
  const code = campaign && /^[a-z0-9-]{1,40}$/.test(campaign) ? campaign : "directo";
  const day = todayIn(timezone);
  await db.$executeRaw`
    INSERT INTO "CampaignVisit" ("tenantId", "campaign", "day", "visits") VALUES (${tenantId}::uuid, ${code}, ${day}, 1)
    ON CONFLICT ("tenantId", "campaign", "day") DO UPDATE SET "visits" = "CampaignVisit"."visits" + 1`;
}
