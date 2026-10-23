import { requireAuth } from "@/modules/identity";
import { listBranches } from "@/modules/tenancy";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Checkbox, Field, Input, PageHeader } from "@/components/ui";
import { saveBranchAction } from "../../actions";

export const metadata = { title: "Sucursales" };

type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];

export default async function BranchesPage() {
  const ctx = await requireAuth("branches.manage");
  const branches = await listBranches(ctx);

  const form = (b?: BranchRow) => (
    <ActionForm action={saveBranchAction} submitLabel={b ? "Guardar" : "Crear sucursal"} resetOnSuccess={!b}>
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Nombre">
          <Input name="name" defaultValue={b?.name} required />
        </Field>
        <Field label="Identificador" hint="minúsculas y guiones">
          <Input name="slug" defaultValue={b?.slug} required pattern="[a-z0-9-]{2,50}" />
        </Field>
        <Field label="Zona horaria" hint="IANA, ej. America/Santiago">
          <Input name="timezone" defaultValue={b?.timezone ?? ctx.timezone} required />
        </Field>
        <Field label="Dirección" className="sm:col-span-2">
          <Input name="address" defaultValue={b?.address ?? ""} />
        </Field>
        <Field label="Teléfono">
          <Input name="phone" defaultValue={b?.phone ?? ""} />
        </Field>
      </div>
      <Checkbox name="active" defaultChecked={b?.active ?? true} label="Activa (visible para reservar)" />
    </ActionForm>
  );

  return (
    <>
      <PageHeader
        title="Sucursales"
        description="La zona horaria de cada sucursal define cómo se calculan y muestran los horarios."
      />
      <div className="space-y-4">
        {branches.map((b) => (
          <details
            key={b.id}
            className="rounded-xl border border-line bg-surface"
            open={branches.length === 1}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4">
              <span className="font-semibold">{b.name}</span>
              {b.active ? <Badge tone="ok">Activa</Badge> : <Badge>Inactiva</Badge>}
            </summary>
            <div className="border-t border-line p-5">{form(b)}</div>
          </details>
        ))}
        <Card>
          <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Nueva sucursal</h2>
          {form()}
        </Card>
      </div>
    </>
  );
}
