import { requireAuth } from "@/modules/identity";
import { getIntegrationStatus, getTenantSettings, listQrCampaigns } from "@/modules/tenancy";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Checkbox, Field, Input, PageHeader, Select, Table, Textarea } from "@/components/ui";
import { appUrl } from "@/shared/env";
import {
  changePasswordAction,
  createQrCampaignAction,
  createTenantAction,
  saveIntegrationAction,
  saveSettingsAction,
} from "../../actions";

export const metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const ctx = await requireAuth("settings.manage");
  const [t, integrations, campaigns] = await Promise.all([
    getTenantSettings(ctx),
    getIntegrationStatus(ctx),
    listQrCampaigns(ctx),
  ]);
  const wa = integrations.find((i) => i.kind === "WHATSAPP")!;
  const mp = integrations.find((i) => i.kind === "MERCADOPAGO")!;

  return (
    <>
      <PageHeader title="Configuración" description={`Página pública: ${appUrl(`/b/${t.slug}`)}`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 heading-section">Barbería y reglas de reserva</h2>
          <ActionForm action={saveSettingsAction}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre">
                <Input name="name" defaultValue={t.name} required />
              </Field>
              <Field label="Teléfono público">
                <Input name="publicPhone" defaultValue={t.publicPhone ?? ""} />
              </Field>
              <Field label="Instagram">
                <Input name="instagram" defaultValue={t.instagram ?? ""} />
              </Field>
              <Field label="Zona horaria">
                <Input name="timezone" defaultValue={t.timezone} required />
              </Field>
              <Field label="Moneda (ISO)">
                <Input name="currency" defaultValue={t.currency} maxLength={3} required />
              </Field>
              <Field label="Intervalo entre horas (min)">
                <Input
                  name="slotIntervalMinutes"
                  type="number"
                  min={5}
                  max={120}
                  defaultValue={t.slotIntervalMinutes}
                />
              </Field>
              <Field label="Antelación mínima (min)">
                <Input name="minNoticeMinutes" type="number" min={0} defaultValue={t.minNoticeMinutes} />
              </Field>
              <Field label="Reservar hasta (días)">
                <Input
                  name="bookingHorizonDays"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={t.bookingHorizonDays}
                />
              </Field>
              <Field label="Cancelar en línea hasta (horas antes)">
                <Input
                  name="cancellationHours"
                  type="number"
                  min={0}
                  defaultValue={Math.round(t.cancellationWindowMinutes / 60)}
                />
              </Field>
              <Field label="Reprogramar hasta (horas antes)">
                <Input
                  name="rescheduleHours"
                  type="number"
                  min={0}
                  defaultValue={Math.round(t.rescheduleWindowMinutes / 60)}
                />
              </Field>
            </div>
            <Field label="Descripción pública">
              <Textarea name="description" defaultValue={t.description ?? ""} />
            </Field>
            <div className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-3">
              <Field label="Pago online" className="sm:col-span-3">
                <Select name="paymentPolicy" defaultValue={t.paymentPolicy}>
                  <option value="NONE">No: se paga en el local</option>
                  <option value="OPTIONAL">Opcional: el cliente elige</option>
                  <option value="DEPOSIT_REQUIRED">Seña obligatoria</option>
                  <option value="FULL_REQUIRED">Pago total obligatorio</option>
                </Select>
              </Field>
              <Field label={`Seña (${t.currency})`}>
                <Input name="depositAmount" type="number" min={0} defaultValue={t.depositAmount} />
              </Field>
              <Field label="Tiempo para pagar (min)">
                <Input name="holdMinutes" type="number" min={5} max={120} defaultValue={t.holdMinutes} />
              </Field>
            </div>
            <Field label="Condiciones de reserva (visibles al reservar)">
              <Textarea name="bookingTerms" defaultValue={t.bookingTerms ?? ""} />
            </Field>
          </ActionForm>
        </Card>

        <div className="space-y-6">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="heading-section">WhatsApp Business (Cloud API)</h2>
              {wa.enabled ? <Badge tone="ok">Activo</Badge> : <Badge>Inactivo</Badge>}
            </div>
            <p className="mb-3 text-xs text-muted">
              Webhook: <code>{appUrl("/api/webhooks/whatsapp")}</code>. El App Secret y el verify token son de
              la plataforma (variables de entorno). Sin credenciales, en desarrollo los envíos se simulan y se
              marcan como tales.
            </p>
            <ActionForm action={saveIntegrationAction}>
              <input type="hidden" name="kind" value="WHATSAPP" />
              <Field label="Phone number ID">
                <Input name="externalAccountId" defaultValue={wa.externalAccountId ?? ""} />
              </Field>
              <Field
                label="Access token"
                hint={
                  wa.secretsConfigured.includes("accessToken")
                    ? "Configurado · deja vacío para conservarlo"
                    : wa.envFallback
                      ? "Se usará el de las variables de entorno"
                      : "No configurado"
                }
              >
                <Input name="accessToken" type="password" autoComplete="off" />
              </Field>
              <Checkbox name="enabled" defaultChecked={wa.enabled} label="Habilitar" />
            </ActionForm>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="heading-section">Mercado Pago</h2>
              {mp.enabled ? <Badge tone="ok">Activo</Badge> : <Badge>Inactivo</Badge>}
            </div>
            <p className="mb-3 text-xs text-muted">
              Los cobros van a la cuenta de esta barbería. URL de notificaciones (configurada automáticamente
              en cada checkout): <code>{appUrl(`/api/webhooks/mercadopago/${ctx.tenantId}`)}</code>
            </p>
            <ActionForm action={saveIntegrationAction}>
              <input type="hidden" name="kind" value="MERCADOPAGO" />
              <Field
                label="Access token"
                hint={
                  mp.secretsConfigured.includes("accessToken")
                    ? "Configurado · deja vacío para conservarlo"
                    : "Usa primero el de pruebas (TEST-…)"
                }
              >
                <Input name="accessToken" type="password" autoComplete="off" />
              </Field>
              <Field
                label="Clave secreta de webhooks"
                hint={
                  mp.secretsConfigured.includes("webhookSecret")
                    ? "Configurada"
                    : "Sin ella los webhooks se rechazan"
                }
              >
                <Input name="webhookSecret" type="password" autoComplete="off" />
              </Field>
              <Checkbox name="enabled" defaultChecked={mp.enabled} label="Habilitar" />
            </ActionForm>
          </Card>
        </div>
      </div>

      <h2 className="mb-3 mt-10 heading-section">Códigos QR</h2>
      <p className="mb-4 text-sm text-muted">
        Apuntan a tu página pública con un código de campaña para medir visitas y reservas. No contienen datos
        personales ni dan permisos.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Campaña</th>
            <th>URL</th>
            <th>Visitas</th>
            <th>Reservas</th>
            <th>Descargar</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td>{c.label}</td>
              <td className="text-xs text-muted">{c.url}</td>
              <td>{c.visits}</td>
              <td>{c.bookings}</td>
              <td className="space-x-3 whitespace-nowrap">
                <a className="text-accent hover:underline" href={`/admin/qr/${c.code}?formato=svg`}>
                  SVG
                </a>
                <a className="text-accent hover:underline" href={`/admin/qr/${c.code}?formato=png`}>
                  PNG
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Card className="mt-4">
        <ActionForm
          action={createQrCampaignAction}
          submitLabel="Crear campaña"
          resetOnSuccess
          className="grid gap-3 sm:grid-cols-3 sm:items-end"
        >
          <Field label="Nombre">
            <Input name="label" placeholder="Volante verano" required />
          </Field>
          <Field label="Código">
            <Input name="code" placeholder="volante-verano" pattern="[a-z0-9-]{1,40}" required />
          </Field>
        </ActionForm>
      </Card>

      <div className="mt-10 grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 heading-section">Mi contraseña</h2>
          <ActionForm action={changePasswordAction} submitLabel="Cambiar contraseña" resetOnSuccess>
            <Field label="Actual">
              <Input name="current" type="password" required autoComplete="current-password" />
            </Field>
            <Field label="Nueva">
              <Input name="next" type="password" required minLength={10} autoComplete="new-password" />
            </Field>
            <Field label="Repetir">
              <Input name="confirm" type="password" required minLength={10} autoComplete="new-password" />
            </Field>
          </ActionForm>
        </Card>
        <Card>
          <h2 className="mb-4 heading-section">Agregar otra barbería</h2>
          <p className="mb-3 text-xs text-muted">
            Quedarás como dueño. Sus datos estarán completamente separados de esta.
          </p>
          <ActionForm action={createTenantAction} submitLabel="Crear barbería">
            <Field label="Nombre">
              <Input name="name" required />
            </Field>
            <Field label="Identificador para la URL">
              <Input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
