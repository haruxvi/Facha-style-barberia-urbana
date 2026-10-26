import { randomUUID } from "node:crypto";
import { getBookableService, listBarbers, listPublicServices } from "@/modules/catalog";
import { requireAuth } from "@/modules/identity";
import { loadAvailability } from "@/modules/scheduling";
import { listBranches } from "@/modules/tenancy";
import { ActionForm } from "@/components/action-form";
import { Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { formatMoney } from "@/shared/money";
import { formatTime, isLocalDate, todayIn } from "@/shared/time";
import { createManualBookingAction } from "../../../actions";

export const metadata = { title: "Nueva reserva" };

type SP = { sucursal?: string; servicio?: string; barbero?: string; fecha?: string };

/** Alta manual: 1) elegir sucursal/servicio/barbero/fecha (GET) 2) elegir hora libre + datos del cliente. */
function notInThePast<T extends { startsAt: Date }>(slots: T[]): T[] {
  const limit = Date.now() - 15 * 60000;
  return slots.filter((s) => s.startsAt.getTime() > limit);
}

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAuth("appointments.manage");
  const sp = await searchParams;
  const branches = (await listBranches(ctx)).filter((b) => b.active);
  const branchId = branches.find((b) => b.id === sp.sucursal)?.id ?? branches[0]?.id;
  const services = branchId ? await listPublicServices(ctx.tenantId, branchId) : [];
  const serviceId = services.find((s) => s.id === sp.servicio)?.id;
  const barbers = (await listBarbers(ctx)).filter(
    (b) => b.active && (!serviceId || b.services.some((s) => s.serviceId === serviceId)),
  );
  const barberId = barbers.find((b) => b.id === sp.barbero)?.id ?? "";
  const date = sp.fecha && isLocalDate(sp.fecha) ? sp.fecha : todayIn(ctx.timezone);

  let slots: { startsAt: Date; barberIds: string[] }[] = [];
  let tz = ctx.timezone;
  if (branchId && serviceId) {
    const service = await getBookableService(ctx.tenantId, branchId, serviceId);
    if (service) {
      // El personal puede reservar sin antelación mínima, pero siempre dentro del horario y sin solapes.
      const r = await loadAvailability({
        tenantId: ctx.tenantId,
        branchId,
        service,
        barberId: barberId || null,
        date,
        ignoreBookingWindow: true,
      });
      slots = notInThePast(r.slots);
      tz = r.timezone;
    }
  }

  return (
    <>
      <PageHeader title="Nueva reserva" description="Reserva manual desde el mostrador o por teléfono." />
      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-5 sm:items-end">
          <Field label="Sucursal">
            <Select name="sucursal" defaultValue={branchId}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Servicio">
            <Select name="servicio" defaultValue={serviceId ?? ""} required>
              <option value="">Elegir…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {formatMoney(s.priceAmount, ctx.currency)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Barbero">
            <Select name="barbero" defaultValue={barberId}>
              <option value="">Cualquiera</option>
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha">
            <Input type="date" name="fecha" defaultValue={date} />
          </Field>
          <button className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2">
            Ver horas libres
          </button>
        </form>
      </Card>

      {serviceId && (
        <Card>
          {slots.length === 0 ? (
            <EmptyState>No hay horas libres ese día con esos filtros.</EmptyState>
          ) : (
            <ActionForm action={createManualBookingAction} submitLabel="Crear reserva">
              <input type="hidden" name="branchId" value={branchId} />
              <input type="hidden" name="serviceId" value={serviceId} />
              <input type="hidden" name="barberId" value={barberId} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <div>
                <div className="mb-2 text-sm font-medium text-ink/90">Hora</div>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                  {slots.map((s, i) => (
                    <label key={s.startsAt.toISOString()} className="cursor-pointer">
                      <input
                        type="radio"
                        name="startsAt"
                        value={s.startsAt.toISOString()}
                        required
                        defaultChecked={i === 0}
                        className="peer sr-only"
                      />
                      <span className="block rounded-lg border border-line bg-surface-2 py-2 text-center text-sm peer-checked:border-accent peer-checked:bg-accent/15 peer-checked:text-accent">
                        {formatTime(s.startsAt, tz)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Nombre del cliente">
                  <Input name="name" required minLength={2} />
                </Field>
                <Field label="WhatsApp">
                  <Input name="phone" type="tel" required placeholder="+56 9 1234 5678" />
                </Field>
                <Field label="Correo (opcional)">
                  <Input name="email" type="email" />
                </Field>
              </div>
              <Field label="Nota">
                <Textarea name="notes" maxLength={300} />
              </Field>
              <div className="space-y-2">
                <Checkbox
                  name="consentWhatsapp"
                  defaultChecked
                  label="El cliente acepta recibir confirmación y recordatorio por WhatsApp"
                />
                <Checkbox name="consentEmail" label="El cliente acepta recibirlos por correo" />
              </div>
            </ActionForm>
          )}
        </Card>
      )}
    </>
  );
}
