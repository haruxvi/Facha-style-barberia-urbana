import { describe, expect, it } from "vitest";
import { computeSlots, windowsForDate } from "@/modules/scheduling";
import { localParts, zonedToUtc, addDays, weekdayOf, hhmmToMinutes } from "@/shared/time";
import { normalizePhone } from "@/shared/phone";
import { formatMoney, toMajorUnits, toMinorUnits } from "@/shared/money";

describe("zonas horarias", () => {
  it("convierte hora local de Santiago a UTC (invierno, UTC-4)", () => {
    expect(zonedToUtc("2026-07-15", 10 * 60, "America/Santiago").toISOString()).toBe(
      "2026-07-15T14:00:00.000Z",
    );
  });

  it("convierte hora local de Santiago a UTC (verano, UTC-3)", () => {
    expect(zonedToUtc("2026-01-15", 10 * 60, "America/Santiago").toISOString()).toBe(
      "2026-01-15T13:00:00.000Z",
    );
  });

  it("el día del cambio de hora genera horas válidas y sin duplicados", () => {
    // Chile adelanta el reloj el primer domingo de septiembre (2026-09-06): 00:00 → 01:00
    const tz = "America/Santiago";
    const slots = computeSlots({
      date: "2026-09-06",
      timezone: tz,
      intervalMinutes: 30,
      durationMinutes: 30,
      bufferMinutes: 0,
      earliest: new Date(0),
      latest: new Date(8.64e15),
      barbers: [
        {
          barberId: "b",
          windows: windowsForDate("2026-09-06", tz, [{ startMinute: 0, endMinute: 180 }]),
          blocked: [],
        },
      ],
    });
    const times = slots.map((s) => s.startsAt.getTime());
    expect(new Set(times).size).toBe(times.length);
    for (const s of slots) expect(localParts(s.startsAt, tz).date).toBe("2026-09-06");
  });

  it("localParts y weekday", () => {
    const p = localParts(new Date("2026-10-21T15:30:00Z"), "America/Santiago");
    expect(p.date).toBe("2026-10-21");
    expect(p.minutesOfDay).toBe(12 * 60 + 30);
    expect(weekdayOf("2026-10-21")).toBe(3);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(hhmmToMinutes("24:00")).toBe(1440);
    expect(() => hhmmToMinutes("25:00")).toThrow();
  });
});

describe("cálculo de disponibilidad", () => {
  const tz = "America/Santiago";
  const date = "2026-07-15";
  const base = {
    date,
    timezone: tz,
    intervalMinutes: 15,
    durationMinutes: 30,
    bufferMinutes: 10,
    earliest: new Date(0),
    latest: new Date(8.64e15),
  };
  const windows = windowsForDate(date, tz, [
    { startMinute: 600, endMinute: 780 }, // 10:00-13:00
    { startMinute: 840, endMinute: 900 }, // 14:00-15:00 (pausa de almuerzo 13-14)
  ]);

  it("respeta horario laboral, pausas y duración", () => {
    const slots = computeSlots({ ...base, barbers: [{ barberId: "a", windows, blocked: [] }] });
    const local = slots.map((s) => localParts(s.startsAt, tz).minutesOfDay);
    expect(local[0]).toBe(600);
    expect(local).toContain(750); // 12:30 termina 13:00 justo
    expect(local).not.toContain(765); // 12:45 terminaría 13:15 (pausa)
    expect(local).not.toContain(800);
    expect(local).toContain(840);
    expect(local.at(-1)).toBe(870); // 14:30 termina 15:00
  });

  it("bloquea solapes considerando el buffer", () => {
    const busy = { start: zonedToUtc(date, 660, tz), end: zonedToUtc(date, 700, tz) }; // 11:00-11:40 (cita+buffer)
    const slots = computeSlots({ ...base, barbers: [{ barberId: "a", windows, blocked: [busy] }] });
    const local = slots.map((s) => localParts(s.startsAt, tz).minutesOfDay);
    expect(local).toContain(615); // 10:15 + 30 + 10 = 10:55 < 11:00 ✓
    expect(local).not.toContain(630); // 10:30 ocuparía hasta 11:10 ✗
    expect(local).not.toContain(690);
    expect(local).toContain(705); // 11:45 ✓ (antes, 11:40 no está alineado)
  });

  it("combina barberos y respeta antelación mínima", () => {
    const earliest = zonedToUtc(date, 720, tz);
    const slots = computeSlots({
      ...base,
      earliest,
      barbers: [
        { barberId: "a", windows, blocked: [] },
        {
          barberId: "b",
          windows: windowsForDate(date, tz, [{ startMinute: 720, endMinute: 780 }]),
          blocked: [],
        },
      ],
    });
    expect(slots[0]!.startsAt.getTime()).toBe(earliest.getTime());
    expect(slots[0]!.barberIds.sort()).toEqual(["a", "b"]);
  });
});

describe("teléfonos", () => {
  it("normaliza móviles chilenos", () => {
    expect(normalizePhone("9 1234 5678")).toBe("+56912345678");
    expect(normalizePhone("+56 9 1234 5678")).toBe("+56912345678");
    expect(normalizePhone("56912345678")).toBe("+56912345678");
    expect(normalizePhone("+54 9 11 2345 6789")).toBe("+5491123456789");
  });
  it("rechaza números inválidos", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("+56 9 1234")).toBeNull();
  });
});

describe("dinero", () => {
  it("CLP no tiene decimales", () => {
    expect(toMajorUnits(15000, "CLP")).toBe(15000);
    expect(toMinorUnits(15000, "CLP")).toBe(15000);
    expect(formatMoney(15000, "CLP")).toMatch(/15\.000/);
  });
  it("USD usa centavos", () => {
    expect(toMajorUnits(1999, "USD")).toBe(19.99);
    expect(toMinorUnits(19.99, "USD")).toBe(1999);
  });
});
