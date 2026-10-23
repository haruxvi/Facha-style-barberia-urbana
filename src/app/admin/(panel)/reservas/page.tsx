import Link from "next/link";
import { listAppointments } from "@/modules/booking";
import { requireAuth } from "@/modules/identity";
import {
  AppointmentStatusBadge,
  ButtonLink,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Table,
} from "@/components/ui";
import { formatMoney } from "@/shared/money";
import { addDays, formatDate, formatTime, isLocalDate, todayIn, zonedToUtc } from "@/shared/time";
import type { AppointmentStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Reservas" };

const STATUSES: { value: AppointmentStatus; label: string }[] = [
  { value: "PENDING_PAYMENT", label: "Pendiente de pago" },
  { value: "CONFIRMED", label: "Confirmada" },
  { value: "CHECKED_IN", label: "En el local" },
  { value: "COMPLETED", label: "Completada" },
  { value: "CANCELLED", label: "Cancelada" },
  { value: "NO_SHOW", label: "No asistió" },
  { value: "EXPIRED", label: "Expirada" },
];

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; estado?: string }>;
}) {
  const ctx = await requireAuth("agenda.view");
  const sp = await searchParams;
  const tz = ctx.timezone;
  const today = todayIn(tz);
  const from = sp.desde && isLocalDate(sp.desde) ? sp.desde : today;
  const to = sp.hasta && isLocalDate(sp.hasta) ? sp.hasta : addDays(today, 14);
  const status = STATUSES.find((s) => s.value === sp.estado)?.value;
  const list = await listAppointments(ctx, {
    from: zonedToUtc(from, 0, tz),
    to: zonedToUtc(addDays(to, 1), 0, tz),
    status: status ? [status] : undefined,
  });

  return (
    <>
      <PageHeader
        title="Reservas"
        description={`${list.length} resultados`}
        actions={<ButtonLink href="/admin/reservas/nueva">Nueva reserva</ButtonLink>}
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
          <label className="text-xs text-muted">
            Estado
            <Select name="estado" defaultValue={status ?? ""} className="mt-1 w-48">
              <option value="">Todos</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <button className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2">
            Filtrar
          </button>
        </form>
      </Card>
      {list.length === 0 ? (
        <EmptyState>No hay reservas en este rango.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Servicio</th>
              <th>Barbero</th>
              <th>Precio</th>
              <th>Origen</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="hover:bg-surface-2/40">
                <td className="whitespace-nowrap">
                  <Link href={`/admin/reservas/${a.id}`} className="font-medium hover:text-accent">
                    {formatDate(a.startsAt, tz, { weekday: "short", day: "numeric", month: "short" })} ·{" "}
                    {formatTime(a.startsAt, tz)}
                  </Link>
                </td>
                <td>{a.customer.name}</td>
                <td>{a.serviceName}</td>
                <td>{a.barber.displayName}</td>
                <td>{formatMoney(a.priceAmount, a.currency)}</td>
                <td className="text-xs text-muted">
                  {a.source === "WEB" ? "Web" : a.source === "WHATSAPP" ? "WhatsApp" : "Panel"}
                </td>
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
