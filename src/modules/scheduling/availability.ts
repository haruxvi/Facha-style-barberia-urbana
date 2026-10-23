import { addMinutes, zonedToUtc } from "@/shared/time";

/**
 * Cálculo de disponibilidad (función pura, sin BD).
 * - Las horas candidatas se generan en hora LOCAL alineadas al intervalo (10:00, 10:15…), y se
 *   convierten a instantes con la zona de la sucursal (correcto en cambios de horario de verano).
 * - Un hueco es válido si [inicio, inicio+duración) cabe en una ventana laboral y
 *   [inicio, inicio+duración+buffer) no se cruza con nada bloqueado (citas, ausencias, bloqueos).
 */

export interface Interval {
  start: Date;
  end: Date;
}

export interface BarberDay {
  barberId: string;
  windows: Interval[];
  blocked: Interval[];
}

export interface SlotQuery {
  date: string; // YYYY-MM-DD local
  timezone: string;
  intervalMinutes: number;
  durationMinutes: number;
  bufferMinutes: number;
  earliest: Date; // ahora + antelación mínima
  latest: Date; // ahora + horizonte de reservas
  barbers: BarberDay[];
}

export interface Slot {
  startsAt: Date;
  barberIds: string[];
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function barberFreeAt(
  barber: BarberDay,
  start: Date,
  durationMinutes: number,
  bufferMinutes: number,
): boolean {
  const end = addMinutes(start, durationMinutes);
  const occupiedEnd = addMinutes(start, durationMinutes + bufferMinutes);
  const inWindow = barber.windows.some((w) => start >= w.start && end <= w.end);
  if (!inWindow) return false;
  return !barber.blocked.some((b) => overlaps(start, occupiedEnd, b.start, b.end));
}

export function computeSlots(q: SlotQuery): Slot[] {
  if (q.intervalMinutes <= 0 || q.durationMinutes <= 0) return [];
  const seen = new Set<number>();
  const slots: Slot[] = [];
  for (let minute = 0; minute < 24 * 60; minute += q.intervalMinutes) {
    const startsAt = zonedToUtc(q.date, minute, q.timezone);
    const key = startsAt.getTime();
    if (seen.has(key)) continue; // hora repetida o inexistente por cambio de horario
    seen.add(key);
    if (startsAt < q.earliest || startsAt > q.latest) continue;
    const barberIds = q.barbers
      .filter((b) => barberFreeAt(b, startsAt, q.durationMinutes, q.bufferMinutes))
      .map((b) => b.barberId);
    if (barberIds.length > 0) slots.push({ startsAt, barberIds });
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Convierte filas de horario semanal (minutos locales) en ventanas de instantes para una fecha. */
export function windowsForDate(
  date: string,
  timezone: string,
  rows: { startMinute: number; endMinute: number }[],
): Interval[] {
  return rows.map((r) => ({
    start: zonedToUtc(date, r.startMinute, timezone),
    end: zonedToUtc(date, r.endMinute, timezone),
  }));
}
