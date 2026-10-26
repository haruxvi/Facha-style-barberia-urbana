import Link from "next/link";
import { getAppointmentDetail } from "@/modules/booking";
import { getBookableService } from "@/modules/catalog";
import { can, requireAuth } from "@/modules/identity";
import { loadAvailability } from "@/modules/scheduling";
import { orNotFound } from "@/server/page";
import { ActionForm } from "@/components/action-form";
import {
  AppointmentStatusBadge,
  Card,
  Field,
  Input,
  NotificationStatusBadge,
  PageHeader,
  PaymentStatusBadge,
  Textarea,
} from "@/components/ui";
import { formatMoney } from "@/shared/money";
import { formatDateTime, formatTime, isLocalDate, localParts } from "@/shared/time";
import {
  appointmentTransitionAction,
  rescheduleAction,
  revokeLinkAction,
  sendManualMessageAction,
} from "../../../actions";

export const metadata = { title: "Reserva" };

const EVENT_LABELS: Record<string, string> = {
  created: "Creada",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  rescheduled: "Reprogramada",
  checked_in: "Llegada registrada",
  completed: "Completada",
  no_show: "No asistió",
  expired: "Hold de pago vencido",
  manage_link_revoked: "Enlace de gestión revocado",
};

export default async function AppointmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reprogramar?: string }>;
}) {
  const ctx = await requireAuth();
  const { id } = await params;
  const { reprogramar } = await searchParams;
  const a = await orNotFound(getAppointmentDetail(ctx, id));
  const tz = a.branch.timezone;
  const manage = can(ctx.role, "appointments.manage");

  let slots: Date[] = [];
  if (manage && reprogramar && isLocalDate(reprogramar) && a.status === "CONFIRMED") {
    const service = await getBookableService(ctx.tenantId, a.branchId, a.serviceId);
    const r = await loadAvailability({
      tenantId: ctx.tenantId,
      branchId: a.branchId,
      service: {
        id: a.serviceId,
        durationMinutes: a.durationMinutes,
        bufferMinutes: service?.bufferMinutes ?? a.bufferMinutes,
      },
      barberId: a.barberId,
      date: reprogramar,
      excludeAppointmentId: a.id,
      ignoreBookingWindow: true,
    });
    slots = r.slots.map((s) => s.startsAt);
  }

  return (
    <>
      <PageHeader
        title={a.customer.name}
        description={
          <span className="first-letter:uppercase">
            {a.serviceName} · {formatDateTime(a.startsAt, tz)} · {a.barber.displayName}
          </span>
        }
        actions={<AppointmentStatusBadge status={a.status} />}
      />

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <Info label="Teléfono" value={a.customer.phoneE164} />
              <Info label="Correo" value={a.customer.email ?? "—"} />
              <Info label="Sucursal" value={a.branch.name} />
              <Info label="Precio acordado" value={formatMoney(a.priceAmount, a.currency)} />
              <Info label="Duración" value={`${a.durationMinutes} min (+${a.bufferMinutes})`} />
              <Info
                label="Origen"
                value={a.source === "WEB" ? "Web" : a.source === "WHATSAPP" ? "WhatsApp" : "Panel"}
              />
              {a.amountDue > 0 && (
                <Info label="Pago online exigido" value={formatMoney(a.amountDue, a.currency)} />
              )}
              {a.campaign && <Info label="Campaña QR" value={a.campaign} />}
            </dl>
            {a.customerNotes && <p className="rounded-lg bg-surface-2 p-3 text-sm">“{a.customerNotes}”</p>}
            <Link href={`/admin/clientes/${a.customer.id}`} className="text-sm text-accent hover:underline">
              Ver ficha del cliente →
            </Link>
          </Card>

          <Card className="space-y-3">
            <h2 className="heading-section">Acciones</h2>
            <div className="flex flex-wrap gap-2">
              {a.status === "PENDING_PAYMENT" && manage && (
                <Transition id={a.id} name="confirm" label="Confirmar (pago en local)" variant="primary" />
              )}
              {a.status === "EXPIRED" && manage && <Transition id={a.id} name="confirm" label="Reactivar" />}
              {a.status === "CONFIRMED" && (
                <Transition id={a.id} name="check_in" label="Registrar llegada" variant="primary" />
              )}
              {["CONFIRMED", "CHECKED_IN"].includes(a.status) && (
                <Transition id={a.id} name="complete" label="Marcar atendida" />
              )}
              {a.status === "CONFIRMED" && (
                <Transition
                  id={a.id}
                  name="no_show"
                  label="No asistió"
                  variant="danger"
                  confirm="¿Marcar como ausencia?"
                />
              )}
            </div>
            {manage && ["CONFIRMED", "PENDING_PAYMENT"].includes(a.status) && (
              <ActionForm
                action={appointmentTransitionAction}
                submitLabel="Cancelar reserva"
                variant="danger"
                confirm="¿Cancelar esta reserva? Se avisará al cliente si tiene consentimiento."
              >
                <input type="hidden" name="appointmentId" value={a.id} />
                <input type="hidden" name="transition" value="cancel" />
                <Field label="Motivo (interno)">
                  <Input name="reason" maxLength={200} />
                </Field>
              </ActionForm>
            )}
          </Card>

          {manage && a.status === "CONFIRMED" && (
            <Card className="space-y-3">
              <h2 className="heading-section">Reprogramar</h2>
              <form className="flex items-end gap-2">
                <Field label="Nueva fecha">
                  <Input
                    type="date"
                    name="reprogramar"
                    defaultValue={reprogramar ?? localParts(a.startsAt, tz).date}
                  />
                </Field>
                <button className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2">
                  Ver horas
                </button>
              </form>
              {reprogramar && slots.length === 0 && (
                <p className="text-sm text-muted">Sin horas libres ese día para {a.barber.displayName}.</p>
              )}
              {slots.length > 0 && (
                <ActionForm action={rescheduleAction} submitLabel="Reprogramar">
                  <input type="hidden" name="appointmentId" value={a.id} />
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                    {slots.map((s, i) => (
                      <label key={s.toISOString()} className="cursor-pointer">
                        <input
                          type="radio"
                          name="startsAt"
                          value={s.toISOString()}
                          defaultChecked={i === 0}
                          className="peer sr-only"
                        />
                        <span className="block rounded-lg border border-line bg-surface-2 py-2 text-center text-sm peer-checked:border-accent peer-checked:text-accent">
                          {formatTime(s, tz)}
                        </span>
                      </label>
                    ))}
                  </div>
                </ActionForm>
              )}
            </Card>
          )}

          {can(ctx.role, "messages.send") && (
            <Card className="space-y-3">
              <h2 className="heading-section">Enviar mensaje</h2>
              <ActionForm action={sendManualMessageAction} submitLabel="Enviar" resetOnSuccess>
                <input type="hidden" name="customerId" value={a.customer.id} />
                <input type="hidden" name="appointmentId" value={a.id} />
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="channel" value="WHATSAPP" defaultChecked /> WhatsApp
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="channel" value="EMAIL" disabled={!a.customer.email} /> Correo
                  </label>
                </div>
                <Textarea name="body" required defaultValue={"Hola {{customer_name}}, "} />
                <p className="text-xs text-muted">
                  Variables:{" "}
                  {
                    "{{customer_name}} {{appointment_date}} {{appointment_time}} {{barber_name}} {{management_url}}"
                  }
                </p>
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {a.payments.length > 0 && (
            <Card>
              <h2 className="mb-3 heading-section">Pagos</h2>
              <ul className="space-y-2 text-sm">
                {a.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span>
                      {formatMoney(p.amount, p.currency)} ·{" "}
                      {p.provider === "FAKE" ? "Simulado (dev)" : "Mercado Pago"}
                    </span>
                    <PaymentStatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <h2 className="mb-3 heading-section">Mensajes</h2>
            {a.notifications.length === 0 && <p className="text-sm text-muted">Sin mensajes.</p>}
            <ul className="space-y-2 text-sm">
              {a.notifications.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {n.channel === "WHATSAPP" ? "WhatsApp" : "Correo"} ·{" "}
                    {n.trigger === "manual" ? "Manual" : n.trigger}
                  </span>
                  <NotificationStatusBadge status={n.status} />
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-3 heading-section">Historial</h2>
            <ol className="space-y-2 text-sm">
              {a.events.map((e) => (
                <li key={e.id} className="flex justify-between gap-2">
                  <span>{EVENT_LABELS[e.type] ?? e.type.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted">{formatDateTime(e.createdAt, tz)}</span>
                </li>
              ))}
            </ol>
          </Card>
          {manage && (
            <Card className="space-y-2">
              <h2 className="heading-section">Enlace del cliente</h2>
              <p className="text-xs text-muted">
                Si el cliente compartió su enlace de gestión por error, revócalo: los próximos mensajes
                llevarán uno nuevo.
              </p>
              <ActionForm
                action={revokeLinkAction}
                submitLabel="Revocar enlace"
                variant="danger"
                confirm="¿Revocar el enlace de gestión actual?"
              >
                <input type="hidden" name="appointmentId" value={a.id} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Transition({
  id,
  name,
  label,
  variant = "secondary",
  confirm,
}: {
  id: string;
  name: string;
  label: string;
  variant?: "secondary" | "danger" | "primary";
  confirm?: string;
}) {
  return (
    <ActionForm
      action={appointmentTransitionAction}
      submitLabel={label}
      variant={variant}
      inline
      confirm={confirm}
    >
      <input type="hidden" name="appointmentId" value={id} />
      <input type="hidden" name="transition" value={name} />
    </ActionForm>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow text-subtle">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
