import Link from "next/link";
import { getCustomerDetail } from "@/modules/crm";
import { can, requireAuth } from "@/modules/identity";
import { orNotFound } from "@/server/page";
import { ActionForm } from "@/components/action-form";
import {
  AppointmentStatusBadge,
  Badge,
  Card,
  Field,
  Input,
  NotificationStatusBadge,
  PageHeader,
  Textarea,
} from "@/components/ui";
import { formatMoney } from "@/shared/money";
import { formatDateTime } from "@/shared/time";
import {
  anonymizeCustomerAction,
  sendManualMessageAction,
  setConsentAction,
  updateCustomerAction,
} from "../../../actions";

export const metadata = { title: "Cliente" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth("customers.view");
  const { id } = await params;
  const c = await orNotFound(getCustomerDetail(ctx, id));
  const canManage = can(ctx.role, "customers.manage");
  const consent = (channel: "WHATSAPP" | "EMAIL", purpose: "TRANSACTIONAL" | "MARKETING") =>
    c.consents.find((x) => x.channel === channel && x.purpose === purpose);

  return (
    <>
      <PageHeader
        title={c.name}
        description={`${c.phoneE164}${c.email ? ` · ${c.email}` : ""}`}
        actions={
          canManage && (
            <a
              href={`/admin/clientes/${c.id}/exportar`}
              className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2"
            >
              Exportar datos (JSON)
            </a>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs uppercase text-muted">Visitas</div>
              <div className="font-display text-2xl">{c.visitCount}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase text-muted">Frecuencia</div>
              <div className="font-display text-2xl">
                {c.stats.avgDaysBetween ? `${c.stats.avgDaysBetween} d` : "—"}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase text-muted">Ausencias</div>
              <div className="font-display text-2xl">{c.noShowCount}</div>
            </Card>
          </div>
          <Card>
            <h2 className="mb-3 font-display text-lg uppercase tracking-wide">Historial de reservas</h2>
            <ul className="divide-y divide-line text-sm">
              {c.appointments.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/admin/reservas/${a.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:text-accent"
                  >
                    <span>
                      <span className="first-letter:uppercase">
                        {formatDateTime(a.startsAt, ctx.timezone)}
                      </span>
                      <span className="block text-xs text-muted">
                        {a.serviceName} · {a.barber.displayName} · {formatMoney(a.priceAmount, a.currency)}
                      </span>
                    </span>
                    <AppointmentStatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {can(ctx.role, "messages.send") && (
            <Card>
              <h2 className="mb-3 font-display text-lg uppercase tracking-wide">Enviar mensaje</h2>
              <ActionForm action={sendManualMessageAction} submitLabel="Enviar" resetOnSuccess>
                <input type="hidden" name="customerId" value={c.id} />
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="channel" value="WHATSAPP" defaultChecked /> WhatsApp
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="channel" value="EMAIL" disabled={!c.email} /> Correo
                  </label>
                </div>
                <Textarea name="body" required defaultValue={"Hola {{customer_name}}, "} />
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-display text-lg uppercase tracking-wide">Comunicaciones</h2>
            <p className="mb-3 text-xs text-muted">
              Cada canal y finalidad se registra por separado y se puede revocar en cualquier momento.
            </p>
            <ul className="space-y-3 text-sm">
              {(["WHATSAPP", "EMAIL"] as const).flatMap((ch) =>
                (["TRANSACTIONAL", "MARKETING"] as const).map((p) => {
                  const cs = consent(ch, p);
                  return (
                    <li key={`${ch}${p}`} className="flex items-center justify-between gap-2">
                      <span>
                        {ch === "WHATSAPP" ? "WhatsApp" : "Correo"} ·{" "}
                        {p === "TRANSACTIONAL" ? "reservas" : "promociones"}
                        <span className="ml-2">
                          {cs?.granted ? <Badge tone="ok">Sí</Badge> : <Badge>No</Badge>}
                        </span>
                      </span>
                      {canManage && (
                        <ActionForm
                          action={setConsentAction}
                          submitLabel={cs?.granted ? "Revocar" : "Registrar"}
                          variant="ghost"
                          inline
                        >
                          <input type="hidden" name="customerId" value={c.id} />
                          <input type="hidden" name="channel" value={ch} />
                          <input type="hidden" name="purpose" value={p} />
                          <input type="hidden" name="granted" value={cs?.granted ? "false" : "true"} />
                        </ActionForm>
                      )}
                    </li>
                  );
                }),
              )}
            </ul>
          </Card>
          {canManage && (
            <Card>
              <h2 className="mb-3 font-display text-lg uppercase tracking-wide">Ficha</h2>
              <ActionForm action={updateCustomerAction}>
                <input type="hidden" name="customerId" value={c.id} />
                <Field label="Nombre">
                  <Input name="name" defaultValue={c.name} required />
                </Field>
                <Field label="Correo">
                  <Input name="email" type="email" defaultValue={c.email ?? ""} />
                </Field>
                <Field label="Preferencias">
                  <Textarea
                    name="preferences"
                    defaultValue={c.preferences ?? ""}
                    placeholder="Ej: fade bajo, tijera arriba, no le gusta la navaja"
                  />
                </Field>
                <Field label="Notas internas">
                  <Textarea name="notes" defaultValue={c.notes ?? ""} />
                </Field>
              </ActionForm>
            </Card>
          )}
          <Card>
            <h2 className="mb-3 font-display text-lg uppercase tracking-wide">Mensajes recientes</h2>
            <ul className="space-y-2 text-sm">
              {c.notifications.length === 0 && <li className="text-muted">Sin mensajes.</li>}
              {c.notifications.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{n.body.slice(0, 60) || n.trigger}</span>
                  <NotificationStatusBadge status={n.status} />
                </li>
              ))}
            </ul>
          </Card>
          {canManage && (
            <Card className="border-danger/30">
              <h2 className="mb-2 font-display text-lg uppercase tracking-wide text-danger">
                Suprimir datos
              </h2>
              <p className="mb-3 text-xs text-muted">
                Anonimiza nombre, teléfono, correo y mensajes. Las citas se conservan sin datos personales
                para la contabilidad. No se puede deshacer.
              </p>
              <ActionForm
                action={anonymizeCustomerAction}
                submitLabel="Anonimizar cliente"
                variant="danger"
                confirm="Esta acción es irreversible. ¿Anonimizar?"
              >
                <input type="hidden" name="customerId" value={c.id} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
