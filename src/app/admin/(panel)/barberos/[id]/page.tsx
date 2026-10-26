import { getBarber, listServices } from "@/modules/catalog";
import { requireAuth } from "@/modules/identity";
import { getWeeklyHours, listScheduleExceptions } from "@/modules/scheduling";
import { listBranches } from "@/modules/tenancy";
import { orNotFound } from "@/server/page";
import { ActionForm } from "@/components/action-form";
import { Card, Checkbox, Field, Input, PageHeader, Select } from "@/components/ui";
import { formatDateTime, minutesToHHMM } from "@/shared/time";
import {
  addExceptionAction,
  removeExceptionAction,
  saveBarberAction,
  saveWeeklyHoursAction,
} from "../../../actions";

export const metadata = { title: "Barbero" };

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default async function BarberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth("barbers.manage");
  const { id } = await params;
  const [barber, branches, services, hours, exceptions] = await Promise.all([
    orNotFound(getBarber(ctx, id)),
    listBranches(ctx),
    listServices(ctx),
    getWeeklyHours(ctx, id),
    listScheduleExceptions(ctx, { from: new Date(), barberId: id }),
  ]);
  const assignedBranches = barber.branches.map((b) => b.branch);

  return (
    <>
      <PageHeader
        title={barber.displayName}
        description="Perfil, horario semanal, pausas, vacaciones y ausencias."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 heading-section">Perfil</h2>
          <ActionForm action={saveBarberAction}>
            <input type="hidden" name="id" value={barber.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre visible">
                <Input name="displayName" defaultValue={barber.displayName} required />
              </Field>
              <Field label="Comisión (%)">
                <Input
                  name="commissionPercent"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  defaultValue={barber.commissionBps / 100}
                />
              </Field>
            </div>
            <Field label="Bio">
              <Input name="bio" defaultValue={barber.bio ?? ""} />
            </Field>
            <Field label="URL de foto (opcional)">
              <Input name="photoUrl" type="url" defaultValue={barber.photoUrl ?? ""} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-1.5">
                <legend className="mb-2 text-sm font-medium text-ink/90">Sucursales</legend>
                {branches.map((b) => (
                  <Checkbox
                    key={b.id}
                    name="branchIds"
                    value={b.id}
                    defaultChecked={assignedBranches.some((x) => x.id === b.id)}
                    label={b.name}
                  />
                ))}
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="mb-2 text-sm font-medium text-ink/90">Servicios</legend>
                {services.map((s) => (
                  <Checkbox
                    key={s.id}
                    name="serviceIds"
                    value={s.id}
                    defaultChecked={barber.services.some((x) => x.serviceId === s.id)}
                    label={s.name}
                  />
                ))}
              </fieldset>
            </div>
            <Checkbox name="active" defaultChecked={barber.active} label="Activo (recibe reservas)" />
          </ActionForm>
        </Card>

        <div className="space-y-6">
          {assignedBranches.map((branch) => {
            const rows = hours.filter((h) => h.branchId === branch.id);
            return (
              <Card key={branch.id}>
                <h2 className="mb-1 heading-section">Horario · {branch.name}</h2>
                <p className="mb-4 text-xs text-muted">
                  Hora local de la sucursal ({branch.timezone}). Usa la segunda franja para modelar la pausa
                  de almuerzo. Deja vacío los días libres.
                </p>
                <ActionForm action={saveWeeklyHoursAction} submitLabel="Guardar horario">
                  <input type="hidden" name="barberId" value={barber.id} />
                  <input type="hidden" name="branchId" value={branch.id} />
                  <div className="space-y-2">
                    {ORDER.map((wd) => {
                      const day = rows.filter((r) => r.weekday === wd);
                      return (
                        <div key={wd} className="grid grid-cols-[90px_1fr_1fr] items-center gap-2 text-sm">
                          <span className="text-muted">{DAYS[wd]}</span>
                          {[0, 1].map((i) => (
                            <span key={i} className="flex items-center gap-1">
                              <Input
                                type="time"
                                name={`d${wd}_s${i + 1}_start`}
                                defaultValue={day[i] ? minutesToHHMM(day[i].startMinute) : ""}
                                className="px-2"
                              />
                              <span className="text-muted">–</span>
                              <Input
                                type="time"
                                name={`d${wd}_s${i + 1}_end`}
                                defaultValue={
                                  day[i]
                                    ? day[i].endMinute === 1440
                                      ? "23:59"
                                      : minutesToHHMM(day[i].endMinute)
                                    : ""
                                }
                                className="px-2"
                              />
                            </span>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </ActionForm>
              </Card>
            );
          })}
          {assignedBranches.length === 0 && (
            <Card className="text-sm text-muted">Asigna al menos una sucursal para definir el horario.</Card>
          )}

          <Card>
            <h2 className="mb-4 heading-section">Vacaciones, ausencias y horas extra</h2>
            <ActionForm action={addExceptionAction} submitLabel="Agregar" resetOnSuccess>
              <input type="hidden" name="barberId" value={barber.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Tipo">
                  <Select name="type">
                    <option value="TIME_OFF">Ausencia / vacaciones / bloqueo</option>
                    <option value="EXTRA_HOURS">Horas extra</option>
                  </Select>
                </Field>
                <Field label="Sucursal (horas extra)">
                  <Select name="branchId">
                    {assignedBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Motivo">
                  <Input name="reason" placeholder="Vacaciones, médico…" />
                </Field>
                <Field label="Desde (fecha)">
                  <Input type="date" name="date" required />
                </Field>
                <Field label="Hasta (fecha)" hint="Vacío = mismo día">
                  <Input type="date" name="endDate" />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Hora inicio">
                    <Input type="time" name="start" defaultValue="00:00" />
                  </Field>
                  <Field label="Hora fin">
                    <Input type="time" name="end" defaultValue="23:59" />
                  </Field>
                </div>
              </div>
            </ActionForm>
            <ul className="mt-4 divide-y divide-line text-sm">
              {exceptions.map((ex) => (
                <li key={ex.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {ex.type === "EXTRA_HOURS" ? "Horas extra" : "Ausencia"}:{" "}
                    {formatDateTime(ex.startsAt, ctx.timezone)} → {formatDateTime(ex.endsAt, ctx.timezone)}
                    {ex.reason ? ` · ${ex.reason}` : ""}
                  </span>
                  <ActionForm action={removeExceptionAction} submitLabel="Quitar" variant="ghost" inline>
                    <input type="hidden" name="id" value={ex.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
