import { z } from "zod";
import { assertCan, type AuthContext } from "@/modules/identity";
import { audit } from "@/shared/audit";
import { db } from "@/shared/db";
import { notFound, validation } from "@/shared/errors";
import { parseInput } from "@/shared/validation";

// ───────────── Servicios ─────────────

export const serviceSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  priceAmount: z.coerce.number().int().min(0).max(10_000_000),
  durationMinutes: z.coerce.number().int().min(5).max(720),
  bufferMinutes: z.coerce.number().int().min(0).max(240).default(0),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
  branchIds: z.array(z.uuid()).default([]),
  barberIds: z.array(z.uuid()).default([]),
});

export async function listServices(ctx: AuthContext) {
  return db.service.findMany({
    where: { tenantId: ctx.tenantId },
    include: { branches: true, barbers: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

async function assertOwnedIds(tenantId: string, branchIds: string[], barberIds: string[]) {
  if (branchIds.length) {
    const n = await db.branch.count({ where: { tenantId, id: { in: branchIds } } });
    if (n !== new Set(branchIds).size) throw validation("Sucursal inválida");
  }
  if (barberIds.length) {
    const n = await db.barber.count({ where: { tenantId, id: { in: barberIds } } });
    if (n !== new Set(barberIds).size) throw validation("Barbero inválido");
  }
}

export async function saveService(ctx: AuthContext, input: z.input<typeof serviceSchema>): Promise<string> {
  assertCan(ctx, "catalog.manage");
  const { branchIds, barberIds, id, ...data } = parseInput(serviceSchema, input);
  await assertOwnedIds(ctx.tenantId, branchIds, barberIds);
  const serviceId = await db.$transaction(async (tx) => {
    let sid = id;
    if (sid) {
      const r = await tx.service.updateMany({ where: { id: sid, tenantId: ctx.tenantId }, data });
      if (r.count !== 1) throw notFound("Servicio");
    } else {
      sid = (await tx.service.create({ data: { ...data, tenantId: ctx.tenantId } })).id;
    }
    await tx.serviceBranch.deleteMany({
      where: { tenantId: ctx.tenantId, serviceId: sid, branchId: { notIn: branchIds } },
    });
    await tx.serviceBranch.createMany({
      data: branchIds.map((branchId) => ({ tenantId: ctx.tenantId, serviceId: sid!, branchId })),
      skipDuplicates: true,
    });
    await tx.barberService.deleteMany({
      where: { tenantId: ctx.tenantId, serviceId: sid, barberId: { notIn: barberIds } },
    });
    await tx.barberService.createMany({
      data: barberIds.map((barberId) => ({ tenantId: ctx.tenantId, serviceId: sid!, barberId })),
      skipDuplicates: true,
    });
    return sid;
  });
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: id ? "service.updated" : "service.created",
    entityType: "Service",
    entityId: serviceId,
    metadata: { priceAmount: data.priceAmount, durationMinutes: data.durationMinutes },
  });
  return serviceId;
}

// ───────────── Barberos ─────────────

export const barberSchema = z.object({
  id: z.uuid().optional(),
  displayName: z.string().trim().min(2).max(60),
  bio: z.string().trim().max(400).optional().nullable(),
  photoUrl: z
    .url()
    .max(500)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  active: z.boolean().default(true),
  commissionBps: z.coerce.number().int().min(0).max(10_000).default(0),
  sortOrder: z.coerce.number().int().default(0),
  branchIds: z.array(z.uuid()).default([]),
  serviceIds: z.array(z.uuid()).default([]),
});

export async function listBarbers(ctx: AuthContext) {
  return db.barber.findMany({
    where: { tenantId: ctx.tenantId },
    include: {
      branches: true,
      services: true,
      membership: { include: { user: { select: { email: true } } } },
    },
    orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
  });
}

export async function getBarber(ctx: AuthContext, barberId: string) {
  const barber = await db.barber.findFirst({
    where: { id: barberId, tenantId: ctx.tenantId },
    include: { branches: { include: { branch: true } }, services: true },
  });
  if (!barber) throw notFound("Barbero");
  return barber;
}

export async function saveBarber(ctx: AuthContext, input: z.input<typeof barberSchema>): Promise<string> {
  assertCan(ctx, "barbers.manage");
  const { branchIds, serviceIds, id, ...data } = parseInput(barberSchema, input);
  await assertOwnedIds(ctx.tenantId, branchIds, []);
  if (serviceIds.length) {
    const n = await db.service.count({ where: { tenantId: ctx.tenantId, id: { in: serviceIds } } });
    if (n !== new Set(serviceIds).size) throw validation("Servicio inválido");
  }
  const barberId = await db.$transaction(async (tx) => {
    let bid = id;
    if (bid) {
      const r = await tx.barber.updateMany({ where: { id: bid, tenantId: ctx.tenantId }, data });
      if (r.count !== 1) throw notFound("Barbero");
    } else {
      bid = (await tx.barber.create({ data: { ...data, tenantId: ctx.tenantId } })).id;
    }
    await tx.barberBranch.deleteMany({
      where: { tenantId: ctx.tenantId, barberId: bid, branchId: { notIn: branchIds } },
    });
    await tx.barberBranch.createMany({
      data: branchIds.map((branchId) => ({ tenantId: ctx.tenantId, barberId: bid!, branchId })),
      skipDuplicates: true,
    });
    await tx.barberService.deleteMany({
      where: { tenantId: ctx.tenantId, barberId: bid, serviceId: { notIn: serviceIds } },
    });
    await tx.barberService.createMany({
      data: serviceIds.map((serviceId) => ({ tenantId: ctx.tenantId, barberId: bid!, serviceId })),
      skipDuplicates: true,
    });
    return bid;
  });
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: id ? "barber.updated" : "barber.created",
    entityType: "Barber",
    entityId: barberId,
  });
  return barberId;
}

/** El barbero edita su propio perfil público (portal del barbero). */
export async function updateOwnBarberProfile(
  ctx: AuthContext,
  input: { bio?: string | null; photoUrl?: string | null },
) {
  if (!ctx.barberId) throw notFound("Perfil de barbero");
  const data = parseInput(barberSchema.pick({ bio: true, photoUrl: true }), input);
  await db.barber.updateMany({ where: { id: ctx.barberId, tenantId: ctx.tenantId }, data });
}

// ───────────── Catálogo público ─────────────

/** Servicios activos ofrecidos en una sucursal, con el precio efectivo. */
export async function listPublicServices(tenantId: string, branchId: string) {
  const rows = await db.serviceBranch.findMany({
    where: { tenantId, branchId, active: true, service: { active: true } },
    include: { service: true },
  });
  return rows
    .map((r) => ({
      id: r.service.id,
      name: r.service.name,
      description: r.service.description,
      durationMinutes: r.service.durationMinutes,
      priceAmount: r.priceOverride ?? r.service.priceAmount,
      sortOrder: r.service.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(({ sortOrder: _s, ...rest }) => rest);
}

/** Barberos activos que trabajan en la sucursal y realizan el servicio. */
export async function listPublicBarbers(tenantId: string, branchId: string, serviceId?: string) {
  const barbers = await db.barber.findMany({
    where: {
      tenantId,
      active: true,
      branches: { some: { branchId } },
      ...(serviceId ? { services: { some: { serviceId } } } : {}),
    },
    select: { id: true, displayName: true, bio: true, photoUrl: true },
    orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
  });
  return barbers;
}

/** Servicio + precio efectivo en la sucursal. Lo usa el motor de reservas: el precio lo decide el servidor. */
export async function getBookableService(tenantId: string, branchId: string, serviceId: string) {
  const row = await db.serviceBranch.findFirst({
    where: { tenantId, branchId, serviceId, active: true, service: { active: true } },
    include: { service: true },
  });
  if (!row) return null;
  return { ...row.service, priceAmount: row.priceOverride ?? row.service.priceAmount };
}
