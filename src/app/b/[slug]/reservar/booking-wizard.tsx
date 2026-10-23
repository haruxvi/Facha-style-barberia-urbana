"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Checkbox, Field, Input, Notice, Textarea, cx } from "@/components/ui";

type Branch = { id: string; name: string; address: string | null; timezone: string };
type Barber = { id: string; displayName: string; bio: string | null };
type Service = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceAmount: number;
  barbers: Barber[];
};
type Slot = { startsAt: string; barberIds: string[] };

interface Props {
  slug: string;
  currency: string;
  paymentPolicy: "NONE" | "OPTIONAL" | "DEPOSIT_REQUIRED" | "FULL_REQUIRED";
  depositAmount: number;
  horizonDays: number;
  bookingTerms: string | null;
  cancellationHours: number;
  branches: Branch[];
  campaign: string | null;
}

function money(amount: number, currency: string) {
  const decimals = ["CLP", "PYG", "JPY"].includes(currency) ? 0 : 2;
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount / 10 ** decimals);
}

/** Fechas locales (YYYY-MM-DD) de los próximos días en la zona de la sucursal. */
function nextDates(tz: string, days: number): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(new Date());
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return Array.from({ length: days }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10),
  );
}

function dayLabel(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: new Intl.DateTimeFormat("es-CL", { weekday: "short", timeZone: "UTC" })
      .format(dt)
      .replace(".", ""),
    day: d,
    month: new Intl.DateTimeFormat("es-CL", { month: "short", timeZone: "UTC" }).format(dt).replace(".", ""),
  };
}

function timeLabel(iso: string, tz: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function fullLabel(iso: string, tz: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

const STEPS = ["Servicio", "Profesional", "Fecha y hora", "Tus datos"];

export function BookingWizard(props: Props) {
  const [branchId, setBranchId] = useState(props.branches[0]?.id ?? "");
  const branch = props.branches.find((b) => b.id === branchId);
  const tz = branch?.timezone ?? "America/Santiago";

  // Los datos remotos se guardan junto a la clave de la consulta: si la clave cambió, aún se están cargando.
  const [servicesData, setServicesData] = useState<{ branchId: string; services: Service[] } | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [barberId, setBarberId] = useState<string | null | undefined>(undefined); // null = cualquiera
  const [date, setDate] = useState<string | null>(null);
  const [slotsData, setSlotsData] = useState<{ key: string; slots: Slot[] } | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [reload, setReload] = useState(0);

  const [form, setForm] = useState({
    name: "",
    phone: "+56 9 ",
    email: "",
    notes: "",
    whatsapp: true,
    emailOk: false,
    marketing: false,
    terms: false,
    payOnline: false,
  });

  const services = servicesData?.branchId === branchId ? servicesData.services : null;
  const service = services?.find((s) => s.id === serviceId) ?? null;
  const dates = useMemo(() => nextDates(tz, props.horizonDays), [tz, props.horizonDays]);
  const step = !service ? 0 : barberId === undefined ? 1 : !startsAt ? 2 : 3;
  const slotsQuery =
    serviceId && barberId !== undefined && date
      ? new URLSearchParams({ branchId, serviceId, date, ...(barberId ? { barberId } : {}) }).toString()
      : null;
  const slotsKey = slotsQuery ? `${slotsQuery}#${reload}` : null;
  const slots = slotsData && slotsData.key === slotsKey ? slotsData.slots : null;
  const slotsLoading = !!slotsKey && !slots;

  useEffect(() => {
    if (!branchId) return;
    let alive = true;
    fetch(`/api/public/barbershops/${props.slug}/services?branchId=${branchId}`)
      .then((r) => r.json())
      .then((d) => alive && setServicesData({ branchId, services: d.services ?? [] }))
      .catch(() => alive && setError("No pudimos cargar los servicios. Recarga la página."));
    return () => {
      alive = false;
    };
  }, [branchId, props.slug]);

  useEffect(() => {
    if (!slotsQuery || !slotsKey) return;
    let alive = true;
    fetch(`/api/public/barbershops/${props.slug}/availability?${slotsQuery}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error?.message ?? "Error");
        return d as { slots: Slot[] };
      })
      .then((d) => alive && setSlotsData({ key: slotsKey, slots: d.slots }))
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setSlotsData({ key: slotsKey, slots: [] });
      });
    return () => {
      alive = false;
    };
  }, [slotsQuery, slotsKey, props.slug]);

  const requiresPayment =
    props.paymentPolicy === "FULL_REQUIRED" ||
    (props.paymentPolicy === "DEPOSIT_REQUIRED" && props.depositAmount > 0) ||
    (props.paymentPolicy === "OPTIONAL" && form.payOnline);
  const amountDue = !service
    ? 0
    : props.paymentPolicy === "FULL_REQUIRED" || (props.paymentPolicy === "OPTIONAL" && form.payOnline)
      ? service.priceAmount
      : props.paymentPolicy === "DEPOSIT_REQUIRED"
        ? Math.min(props.depositAmount, service.priceAmount)
        : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!service || !startsAt) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/barbershops/${props.slug}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          serviceId: service.id,
          barberId: barberId ?? null,
          startsAt,
          customer: { name: form.name, phone: form.phone, email: form.email || null },
          consents: {
            whatsapp: form.whatsapp,
            email: form.emailOk && !!form.email,
            marketing: form.marketing,
          },
          acceptTerms: form.terms,
          payOnline: form.payOnline,
          customerNotes: form.notes || null,
          campaign: props.campaign,
          idempotencyKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.code === "SLOT_UNAVAILABLE") {
          setStartsAt(null);
          setIdempotencyKey(newKey());
          setReload((n) => n + 1); // vuelve a pedir horas libres
        }
        throw new Error(data.error?.message ?? "No se pudo crear la reserva");
      }
      window.location.assign(data.next);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <ol className="flex gap-2 text-xs font-semibold uppercase tracking-wider">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={cx(
              "flex-1 border-t-2 pt-2",
              i <= step ? "border-accent text-ink" : "border-line text-muted",
            )}
          >
            <span className="hidden sm:inline">{s}</span>
            <span className="sm:hidden">{i + 1}</span>
          </li>
        ))}
      </ol>

      {error && <Notice tone="danger">{error}</Notice>}

      {props.branches.length > 1 && (
        <Card>
          <h2 className="mb-3 font-display text-lg uppercase tracking-wide">Sucursal</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {props.branches.map((b) => (
              <Choice
                key={b.id}
                active={b.id === branchId}
                onClick={() => {
                  setBranchId(b.id);
                  setServiceId(null);
                  setBarberId(undefined);
                  setDate(null);
                  setStartsAt(null);
                }}
              >
                <div className="font-semibold">{b.name}</div>
                {b.address && <div className="text-xs text-muted">{b.address}</div>}
              </Choice>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <StepTitle
          n={1}
          title="¿Qué te hacemos?"
          done={!!service}
          onEdit={() => {
            setServiceId(null);
            setBarberId(undefined);
            setDate(null);
            setStartsAt(null);
          }}
          summary={service ? `${service.name} · ${money(service.priceAmount, props.currency)}` : null}
        />
        {!service && (
          <div className="mt-4 grid gap-2">
            {services === null && <div className="text-sm text-muted">Cargando servicios…</div>}
            {services?.length === 0 && (
              <div className="text-sm text-muted">No hay servicios disponibles en esta sucursal.</div>
            )}
            {services?.map((s) => (
              <Choice key={s.id} active={false} onClick={() => setServiceId(s.id)}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-muted">
                      {s.durationMinutes} min{s.description ? ` · ${s.description}` : ""}
                    </div>
                  </div>
                  <div className="font-display text-accent">{money(s.priceAmount, props.currency)}</div>
                </div>
              </Choice>
            ))}
          </div>
        )}
      </Card>

      {service && (
        <Card>
          <StepTitle
            n={2}
            title="¿Con quién?"
            done={barberId !== undefined}
            onEdit={() => {
              setBarberId(undefined);
              setStartsAt(null);
            }}
            summary={
              barberId === undefined
                ? null
                : barberId === null
                  ? "Cualquier profesional"
                  : (service.barbers.find((b) => b.id === barberId)?.displayName ?? "")
            }
          />
          {barberId === undefined && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Choice active={false} onClick={() => setBarberId(null)}>
                <div className="font-semibold">Cualquier profesional</div>
                <div className="text-xs text-muted">Más horarios disponibles</div>
              </Choice>
              {service.barbers.map((b) => (
                <Choice key={b.id} active={false} onClick={() => setBarberId(b.id)}>
                  <div className="font-semibold">{b.displayName}</div>
                  {b.bio && <div className="line-clamp-2 text-xs text-muted">{b.bio}</div>}
                </Choice>
              ))}
            </div>
          )}
        </Card>
      )}

      {service && barberId !== undefined && (
        <Card>
          <StepTitle
            n={3}
            title="¿Cuándo?"
            done={!!startsAt}
            onEdit={() => setStartsAt(null)}
            summary={startsAt ? fullLabel(startsAt, tz) : null}
          />
          {!startsAt && (
            <div className="mt-4 space-y-4">
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                {dates.map((d) => {
                  const l = dayLabel(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDate(d)}
                      aria-label={`${l.weekday} ${l.day} ${l.month}`}
                      aria-pressed={d === date}
                      className={cx(
                        "flex w-16 shrink-0 flex-col items-center rounded-lg border py-2 transition",
                        d === date
                          ? "border-accent bg-accent text-accent-ink"
                          : "border-line bg-surface-2 hover:border-muted",
                      )}
                    >
                      <span className="text-[11px] uppercase">{l.weekday}</span>
                      <span className="font-display text-xl">{l.day}</span>
                      <span className="text-[11px] uppercase">{l.month}</span>
                    </button>
                  );
                })}
              </div>
              {!date && <div className="text-sm text-muted">Elige un día para ver las horas libres.</div>}
              {date && slotsLoading && <div className="text-sm text-muted">Buscando horas libres…</div>}
              {date && slots?.length === 0 && (
                <div className="text-sm text-muted">No quedan horas este día. Prueba con otro.</div>
              )}
              {slots && slots.length > 0 && (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {slots.map((s) => (
                    <button
                      key={s.startsAt}
                      type="button"
                      onClick={() => setStartsAt(s.startsAt)}
                      className="rounded-lg border border-line bg-surface-2 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
                    >
                      {timeLabel(s.startsAt, tz)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {service && startsAt && (
        <Card>
          <StepTitle n={4} title="Tus datos" done={false} />
          <form onSubmit={submit} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre y apellido">
                <Input
                  required
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="WhatsApp" hint="Te enviaremos la confirmación aquí">
                <Input
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Correo (opcional)">
              <Input
                type="email"
                autoComplete="email"
                maxLength={200}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Comentario (opcional)">
              <Textarea
                maxLength={300}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Ej: degradado bajo, traigo foto de referencia"
              />
            </Field>

            <div className="space-y-2.5 rounded-lg border border-line bg-surface-2 p-4">
              <Checkbox
                checked={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })}
                label="Quiero recibir la confirmación y el recordatorio de esta reserva por WhatsApp"
              />
              {form.email && (
                <Checkbox
                  checked={form.emailOk}
                  onChange={(e) => setForm({ ...form, emailOk: e.target.checked })}
                  label="También por correo electrónico"
                />
              )}
              <Checkbox
                checked={form.marketing}
                onChange={(e) => setForm({ ...form, marketing: e.target.checked })}
                label="Acepto recibir promociones ocasionales (puedes darte de baja cuando quieras)"
              />
              {props.paymentPolicy === "OPTIONAL" && (
                <Checkbox
                  checked={form.payOnline}
                  onChange={(e) => setForm({ ...form, payOnline: e.target.checked })}
                  label={`Pagar ahora en línea (${money(service.priceAmount, props.currency)})`}
                />
              )}
              <Checkbox
                required
                checked={form.terms}
                onChange={(e) => setForm({ ...form, terms: e.target.checked })}
                label={
                  <>
                    Acepto las condiciones de reserva
                    {props.cancellationHours > 0 &&
                      ` (cancelaciones en línea hasta ${props.cancellationHours} h antes)`}
                    .
                    {props.bookingTerms && (
                      <span className="mt-1 block text-xs text-muted">{props.bookingTerms}</span>
                    )}
                  </>
                }
              />
            </div>

            <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm">
              <div className="font-semibold">{service.name}</div>
              <div className="text-muted">{fullLabel(startsAt, tz)}</div>
              <div className="mt-2 flex justify-between">
                <span>Total del servicio</span>
                <span className="font-semibold">{money(service.priceAmount, props.currency)}</span>
              </div>
              {requiresPayment && amountDue > 0 && (
                <div className="flex justify-between text-accent">
                  <span>{amountDue < service.priceAmount ? "Seña a pagar ahora" : "A pagar ahora"}</span>
                  <span className="font-semibold">{money(amountDue, props.currency)}</span>
                </div>
              )}
            </div>

            <Button type="submit" disabled={submitting || !form.terms} className="w-full py-3 text-base">
              {submitting
                ? "Reservando…"
                : requiresPayment && amountDue > 0
                  ? "Reservar y pagar"
                  : "Confirmar reserva"}
            </Button>
            <p className="text-center text-xs text-muted">
              No necesitas crear una cuenta. Usamos tus datos solo para gestionar tu reserva.
            </p>
          </form>
        </Card>
      )}
    </div>
  );
}

function StepTitle({
  n,
  title,
  done,
  summary,
  onEdit,
}: {
  n: number;
  title: string;
  done: boolean;
  summary?: string | null;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span
          className={cx(
            "flex size-7 items-center justify-center rounded-full text-sm font-bold",
            done ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted",
          )}
        >
          {n}
        </span>
        <div>
          <h2 className="font-display text-lg uppercase tracking-wide">{title}</h2>
          {done && summary && <div className="text-sm text-muted">{summary}</div>}
        </div>
      </div>
      {done && onEdit && (
        <button type="button" onClick={onEdit} className="text-sm text-accent hover:underline">
          Cambiar
        </button>
      )}
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "w-full rounded-lg border px-4 py-3 text-left transition",
        active ? "border-accent bg-accent/10" : "border-line bg-surface-2 hover:border-accent/60",
      )}
    >
      {children}
    </button>
  );
}
