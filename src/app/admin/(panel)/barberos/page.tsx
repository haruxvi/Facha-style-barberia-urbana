import Link from "next/link";
import { listBarbers, listServices } from "@/modules/catalog";
import { requireAuth } from "@/modules/identity";
import { listBranches } from "@/modules/tenancy";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Checkbox, Field, Input, PageHeader, Table } from "@/components/ui";
import { saveBarberAction } from "../../actions";

export const metadata = { title: "Barberos" };

export default async function BarbersPage() {
  const ctx = await requireAuth("barbers.manage");
  const [barbers, branches, services] = await Promise.all([
    listBarbers(ctx),
    listBranches(ctx),
    listServices(ctx),
  ]);

  return (
    <>
      <PageHeader title="Barberos" description="Perfil, sucursales, servicios, horarios y comisiones." />
      <Table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Sucursales</th>
            <th>Servicios</th>
            <th>Comisión</th>
            <th>Usuario</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {barbers.map((b) => (
            <tr key={b.id} className="hover:bg-surface-2/40">
              <td>
                <Link href={`/admin/barberos/${b.id}`} className="font-medium hover:text-accent">
                  {b.displayName}
                </Link>
              </td>
              <td>{b.branches.length}</td>
              <td>{b.services.length}</td>
              <td>{(b.commissionBps / 100).toFixed(1)}%</td>
              <td className="text-xs text-muted">{b.membership?.user.email ?? "—"}</td>
              <td>{b.active ? <Badge tone="ok">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Card className="mt-6">
        <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Nuevo barbero</h2>
        <ActionForm action={saveBarberAction} submitLabel="Crear y configurar horario">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nombre visible">
              <Input name="displayName" required />
            </Field>
            <Field label="Comisión (%)">
              <Input name="commissionPercent" type="number" min={0} max={100} step={0.5} defaultValue={40} />
            </Field>
            <Field label="Bio corta">
              <Input name="bio" maxLength={400} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                Sucursales
              </legend>
              {branches.map((b) => (
                <Checkbox key={b.id} name="branchIds" value={b.id} defaultChecked label={b.name} />
              ))}
            </fieldset>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                Servicios que realiza
              </legend>
              {services.map((s) => (
                <Checkbox key={s.id} name="serviceIds" value={s.id} defaultChecked label={s.name} />
              ))}
            </fieldset>
          </div>
          <input type="hidden" name="active" value="on" />
        </ActionForm>
      </Card>
    </>
  );
}
