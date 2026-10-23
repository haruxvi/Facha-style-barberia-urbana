import Link from "next/link";
import { requireAuth } from "@/modules/identity";
import { getDashboard } from "@/modules/reporting";
import { AppointmentStatusBadge, ButtonLink, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatMoney } from "@/shared/money";
import { formatLocalDate, formatTime } from "@/shared/time";

export const metadata = { title: "Inicio" };

export default async function DashboardPage() {
  const ctx = await requireAuth("dashboard.view");
  const d = await getDashboard(ctx);
  const money = (n: number) => formatMoney(n, ctx.currency);

  return (
    <>
      <PageHeader
        title="Hoy"
        description={<span className="first-letter:uppercase">{formatLocalDate(d.today)}</span>}
        actions={
          <>
            <ButtonLink href="/admin/reservas/nueva">Nueva reserva</ButtonLink>
            <ButtonLink href="/admin/agenda" variant="secondary">
              Ver agenda
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Ingresos hoy" value={money(d.revenue.day)} hint="Servicios completados" />
        <Stat label="Semana" value={money(d.revenue.week)} />
        <Stat label="Mes" value={money(d.revenue.month)} />
        <Stat label="Próximas citas" value={d.upcoming} />
        <Stat label="Pagos pendientes" value={d.pendingPayments} />
        <Stat label="Cancelaciones (mes)" value={d.cancelledMonth} />
        <Stat label="Ausencias (mes)" value={d.noShowsMonth} />
        <Stat label="Clientes recurrentes" value={d.recurringCustomers} hint="2 o más visitas" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Citas de hoy</h2>
          {d.todayList.length === 0 ? (
            <EmptyState>No hay citas para hoy.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {d.todayList.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/admin/reservas/${a.id}`}
                    className="flex items-center gap-4 py-3 hover:bg-surface-2/50"
                  >
                    <span className="w-14 font-display text-lg text-accent">
                      {formatTime(a.startsAt, ctx.timezone)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.customer.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {a.serviceName} · {a.barber.displayName}
                      </span>
                    </span>
                    <AppointmentStatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Ocupación esta semana</h2>
            {d.occupancy.length === 0 && <EmptyState>Sin barberos activos.</EmptyState>}
            <ul className="space-y-3">
              {d.occupancy.map((o) => (
                <li key={o.barberId}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{o.name}</span>
                    <span className="text-muted">{Math.round(o.rate * 100)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.round(o.rate * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Más pedidos (mes)</h2>
            {d.topServices.length === 0 ? (
              <EmptyState>Aún no hay datos este mes.</EmptyState>
            ) : (
              <ol className="space-y-2 text-sm">
                {d.topServices.map((s, i) => (
                  <li key={s.name} className="flex justify-between">
                    <span>
                      <span className="mr-2 text-muted">{i + 1}.</span>
                      {s.name}
                    </span>
                    <span className="font-semibold">{s.count}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
