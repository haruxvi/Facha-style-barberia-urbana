import { listAppointments } from "@/modules/booking";
import { requireAuth } from "@/modules/identity";
import { ActionForm } from "@/components/action-form";
import { AppointmentStatusBadge, Card, EmptyState, PageHeader } from "@/components/ui";
import { addDays, formatLocalDate, formatTime, localParts, todayIn, zonedToUtc } from "@/shared/time";
import { appointmentTransitionAction } from "../../admin/actions";

export const metadata = { title: "Mi agenda" };

export default async function BarberAgendaPage() {
  const ctx = await requireAuth("barber.portal");
  const today = todayIn(ctx.timezone);
  // listAppointments fuerza barberId = ctx.barberId para el rol BARBER.
  const list = await listAppointments(ctx, {
    from: zonedToUtc(today, 0, ctx.timezone),
    to: zonedToUtc(addDays(today, 7), 0, ctx.timezone),
    barberId: ctx.barberId ?? undefined,
    status: ["CONFIRMED", "CHECKED_IN", "COMPLETED", "PENDING_PAYMENT", "NO_SHOW"],
  });
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  return (
    <>
      <PageHeader title="Mi agenda" description="Próximos 7 días" />
      <div className="space-y-5">
        {days.map((d) => {
          const items = list.filter((a) => localParts(a.startsAt, ctx.timezone).date === d);
          return (
            <section key={d}>
              <h2 className="mb-2 font-display text-sm uppercase tracking-wider text-muted first-letter:uppercase">
                {d === today ? "Hoy" : formatLocalDate(d)}
              </h2>
              {items.length === 0 ? (
                <EmptyState>Sin citas</EmptyState>
              ) : (
                <div className="space-y-2">
                  {items.map((a) => (
                    <Card key={a.id} className="flex flex-wrap items-center gap-3 p-4">
                      <span className="w-14 font-display text-xl text-accent">
                        {formatTime(a.startsAt, ctx.timezone)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{a.customer.name}</span>
                        <span className="block text-sm text-muted">{a.serviceName}</span>
                      </span>
                      <AppointmentStatusBadge status={a.status} />
                      {d === today && a.status === "CONFIRMED" && (
                        <ActionForm action={appointmentTransitionAction} submitLabel="Llegó" inline>
                          <input type="hidden" name="appointmentId" value={a.id} />
                          <input type="hidden" name="transition" value="check_in" />
                        </ActionForm>
                      )}
                      {d === today && ["CONFIRMED", "CHECKED_IN"].includes(a.status) && (
                        <ActionForm
                          action={appointmentTransitionAction}
                          submitLabel="Atendido"
                          variant="secondary"
                          inline
                        >
                          <input type="hidden" name="appointmentId" value={a.id} />
                          <input type="hidden" name="transition" value="complete" />
                        </ActionForm>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
