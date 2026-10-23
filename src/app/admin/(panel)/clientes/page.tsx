import Link from "next/link";
import { listCustomers } from "@/modules/crm";
import { requireAuth } from "@/modules/identity";
import { Card, EmptyState, Input, PageHeader, Table } from "@/components/ui";
import { formatDate } from "@/shared/time";

export const metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireAuth("customers.view");
  const { q } = await searchParams;
  const customers = await listCustomers(ctx, { q: q?.slice(0, 80) });

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Fichas creadas automáticamente al reservar. Los clientes no tienen cuenta ni contraseña."
      />
      <Card className="mb-4 p-4">
        <form className="flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Buscar por nombre, teléfono o correo" />
          <button className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-2">
            Buscar
          </button>
        </form>
      </Card>
      {customers.length === 0 ? (
        <EmptyState>No hay clientes que coincidan.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Correo</th>
              <th>Visitas</th>
              <th>Ausencias</th>
              <th>Última visita</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2/40">
                <td>
                  <Link href={`/admin/clientes/${c.id}`} className="font-medium hover:text-accent">
                    {c.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap">{c.phoneE164}</td>
                <td>{c.email ?? "—"}</td>
                <td>{c.visitCount}</td>
                <td>{c.noShowCount > 0 ? <span className="text-danger">{c.noShowCount}</span> : 0}</td>
                <td className="whitespace-nowrap">
                  {c.lastVisitAt
                    ? formatDate(c.lastVisitAt, ctx.timezone, {
                        weekday: undefined,
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
