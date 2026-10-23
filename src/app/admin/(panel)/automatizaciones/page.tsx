import { listAutomationRules } from "@/modules/automation";
import { requireAuth } from "@/modules/identity";
import { listTemplates, previewTemplate, TEMPLATE_VARIABLES } from "@/modules/messaging";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Checkbox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { saveTemplateAction, updateRuleAction } from "../../actions";

export const metadata = { title: "Automatizaciones" };

const TRIGGERS: Record<string, { label: string; offset?: string }> = {
  BOOKING_CONFIRMED: { label: "Confirmación al reservar" },
  REMINDER: { label: "Recordatorio", offset: "antes de la cita" },
  RESCHEDULED: { label: "Aviso de cambio de hora" },
  CANCELLED: { label: "Aviso de cancelación" },
  POST_VISIT: { label: "Mensaje post-atención", offset: "después de completar" },
  REVIEW_REQUEST: { label: "Solicitud de reseña", offset: "después de completar" },
  INACTIVE_FOLLOWUP: {
    label: "Clientes inactivos (requiere consentimiento de promociones)",
    offset: "sin visitar",
  },
  OWNER_NEW_BOOKING: { label: "Aviso interno al dueño: nueva reserva" },
};

function splitOffset(min: number): { value: number; unit: string } {
  if (min > 0 && min % 1440 === 0) return { value: min / 1440, unit: "days" };
  if (min > 0 && min % 60 === 0) return { value: min / 60, unit: "hours" };
  return { value: min, unit: "minutes" };
}

export default async function AutomationsPage() {
  const ctx = await requireAuth("automations.manage");
  const [rules, templates] = await Promise.all([listAutomationRules(ctx), listTemplates(ctx)]);

  return (
    <>
      <PageHeader
        title="Automatizaciones"
        description="Se ejecutan con la cola de trabajos (Vercel Cron). Antes de enviar, cada mensaje revisa el estado actual de la reserva y el consentimiento."
      />
      <div className="space-y-3">
        {rules.map((r) => {
          const meta = TRIGGERS[r.trigger] ?? { label: r.trigger };
          const off = splitOffset(r.offsetMinutes);
          const options = templates.filter((t) => t.channel === r.channel);
          return (
            <Card key={r.id} className="p-4">
              <ActionForm
                action={updateRuleAction}
                submitLabel="Guardar"
                variant="secondary"
                className="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="ruleId" value={r.id} />
                <div className="min-w-56 flex-1">
                  <div className="font-semibold">{meta.label}</div>
                  <div className="mt-1">
                    <Badge tone={r.channel === "WHATSAPP" ? "ok" : "info"}>
                      {r.channel === "WHATSAPP" ? "WhatsApp" : "Correo"}
                    </Badge>
                  </div>
                </div>
                <Checkbox name="active" defaultChecked={r.active} label="Activa" />
                {meta.offset ? (
                  <div className="flex items-end gap-1">
                    <Field label="Tiempo">
                      <Input name="offset" type="number" min={0} defaultValue={off.value} className="w-20" />
                    </Field>
                    <Select name="unit" defaultValue={off.unit} className="w-28">
                      <option value="minutes">minutos</option>
                      <option value="hours">horas</option>
                      <option value="days">días</option>
                    </Select>
                    <span className="pb-2 text-xs text-muted">{meta.offset}</span>
                  </div>
                ) : (
                  <input type="hidden" name="offset" value="0" />
                )}
                <Field label="Plantilla">
                  <Select name="templateKey" defaultValue={r.templateKey} className="w-52">
                    {options.map((t) => (
                      <option key={t.id} value={t.key}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </ActionForm>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-3 mt-10 font-display text-xl uppercase tracking-wide">Plantillas</h2>
      <p className="mb-4 text-sm text-muted">
        Variables: {TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}. Para WhatsApp fuera de la ventana de
        24 h indica el nombre de la plantilla aprobada en Meta: sus parámetros se envían en el orden en que
        aparecen las variables.
      </p>
      <div className="space-y-3">
        {templates.map((t) => (
          <details key={t.id} className="rounded-xl border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-3">
              <span>
                <span className="font-medium">{t.name}</span>{" "}
                <span className="text-xs text-muted">({t.key})</span>
              </span>
              <span className="flex gap-2">
                <Badge tone={t.channel === "WHATSAPP" ? "ok" : "info"}>
                  {t.channel === "WHATSAPP" ? "WhatsApp" : "Correo"}
                </Badge>
                {t.channel === "WHATSAPP" &&
                  (t.waTemplateName ? (
                    <Badge tone="accent">Meta: {t.waTemplateName}</Badge>
                  ) : (
                    <Badge tone="warn">Sin plantilla Meta</Badge>
                  ))}
              </span>
            </summary>
            <div className="space-y-4 border-t border-line p-5">
              <ActionForm action={saveTemplateAction}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="key" value={t.key} />
                <input type="hidden" name="channel" value={t.channel} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nombre">
                    <Input name="name" defaultValue={t.name} required />
                  </Field>
                  {t.channel === "EMAIL" ? (
                    <Field label="Asunto">
                      <Input name="subject" defaultValue={t.subject ?? ""} />
                    </Field>
                  ) : (
                    <div className="grid grid-cols-[1fr_80px] gap-2">
                      <Field label="Plantilla aprobada en Meta">
                        <Input
                          name="waTemplateName"
                          defaultValue={t.waTemplateName ?? ""}
                          placeholder="ej. recordatorio_cita"
                        />
                      </Field>
                      <Field label="Idioma">
                        <Input name="waLanguage" defaultValue={t.waLanguage ?? "es"} />
                      </Field>
                    </div>
                  )}
                </div>
                <Field label="Texto">
                  <Textarea name="body" defaultValue={t.body} required />
                </Field>
                <Checkbox name="active" defaultChecked={t.active} label="Activa" />
              </ActionForm>
              <div className="rounded-lg bg-surface-2 p-3 text-sm">
                <div className="mb-1 text-xs uppercase tracking-wider text-muted">
                  Vista previa (datos de ejemplo)
                </div>
                {previewTemplate(t.body)}
              </div>
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
