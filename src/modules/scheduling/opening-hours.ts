import { db } from "@/shared/db";
import { minutesToHHMM } from "@/shared/time";

const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // semana empezando el lunes

/** Une franjas que se solapan o se tocan (varios barberos con turnos distintos). */
export function mergeIntervals(rows: { startMinute: number; endMinute: number }[]): [number, number][] {
  const sorted = [...rows].sort((a, b) => a.startMinute - b.startMinute);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.startMinute <= last[1]) last[1] = Math.max(last[1], r.endMinute);
    else out.push([r.startMinute, r.endMinute]);
  }
  return out;
}

export interface OpeningHoursLine {
  days: string; // "Lun a Vie", "Sáb", "Dom"
  hours: string; // "10:00–14:00 · 15:00–20:00" o "Cerrado"
}

/**
 * Horario de atención público de una sucursal: unión de los horarios semanales de sus barberos activos.
 * Agrupa días consecutivos con el mismo horario ("Lun a Vie").
 */
export async function getBranchOpeningHours(tenantId: string, branchId: string): Promise<OpeningHoursLine[]> {
  const rows = await db.workingHours.findMany({
    where: { tenantId, branchId, barber: { active: true } },
    select: { weekday: true, startMinute: true, endMinute: true },
  });
  const perDay = ORDER.map((wd) => {
    const merged = mergeIntervals(rows.filter((r) => r.weekday === wd));
    return {
      wd,
      hours: merged.length
        ? merged.map(([s, e]) => `${minutesToHHMM(s)}–${minutesToHHMM(Math.min(e, 1439))}`).join(" · ")
        : "Cerrado",
    };
  });
  const lines: OpeningHoursLine[] = [];
  let i = 0;
  while (i < perDay.length) {
    let j = i;
    while (j + 1 < perDay.length && perDay[j + 1]!.hours === perDay[i]!.hours) j++;
    const first = DAY_SHORT[perDay[i]!.wd]!;
    const last = DAY_SHORT[perDay[j]!.wd]!;
    lines.push({ days: i === j ? first : `${first} a ${last}`, hours: perDay[i]!.hours });
    i = j + 1;
  }
  return lines;
}
