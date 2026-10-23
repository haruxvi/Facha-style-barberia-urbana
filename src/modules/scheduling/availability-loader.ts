import { db, type Tx } from "@/shared/db";
import { addDays, addMinutes, isLocalDate, weekdayOf, zonedToUtc } from "@/shared/time";
import { computeSlots, windowsForDate, type BarberDay, type Slot } from "./availability";

/** Estados que ocupan la agenda (deben coincidir con la restricción de exclusión de la BD). */
export const ACTIVE_STATUSES = ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "COMPLETED"] as const;

export interface AvailabilityInput {
  tenantId: string;
  branchId: string;
  service: { durationMinutes: number; bufferMinutes: number; id: string };
  barberId?: string | null;
  date: string;
  now?: Date;
  /** Al reprogramar, la propia cita no cuenta como ocupada. */
  excludeAppointmentId?: string;
  /** Personal: ignora antelación mínima y horizonte. */
  ignoreBookingWindow?: boolean;
}

export interface AvailabilityResult {
  timezone: string;
  slots: Slot[];
}

/** Carga horarios, excepciones y citas, y calcula los huecos libres de un día. */
export async function loadAvailability(
  input: AvailabilityInput,
  client: Tx = db,
): Promise<AvailabilityResult> {
  const now = input.now ?? new Date();
  const [tenant, branch] = await Promise.all([
    client.tenant.findUniqueOrThrow({ where: { id: input.tenantId } }),
    client.branch.findFirst({ where: { id: input.branchId, tenantId: input.tenantId, active: true } }),
  ]);
  if (!branch || !isLocalDate(input.date)) return { timezone: tenant.timezone, slots: [] };
  const tz = branch.timezone;

  const barbers = await client.barber.findMany({
    where: {
      tenantId: input.tenantId,
      active: true,
      branches: { some: { branchId: branch.id } },
      services: { some: { serviceId: input.service.id } },
      ...(input.barberId ? { id: input.barberId } : {}),
    },
    select: { id: true },
  });
  if (barbers.length === 0) return { timezone: tz, slots: [] };
  const barberIds = barbers.map((b) => b.id);

  const dayStart = zonedToUtc(input.date, 0, tz);
  const dayEnd = zonedToUtc(addDays(input.date, 1), 0, tz);
  // Margen para citas del día anterior cuyo buffer invade este día.
  const searchFrom = addMinutes(dayStart, -12 * 60);

  const [hours, exceptions, appointments] = await Promise.all([
    client.workingHours.findMany({
      where: {
        tenantId: input.tenantId,
        branchId: branch.id,
        barberId: { in: barberIds },
        weekday: weekdayOf(input.date),
      },
    }),
    client.scheduleException.findMany({
      where: {
        tenantId: input.tenantId,
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
        OR: [
          { barberId: { in: barberIds } },
          { barberId: null, OR: [{ branchId: branch.id }, { branchId: null }] },
        ],
      },
    }),
    client.appointment.findMany({
      where: {
        tenantId: input.tenantId,
        barberId: { in: barberIds },
        status: { in: [...ACTIVE_STATUSES] },
        startsAt: { lt: dayEnd, gte: searchFrom },
        ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}),
      },
      select: { barberId: true, startsAt: true, blockedUntil: true, status: true, holdExpiresAt: true },
    }),
  ]);

  const days: BarberDay[] = barberIds.map((barberId) => {
    const windows = windowsForDate(
      input.date,
      tz,
      hours.filter((h) => h.barberId === barberId),
    );
    for (const ex of exceptions) {
      if (ex.type === "EXTRA_HOURS" && ex.barberId === barberId)
        windows.push({ start: ex.startsAt, end: ex.endsAt });
    }
    const blocked = [
      ...exceptions
        .filter((ex) => ex.type === "TIME_OFF" && (ex.barberId === barberId || ex.barberId === null))
        .map((ex) => ({ start: ex.startsAt, end: ex.endsAt })),
      ...appointments
        .filter((a) => a.barberId === barberId)
        // Un hold de pago vencido ya no bloquea (se marcará EXPIRED al reservar o por el cron).
        .filter((a) => !(a.status === "PENDING_PAYMENT" && a.holdExpiresAt && a.holdExpiresAt <= now))
        .map((a) => ({ start: a.startsAt, end: a.blockedUntil })),
    ];
    return { barberId, windows, blocked };
  });

  const slots = computeSlots({
    date: input.date,
    timezone: tz,
    intervalMinutes: tenant.slotIntervalMinutes,
    durationMinutes: input.service.durationMinutes,
    bufferMinutes: input.service.bufferMinutes,
    earliest: input.ignoreBookingWindow ? new Date(0) : addMinutes(now, tenant.minNoticeMinutes),
    latest: input.ignoreBookingWindow
      ? new Date(8.64e15)
      : addMinutes(now, tenant.bookingHorizonDays * 24 * 60),
    barbers: days,
  });
  return { timezone: tz, slots };
}
