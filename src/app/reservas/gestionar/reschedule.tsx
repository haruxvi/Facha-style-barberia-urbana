"use client";

import { useMemo, useState, useTransition } from "react";
import { ActionForm } from "@/components/action-form";
import { cx } from "@/components/ui";
import { rescheduleByCustomerAction, slotsForRescheduleAction } from "./actions";

function nextDates(tz: string, days: number): string[] {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return Array.from({ length: days }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10),
  );
}

export function Reschedule({ timezone, horizonDays }: { timezone: string; horizonDays: number }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ startsAt: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dates = useMemo(() => nextDates(timezone, horizonDays), [timezone, horizonDays]);
  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat("es-CL", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-accent hover:underline"
      >
        Cambiar día u hora →
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-line p-4">
      <div className="text-sm font-semibold">Elige un nuevo día</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {dates.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setDate(d);
              setSelected(null);
              start(async () => {
                const r = await slotsForRescheduleAction(d);
                if ("error" in r) {
                  setError(r.error);
                  setSlots([]);
                } else {
                  setError(null);
                  setSlots(r);
                }
              });
            }}
            className={cx(
              "shrink-0 rounded-lg border px-3 py-1.5 text-sm",
              d === date ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface-2",
            )}
          >
            {new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "short", day: "numeric" }).format(
              new Date(`${d}T12:00:00Z`),
            )}
          </button>
        ))}
      </div>
      {pending && <div className="text-sm text-muted">Buscando horas…</div>}
      {error && <div className="text-sm text-danger">{error}</div>}
      {slots && !pending && slots.length === 0 && !error && (
        <div className="text-sm text-muted">Sin horas libres ese día.</div>
      )}
      {slots && slots.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {slots.map((s) => (
            <button
              key={s.startsAt}
              type="button"
              onClick={() => setSelected(s.startsAt)}
              className={cx(
                "rounded-lg border py-1.5 text-sm",
                selected === s.startsAt
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-line bg-surface-2",
              )}
            >
              {fmtTime(s.startsAt)}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <ActionForm action={rescheduleByCustomerAction} submitLabel={`Cambiar a las ${fmtTime(selected)}`}>
          <input type="hidden" name="startsAt" value={selected} />
        </ActionForm>
      )}
    </div>
  );
}
