/**
 * Utilidades de zona horaria sin dependencias (Intl).
 * Regla: en BD se guardan instantes (UTC). La "fecha local" (YYYY-MM-DD) y los "minutos locales"
 * siempre se interpretan en la zona horaria de la sucursal.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  date: string; // YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = domingo
  minutesOfDay: number;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localParts(instant: Date, tz: string): LocalParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(instant)) map[p.type] = p.value;
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour);
  const minute = Number(map.minute);
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    year,
    month,
    day,
    hour,
    minute,
    weekday: WEEKDAYS[map.weekday ?? "Sun"] ?? 0,
    minutesOfDay: hour * 60 + minute,
  };
}

/** Desfase (minutos) de la zona respecto a UTC en un instante dado. */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const seconds = instant.getUTCSeconds();
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, seconds);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

export function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Fecha inválida: ${date}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    throw new Error(`Fecha inválida: ${date}`);
  return { year, month, day };
}

export function isLocalDate(date: string): boolean {
  try {
    parseLocalDate(date);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convierte "fecha local + minutos desde medianoche" en un instante.
 * Si la hora no existe (salto de horario de verano) se desplaza hacia adelante, como hacen los relojes.
 */
export function zonedToUtc(date: string, minutesOfDay: number, tz: string): Date {
  const { year, month, day } = parseLocalDate(date);
  const guess = Date.UTC(year, month - 1, day, 0, minutesOfDay);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  const r1 = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(r1), tz);
  if (off2 === off1) return new Date(r1); // caso normal o primera ocurrencia en un cambio hacia atrás
  const r2 = guess - off2 * 60000;
  if (tzOffsetMinutes(new Date(r2), tz) === off2) return new Date(r2);
  // Hora inexistente (salto hacia adelante): se desplaza hacia adelante.
  return new Date(Math.max(r1, r2));
}

export function weekdayOf(date: string): number {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

export function todayIn(tz: string, now = new Date()): string {
  return localParts(now, tz).date;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60000);
}

export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hhmmToMinutes(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) throw new Error(`Hora inválida: ${v}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Hora inválida: ${v}`);
  return h * 60 + min;
}

// ── Formato para mostrar (es-CL) ──

export function formatDate(instant: Date, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...opts,
  }).format(instant);
}

export function formatTime(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

export function formatDateTime(instant: Date, tz: string): string {
  return `${formatDate(instant, tz)} · ${formatTime(instant, tz)}`;
}

export function formatLocalDate(date: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const { year, month, day } = parseLocalDate(date);
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    ...opts,
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
