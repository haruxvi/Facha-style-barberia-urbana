import { listAppointments } from "@/modules/booking";
import { requireAuth } from "@/modules/identity";
import { AppointmentStatusBadge, EmptyState, PageHeader, Table } from "@/components/ui";
import { formatMoney } from "@/shared/money";
import { addDays, formatDateTime, todayIn, zonedToUtc } from "@/shared/time";

export const metadata = { title: "Mis reservas" };

export default async function BarberAppointmentsPage() {
  const ctx = await requireAuth("barber.portal");
  const today = todayIn(ctx.timezone);
  const list = await listAppointments(ctx, {
    from: zonedToUtc(addDays(today, -30), 0, ctx.timezone),
    to: zonedToUtc(addDays(today, 30), 0, ctx.timezone),
    barberId: ctx.barberId ?? undefined,
  });
  const completed = list.filter((a) => a.status === "COMPLETED");

  return (
    <>
      <PageHeader
        title="Mis reservas"
        description={`Últimos 30 días y próximos 30 · ${completed.length} atenciones completadas (${formatMoney(
          completed.reduce((s, a) => s + a.priceAmount, 0),
          ctx.currency,
        )})`}
      />
      {list.length === 0 ? (
        <EmptyState>Sin reservas.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Servicio</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap first-letter:uppercase">
                  {formatDateTime(a.startsAt, ctx.timezone)}
                </td>
                <td>{a.customer.name}</td>
                <td>{a.serviceName}</td>
                <td>
                  <AppointmentStatusBadge status={a.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
