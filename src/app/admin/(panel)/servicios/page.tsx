import { listBarbers, listServices } from "@/modules/catalog";
import { requireAuth } from "@/modules/identity";
import { listBranches } from "@/modules/tenancy";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Checkbox, Field, Input, PageHeader } from "@/components/ui";
import { formatMoney } from "@/shared/money";
import { saveServiceAction } from "../../actions";

export const metadata = { title: "Servicios" };

type ServiceRow = Awaited<ReturnType<typeof listServices>>[number];

export default async function ServicesPage() {
  const ctx = await requireAuth("catalog.manage");
  const [services, branches, barbers] = await Promise.all([
    listServices(ctx),
    listBranches(ctx),
    listBarbers(ctx),
  ]);

  const form = (s?: ServiceRow) => (
    <ActionForm
      action={saveServiceAction}
      submitLabel={s ? "Guardar cambios" : "Crear servicio"}
      resetOnSuccess={!s}
    >
      {s && <input type="hidden" name="id" value={s.id} />}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Nombre" className="sm:col-span-2">
          <Input name="name" defaultValue={s?.name} required />
        </Field>
        <Field label={`Precio (${ctx.currency})`} hint="CLP en pesos enteros">
          <Input name="priceAmount" type="number" min={0} step={1} defaultValue={s?.priceAmount} required />
        </Field>
        <Field label="Orden">
          <Input name="sortOrder" type="number" defaultValue={s?.sortOrder ?? 0} />
        </Field>
        <Field label="Duración (min)">
          <Input
            name="durationMinutes"
            type="number"
            min={5}
            max={720}
            defaultValue={s?.durationMinutes ?? 30}
            required
          />
        </Field>
        <Field label="Tiempo entre citas (min)">
          <Input name="bufferMinutes" type="number" min={0} max={240} defaultValue={s?.bufferMinutes ?? 10} />
        </Field>
        <Field label="Descripción" className="sm:col-span-2">
          <Input name="description" defaultValue={s?.description ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
            Sucursales donde se ofrece
          </legend>
          {branches.map((b) => (
            <Checkbox
              key={b.id}
              name="branchIds"
              value={b.id}
              defaultChecked={s ? s.branches.some((x) => x.branchId === b.id) : true}
              label={b.name}
            />
          ))}
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
            Barberos habilitados
          </legend>
          {barbers.map((b) => (
            <Checkbox
              key={b.id}
              name="barberIds"
              value={b.id}
              defaultChecked={s ? s.barbers.some((x) => x.barberId === b.id) : true}
              label={b.displayName}
            />
          ))}
        </fieldset>
      </div>
      <Checkbox name="active" defaultChecked={s?.active ?? true} label="Activo (visible para reservar)" />
    </ActionForm>
  );

  return (
    <>
      <PageHeader
        title="Servicios"
        description="El precio se copia en cada reserva: cambiarlo no altera reservas ya hechas."
      />
      <div className="space-y-4">
        {services.map((s) => (
          <details key={s.id} className="group rounded-xl border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
              <span>
                <span className="font-semibold">{s.name}</span>
                <span className="ml-2 text-sm text-muted">
                  {s.durationMinutes} min · {formatMoney(s.priceAmount, ctx.currency)}
                </span>
              </span>
              {s.active ? <Badge tone="ok">Activo</Badge> : <Badge>Inactivo</Badge>}
            </summary>
            <div className="border-t border-line p-5">{form(s)}</div>
          </details>
        ))}
        <Card>
          <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Nuevo servicio</h2>
          {form()}
        </Card>
      </div>
    </>
  );
}
