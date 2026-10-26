import { describe, expect, it } from "vitest";
import { mergeIntervals } from "@/modules/scheduling";

describe("horario de atención", () => {
  it("une franjas solapadas o contiguas de distintos barberos", () => {
    expect(
      mergeIntervals([
        { startMinute: 900, endMinute: 1200 },
        { startMinute: 600, endMinute: 840 },
        { startMinute: 660, endMinute: 900 },
      ]),
    ).toEqual([[600, 1200]]);
  });
  it("respeta las pausas cuando nadie atiende", () => {
    expect(
      mergeIntervals([
        { startMinute: 600, endMinute: 840 },
        { startMinute: 900, endMinute: 1200 },
      ]),
    ).toEqual([
      [600, 840],
      [900, 1200],
    ]);
  });
});
