import { getBarber } from "@/modules/catalog";
import { requireAuth } from "@/modules/identity";
import { listScheduleExceptions } from "@/modules/scheduling";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/shared/time";
import {
  addExceptionAction,
  changePasswordAction,
  removeExceptionAction,
  updateOwnProfileAction,
} from "../../admin/actions";

export const metadata = { title: "Mi perfil" };

export default async function BarberProfilePage() {
  const ctx = await requireAuth("barber.portal");
  const barberId = ctx.barberId!;
  const [barber, exceptions] = await Promise.all([
    getBarber(ctx, barberId),
    listScheduleExceptions(ctx, { from: new Date(), barberId }),
  ]);

  return (
    <>
      <PageHeader title={barber.displayName} description="Tu perfil público y tus bloqueos de horario." />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Perfil público</h2>
          <ActionForm action={updateOwnProfileAction}>
            <Field label="Bio">
              <Input name="bio" defaultValue={barber.bio ?? ""} maxLength={400} />
            </Field>
            <Field label="URL de foto">
              <Input name="photoUrl" type="url" defaultValue={barber.photoUrl ?? ""} />
            </Field>
          </ActionForm>
        </Card>
        <Card>
          <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Bloquear mi horario</h2>
          <ActionForm action={addExceptionAction} submitLabel="Bloquear" resetOnSuccess>
            <input type="hidden" name="barberId" value={barberId} />
            <input type="hidden" name="type" value="TIME_OFF" />
            <div className="grid grid-cols-3 gap-2">
              <Field label="Fecha">
                <Input type="date" name="date" required />
              </Field>
              <Field label="Desde">
                <Input type="time" name="start" defaultValue="13:00" />
              </Field>
              <Field label="Hasta">
                <Input type="time" name="end" defaultValue="14:00" />
              </Field>
            </div>
            <Field label="Motivo">
              <Input name="reason" />
            </Field>
          </ActionForm>
          <ul className="mt-4 divide-y divide-line text-sm">
            {exceptions.map((ex) => (
              <li key={ex.id} className="flex items-center justify-between gap-2 py-2">
                <span>
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
        <Card>
          <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Contraseña</h2>
          <ActionForm action={changePasswordAction} submitLabel="Cambiar" resetOnSuccess>
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
      </div>
    </>
  );
}
