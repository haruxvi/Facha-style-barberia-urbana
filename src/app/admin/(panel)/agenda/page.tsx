import Link from "next/link";
import { listAppointments, type AgendaAppointment } from "@/modules/booking";
import { listBarbers } from "@/modules/catalog";
import { can, requireAuth } from "@/modules/identity";
import { listScheduleExceptions } from "@/modules/scheduling";
import { listBranches } from "@/modules/tenancy";
import { ActionForm } from "@/components/action-form";
import { ButtonLink, Card, Field, Input, PageHeader, Select, cx } from "@/components/ui";
import {
  addDays,
  formatLocalDate,
  formatTime,
  isLocalDate,
  localParts,
  parseLocalDate,
  todayIn,
  weekdayOf,
  zonedToUtc,
} from "@/shared/time";
import { addExceptionAction, removeExceptionAction } from "../../actions";

export const metadata = { title: "Agenda" };

type View = "dia" | "semana" | "mes";
type SP = { vista?: string; fecha?: string; sucursal?: string; barbero?: string };

const STATUS_COLORS: Record<string, string> = {
  PENDING_PAYMENT: "border-warn/60 bg-warn/15",
  CONFIRMED: "border-info/60 bg-info/15",
  CHECKED_IN: "border-accent/70 bg-accent/20",
  COMPLETED: "border-ok/60 bg-ok/15",
  CANCELLED: "border-danger/40 bg-danger/10 opacity-60 line-through",
  NO_SHOW: "border-danger/60 bg-danger/15",
  EXPIRED: "border-line bg-surface-2 opacity-50",
};

const START_HOUR = 8;
const END_HOUR = 22;
const PX_PER_MIN = 1.4;

export default async function AgendaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAuth("agenda.view");
  const sp = await searchParams;
  const tz = ctx.timezone;
  const view: View = sp.vista === "semana" || sp.vista === "mes" ? sp.vista : "dia";
  const date = sp.fecha && isLocalDate(sp.fecha) ? sp.fecha : todayIn(tz);
  const [branches, barbers] = await Promise.all([listBranches(ctx), listBarbers(ctx)]);
  const branchId = sp.sucursal && branches.some((b) => b.id === sp.sucursal) ? sp.sucursal : undefined;
  const barberId = sp.barbero && barbers.some((b) => b.id === sp.barbero) ? sp.barbero : undefined;

  let from = date;
  let days = 1;
  if (view === "semana") {
    from = addDays(date, -((weekdayOf(date) + 6) % 7));
    days = 7;
  } else if (view === "mes") {
    const { year, month } = parseLocalDate(date);
    from = `${year}-${String(month).padStart(2, "0")}-01`;
    const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    days = Math.round((Date.parse(next) - Date.parse(from)) / 86400000);
  }
  const range = { from: zonedToUtc(from, 0, tz), to: zonedToUtc(addDays(from, days), 0, tz) };
  const [appointments, exceptions] = await Promise.all([
    listAppointments(ctx, { ...range, branchId, barberId }),
    listScheduleExceptions(ctx, { from: range.from, barberId }),
  ]);
  const visibleBarbers = barbers.filter((b) => b.active && (!barberId || b.id === barberId));

  const q = (over: Partial<SP>) => {
    const p = new URLSearchParams({
      vista: view,
      fecha: date,
      ...(branchId ? { sucursal: branchId } : {}),
      ...(barberId ? { barbero: barberId } : {}),
    });
    for (const [k, v] of Object.entries(over)) if (v) p.set(k, v);
    return `/admin/agenda?${p}`;
  };
  const step = view === "dia" ? 1 : view === "semana" ? 7 : 30;

  return (
    <>
      <PageHeader
        title="Agenda"
        description={<span className="first-letter:uppercase">{formatLocalDate(date)}</span>}
        actions={<ButtonLink href="/admin/reservas/nueva">Nueva reserva</ButtonLink>}
      />

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="flex overflow-hidden rounded-lg border border-line">
          {(["dia", "semana", "mes"] as View[]).map((v) => (
            <Link
              key={v}
              href={q({ vista: v })}
              className={cx(
                "px-3 py-2 text-sm capitalize",
                v === view ? "bg-accent text-accent-ink" : "hover:bg-surface-2",
              )}
            >
              {v === "dia" ? "Día" : v}
            </Link>
          ))}
        </div>
        <div className="flex gap-1">
          <Link
            className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2"
            href={q({ fecha: addDays(date, -step) })}
          >
            ←
          </Link>
          <Link
            className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2"
            href={q({ fecha: todayIn(tz) })}
          >
            Hoy
          </Link>
          <Link
            className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2"
            href={q({ fecha: addDays(date, step) })}
          >
            →
          </Link>
        </div>
        <form className="flex flex-wrap items-end gap-2" action="/admin/agenda">
          <input type="hidden" name="vista" value={view} />
          <Input type="date" name="fecha" defaultValue={date} className="w-40" />
          {branches.length > 1 && (
            <Select name="sucursal" defaultValue={branchId ?? ""} className="w-40">
              <option value="">Todas las sucursales</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
          <Select name="barbero" defaultValue={barberId ?? ""} className="w-40">
            <option value="">Todos los barberos</option>
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName}
              </option>
            ))}
          </Select>
          <button className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2">
            Filtrar
          </button>
        </form>
      </Card>

      {view === "dia" && (
        <DayView
          appointments={appointments}
          barbers={visibleBarbers}
          exceptions={exceptions}
          date={date}
          tz={tz}
        />
      )}
      {view === "semana" && <WeekView appointments={appointments} from={from} tz={tz} />}
      {view === "mes" && (
        <MonthView
          appointments={appointments}
          from={from}
          days={days}
          tz={tz}
          link={(d) => q({ vista: "dia", fecha: d })}
        />
      )}

      {can(ctx.role, "barbers.manage") && (
        <Card className="mt-6">
          <h2 className="mb-3 font-display text-lg uppercase tracking-wide">Bloquear horario</h2>
          <ActionForm
            action={addExceptionAction}
            submitLabel="Bloquear"
            resetOnSuccess
            className="grid gap-3 sm:grid-cols-6 sm:items-end"
          >
            <Field label="Barbero" className="sm:col-span-2">
              <Select name="barberId" defaultValue={barberId ?? ""}>
                <option value="">Toda la barbería (feriado)</option>
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha">
              <Input type="date" name="date" defaultValue={date} required />
            </Field>
            <Field label="Desde">
              <Input type="time" name="start" defaultValue="13:00" />
            </Field>
            <Field label="Hasta">
              <Input type="time" name="end" defaultValue="14:00" />
            </Field>
            <Field label="Motivo">
              <Input name="reason" placeholder="Trámite, almuerzo…" />
            </Field>
          </ActionForm>
          {exceptions.length > 0 && (
            <ul className="mt-4 divide-y divide-line text-sm">
              {exceptions.slice(0, 20).map((ex) => (
                <li key={ex.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <b>{ex.barber?.displayName ?? "Toda la barbería"}</b> ·{" "}
                    {formatLocalDate(localParts(ex.startsAt, tz).date, { weekday: "short" })}{" "}
                    {formatTime(ex.startsAt, tz)}–{formatTime(ex.endsAt, tz)}{" "}
                    {ex.reason ? `· ${ex.reason}` : ""}
                    {ex.type === "EXTRA_HOURS" ? " (horas extra)" : ""}
                  </span>
                  <ActionForm action={removeExceptionAction} submitLabel="Quitar" variant="ghost" inline>
                    <input type="hidden" name="id" value={ex.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}

function ApptBlock({ a, tz, compact = false }: { a: AgendaAppointment; tz: string; compact?: boolean }) {
  return (
    <Link
      href={`/admin/reservas/${a.id}`}
      className={cx(
        "block rounded-md border px-2 py-1 text-xs hover:brightness-125",
        STATUS_COLORS[a.status],
      )}
    >
      <span className="font-semibold">{formatTime(a.startsAt, tz)}</span> {a.customer.name}
      {!compact && <span className="block truncate text-muted">{a.serviceName}</span>}
    </Link>
  );
}

function DayView({
  appointments,
  barbers,
  exceptions,
  date,
  tz,
}: {
  appointments: AgendaAppointment[];
  barbers: { id: string; displayName: string }[];
  exceptions: {
    id: string;
    barberId: string | null;
    startsAt: Date;
    endsAt: Date;
    reason: string | null;
    type: string;
  }[];
  date: string;
  tz: string;
}) {
  const dayStart = zonedToUtc(date, START_HOUR * 60, tz).getTime();
  const height = (END_HOUR - START_HOUR) * 60 * PX_PER_MIN;
  const top = (d: Date) => Math.max(0, ((d.getTime() - dayStart) / 60000) * PX_PER_MIN);
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  if (barbers.length === 0) return <Card className="text-sm text-muted">No hay barberos activos.</Card>;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <div
        className="grid min-w-[640px]"
        style={{ gridTemplateColumns: `56px repeat(${barbers.length}, minmax(150px, 1fr))` }}
      >
        <div className="border-b border-line" />
        {barbers.map((b) => (
          <div
            key={b.id}
            className="border-b border-l border-line px-3 py-2 font-display text-sm uppercase tracking-wide"
          >
            {b.displayName}
          </div>
        ))}
        <div className="relative" style={{ height }}>
          {hours.map((h) => (
            <div
              key={h}
              className="absolute right-2 -translate-y-2 text-xs text-muted"
              style={{ top: (h - START_HOUR) * 60 * PX_PER_MIN }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {barbers.map((b) => (
          <div key={b.id} className="relative border-l border-line" style={{ height }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute inset-x-0 border-t border-line/50"
                style={{ top: (h - START_HOUR) * 60 * PX_PER_MIN }}
              />
            ))}
            {exceptions
              .filter((ex) => ex.type === "TIME_OFF" && (ex.barberId === b.id || ex.barberId === null))
              .map((ex) => (
                <div
                  key={ex.id}
                  className="bg-stripes absolute inset-x-1 rounded-md border border-dashed border-line bg-surface-2/80 px-2 text-[11px] text-muted"
                  style={{ top: top(ex.startsAt), height: Math.max(14, top(ex.endsAt) - top(ex.startsAt)) }}
                >
                  {ex.reason ?? "Bloqueado"}
                </div>
              ))}
            {appointments
              .filter((a) => a.barberId === b.id)
              .map((a) => (
                <div
                  key={a.id}
                  className="absolute inset-x-1"
                  style={{ top: top(a.startsAt), height: Math.max(22, top(a.endsAt) - top(a.startsAt)) }}
                >
                  <ApptBlock a={a} tz={tz} />
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekView({
  appointments,
  from,
  tz,
}: {
  appointments: AgendaAppointment[];
  from: string;
  tz: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {days.map((d) => {
        const list = appointments.filter((a) => localParts(a.startsAt, tz).date === d);
        return (
          <Card key={d} className="p-3">
            <div className="mb-2 font-display text-sm uppercase tracking-wide first-letter:uppercase">
              {formatLocalDate(d, { weekday: "short", day: "numeric", month: "short" })}
            </div>
            <div className="space-y-1.5">
              {list.length === 0 && <div className="text-xs text-muted">—</div>}
              {list.map((a) => (
                <ApptBlock key={a.id} a={a} tz={tz} />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function MonthView({
  appointments,
  from,
  days,
  tz,
  link,
}: {
  appointments: AgendaAppointment[];
  from: string;
  days: number;
  tz: string;
  link: (d: string) => string;
}) {
  const lead = (weekdayOf(from) + 6) % 7;
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => addDays(from, i)),
  ];
  const counts = new Map<string, number>();
  for (const a of appointments) {
    if (a.status === "CANCELLED" || a.status === "EXPIRED") continue;
    const d = localParts(a.startsAt, tz).date;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return (
    <div className="grid grid-cols-7 gap-1.5 text-sm">
      {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
        <div key={d} className="px-2 text-xs font-semibold uppercase text-muted">
          {d}
        </div>
      ))}
      {cells.map((d, i) =>
        d ? (
          <Link
            key={d}
            href={link(d)}
            className="min-h-20 rounded-lg border border-line bg-surface p-2 hover:border-accent"
          >
            <div className="text-xs text-muted">{parseLocalDate(d).day}</div>
            {counts.get(d) ? (
              <div className="mt-2 font-display text-xl text-accent">{counts.get(d)}</div>
            ) : null}
          </Link>
        ) : (
          <div key={`e${i}`} />
        ),
      )}
    </div>
  );
}
