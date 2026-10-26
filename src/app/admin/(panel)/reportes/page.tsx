import { requireAuth } from "@/modules/identity";
import { getReport } from "@/modules/reporting";
import { Card, Input, PageHeader, Stat, Table } from "@/components/ui";
import { formatMoney } from "@/shared/money";
import { addDays, isLocalDate, todayIn } from "@/shared/time";

export const metadata = { title: "Reportes" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const ctx = await requireAuth("reports.view");
  const sp = await searchParams;
  const today = todayIn(ctx.timezone);
  const from = sp.desde && isLocalDate(sp.desde) ? sp.desde : addDays(today, -29);
  const to = sp.hasta && isLocalDate(sp.hasta) && sp.hasta >= from ? sp.hasta : today;
  const r = await getReport(ctx, from, to);
  const money = (n: number) => formatMoney(n, ctx.currency);
  const maxDay = Math.max(1, ...r.byDay.map((d) => d.revenue));

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Calculados con los datos reales de la base. Ingresos = servicios completados."
      />
      <Card className="mb-4 p-4">
        <form className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Desde
            <Input type="date" name="desde" defaultValue={from} className="mt-1 w-40" />
          </label>
          <label className="text-xs text-muted">
            Hasta
            <Input type="date" name="hasta" defaultValue={to} className="mt-1 w-40" />
          </label>
          <button className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2">
            Aplicar
          </button>
        </form>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Ingresos" value={money(r.totals.revenue)} hint={`${r.totals.completed} servicios`} />
        <Stat label="Cobrado online" value={money(r.totals.collectedOnline)} hint="Neto de reembolsos" />
        <Stat label="Reservas" value={r.totals.bookings} hint={`${r.totals.uniqueCustomers} clientes`} />
        <Stat label="Recurrentes" value={r.totals.recurringCustomers} hint="2+ visitas en el período" />
        <Stat label="Cancelaciones" value={r.totals.cancelled} />
        <Stat label="Ausencias" value={r.totals.noShows} />
        {r.bySource.map((s) => (
          <Stat
            key={s.source}
            label={`Vía ${s.source === "WEB" ? "web" : s.source === "WHATSAPP" ? "WhatsApp" : "panel"}`}
            value={s.count}
          />
        ))}
      </div>

      <Card className="mt-6">
        <h2 className="mb-4 heading-section">Ingresos por día</h2>
        <div className="flex h-40 items-end gap-1">
          {r.byDay.map((d) => (
            <div
              key={d.date}
              className="group relative flex-1"
              title={`${d.date}: ${money(d.revenue)} · ${d.bookings} reservas`}
            >
              <div
                className="rounded-t bg-accent/80 group-hover:bg-accent"
                style={{ height: `${Math.max(2, (d.revenue / maxDay) * 150)}px` }}
              />
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-3 heading-section">Barberos y comisiones</h2>
          <Table>
            <thead>
              <tr>
                <th>Barbero</th>
                <th>Reservas</th>
                <th>Ausencias</th>
                <th>Ingresos</th>
                <th>Comisión</th>
              </tr>
            </thead>
            <tbody>
              {r.byBarber.map((b) => (
                <tr key={b.name}>
                  <td>{b.name}</td>
                  <td>{b.bookings}</td>
                  <td>{b.noShows}</td>
                  <td>{money(b.revenue)}</td>
                  <td>
                    {money(b.commission)}{" "}
                    <span className="text-xs text-muted">({b.commissionBps / 100}%)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div>
          <h2 className="mb-3 heading-section">Servicios</h2>
          <Table>
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Reservas</th>
                <th>Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {r.byService.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.count}</td>
                  <td>{money(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div>
          <h2 className="mb-3 heading-section">Ocupación</h2>
          <Table>
            <thead>
              <tr>
                <th>Barbero</th>
                <th>Reservado</th>
                <th>Disponible</th>
                <th>Ocupación</th>
              </tr>
            </thead>
            <tbody>
              {r.occupancy.map((o) => (
                <tr key={o.barberId}>
                  <td>{o.name}</td>
                  <td>{Math.round(o.bookedMinutes / 60)} h</td>
                  <td>{Math.round(o.availableMinutes / 60)} h</td>
                  <td>{Math.round(o.rate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div>
          <h2 className="mb-3 heading-section">Campañas QR</h2>
          <Table>
            <thead>
              <tr>
                <th>Campaña</th>
                <th>Visitas</th>
                <th>Reservas</th>
                <th>Conversión</th>
              </tr>
            </thead>
            <tbody>
              {r.campaigns.map((c) => (
                <tr key={c.code}>
                  <td>{c.label}</td>
                  <td>{c.visits}</td>
                  <td>{c.bookings}</td>
                  <td>{c.visits ? `${Math.round((c.bookings / c.visits) * 100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </>
  );
}
