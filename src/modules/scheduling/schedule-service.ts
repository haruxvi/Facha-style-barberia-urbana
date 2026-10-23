import { z } from "zod";
import { assertCan, can, type AuthContext } from "@/modules/identity";
import { audit } from "@/shared/audit";
import { db } from "@/shared/db";
import { forbidden, notFound, validation } from "@/shared/errors";
import { hhmmToMinutes, zonedToUtc } from "@/shared/time";
import { parseInput } from "@/shared/validation";

const rowSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  start: z.string(),
  end: z.string(),
});

export async function getWeeklyHours(ctx: AuthContext, barberId: string) {
  return db.workingHours.findMany({
    where: { tenantId: ctx.tenantId, barberId },
    orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
  });
}

/**
 * Reemplaza el horario semanal de un barbero en una sucursal.
 * Varias franjas por día = pausas. Valida que no se crucen entre sí ni con otra sucursal.
 */
export async function setWeeklyHours(
  ctx: AuthContext,
  barberId: string,
  branchId: string,
  rawRows: z.input<typeof rowSchema>[],
): Promise<void> {
  assertCan(ctx, "barbers.manage");
  const link = await db.barberBranch.findFirst({ where: { tenantId: ctx.tenantId, barberId, branchId } });
  if (!link) throw validation("El barbero no está asignado a esa sucursal");
  const rows = rawRows.map((r) => {
    const p = parseInput(rowSchema, r);
    let startMinute: number;
    let endMinute: number;
    try {
      startMinute = hhmmToMinutes(p.start);
      endMinute = hhmmToMinutes(p.end);
    } catch {
      throw validation("Formato de hora inválido (usa HH:MM)");
    }
    if (startMinute >= endMinute) throw validation("La hora de inicio debe ser anterior a la de término");
    return { weekday: p.weekday, startMinute, endMinute };
  });
  const others = await db.workingHours.findMany({
    where: { tenantId: ctx.tenantId, barberId, branchId: { not: branchId } },
  });
  const all = [...rows, ...others];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
        throw validation("Hay franjas horarias que se cruzan (revisa también otras sucursales)");
      }
    }
  }
  await db.$transaction([
    db.workingHours.deleteMany({ where: { tenantId: ctx.tenantId, barberId, branchId } }),
    db.workingHours.createMany({
      data: rows.map((r) => ({ ...r, tenantId: ctx.tenantId, barberId, branchId })),
    }),
  ]);
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "schedule.hours_updated",
    entityType: "Barber",
    entityId: barberId,
  });
}

const exceptionSchema = z.object({
  barberId: z.uuid().nullable(),
  branchId: z.uuid().nullable(),
  type: z.enum(["TIME_OFF", "EXTRA_HOURS"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  start: z.string().default("00:00"),
  end: z.string().default("24:00"),
  reason: z.string().trim().max(200).optional().nullable(),
});

/** Vacaciones, ausencias, bloqueos manuales u horas extra. Fechas/horas en la zona de la sucursal. */
export async function addScheduleException(ctx: AuthContext, input: z.input<typeof exceptionSchema>) {
  const data = parseInput(exceptionSchema, input);
  const isOwn = data.barberId !== null && data.barberId === ctx.barberId;
  if (!can(ctx.role, "barbers.manage") && !(isOwn && data.type === "TIME_OFF")) throw forbidden();
  if (data.barberId) {
    const b = await db.barber.findFirst({ where: { id: data.barberId, tenantId: ctx.tenantId } });
    if (!b) throw notFound("Barbero");
  }
  let tz = (await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } })).timezone;
  if (data.branchId) {
    const br = await db.branch.findFirst({ where: { id: data.branchId, tenantId: ctx.tenantId } });
    if (!br) throw notFound("Sucursal");
    tz = br.timezone;
  }
  let startsAt: Date;
  let endsAt: Date;
  try {
    startsAt = zonedToUtc(data.date, hhmmToMinutes(data.start), tz);
    endsAt = zonedToUtc(data.endDate ?? data.date, hhmmToMinutes(data.end), tz);
  } catch {
    throw validation("Fecha u hora inválida");
  }
  if (startsAt >= endsAt) throw validation("El término debe ser posterior al inicio");
  const created = await db.scheduleException.create({
    data: {
      tenantId: ctx.tenantId,
      barberId: data.barberId,
      branchId: data.branchId,
      type: data.type,
      startsAt,
      endsAt,
      reason: data.reason,
      createdById: ctx.userId,
    },
  });
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "schedule.exception_added",
    entityType: "ScheduleException",
    entityId: created.id,
  });
  return created.id;
}

export async function listScheduleExceptions(ctx: AuthContext, opts: { from: Date; barberId?: string }) {
  return db.scheduleException.findMany({
    where: {
      tenantId: ctx.tenantId,
      endsAt: { gte: opts.from },
      ...(opts.barberId ? { barberId: opts.barberId } : {}),
    },
    include: { barber: { select: { displayName: true } }, branch: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
    take: 200,
  });
}

export async function removeScheduleException(ctx: AuthContext, id: string) {
  const ex = await db.scheduleException.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!ex) throw notFound("Excepción");
  if (!can(ctx.role, "barbers.manage") && !(ex.barberId && ex.barberId === ctx.barberId)) throw forbidden();
  await db.scheduleException.delete({ where: { id } });
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "schedule.exception_removed",
    entityType: "ScheduleException",
    entityId: id,
  });
}
