import type { Metadata } from "next";
import { getPublicAppointment } from "@/modules/booking";
import { ActionForm } from "@/components/action-form";
import { AppointmentStatusBadge, ButtonLink, Card, Logo, Notice } from "@/components/ui";
import { manageSessionFromCookies } from "@/server/booking-cookie";
import { formatMoney } from "@/shared/money";
import { addMinutes, formatDateTime } from "@/shared/time";
import { cancelByCustomerAction, payPendingAction } from "./actions";
import { Reschedule } from "./reschedule";

export const metadata: Metadata = { title: "Gestionar reserva", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "El enlace no es válido.",
  revoked: "Este enlace fue reemplazado o revocado. Usa el mensaje más reciente que te enviamos.",
  expired: "Este enlace expiró.",
  rate: "Demasiados intentos. Espera unos minutos.",
};

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const session = await manageSessionFromCookies();
  const appt = session ? await getPublicAppointment(session.tenantId, session.appointmentId) : null;

  if (!appt) {
    return (
      <Shell>
        <Card>
          <h1 className="font-display text-2xl uppercase">Gestionar reserva</h1>
          <Notice tone="warn">
            {ERRORS[error ?? ""] ??
              "Abre el enlace que te enviamos por WhatsApp o correo para gestionar tu reserva."}
          </Notice>
        </Card>
      </Shell>
    );
  }

  const tz = appt.branch.timezone;
  const now = new Date();
  const canCancel =
    ["CONFIRMED", "PENDING_PAYMENT"].includes(appt.status) &&
    now <= addMinutes(appt.startsAt, -appt.tenant.cancellationWindowMinutes);
  const canReschedule =
    appt.status === "CONFIRMED" && now <= addMinutes(appt.startsAt, -appt.tenant.rescheduleWindowMinutes);

  return (
    <Shell name={appt.tenant.name}>
      <Card className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl uppercase">Tu reserva</h1>
          <AppointmentStatusBadge status={appt.status} />
        </div>
        <div className="rounded-lg border border-line bg-surface-2 p-4 text-sm">
          <div className="text-lg font-semibold">{appt.serviceName}</div>
          <div className="first-letter:uppercase">{formatDateTime(appt.startsAt, tz)}</div>
          <div className="text-muted">
            con {appt.barber.displayName} · {appt.branch.name}
            {appt.branch.address ? ` · ${appt.branch.address}` : ""}
          </div>
          <div className="mt-2 text-muted">Precio: {formatMoney(appt.priceAmount, appt.currency)}</div>
        </div>

        {appt.status === "PENDING_PAYMENT" && (
          <ActionForm
            action={payPendingAction}
            submitLabel={`Pagar ${formatMoney(appt.amountDue, appt.currency)}`}
          >
            <input type="hidden" name="appointmentId" value={appt.id} />
          </ActionForm>
        )}

        {canReschedule && <Reschedule timezone={tz} horizonDays={14} />}

        {canCancel ? (
          <ActionForm
            action={cancelByCustomerAction}
            submitLabel="Cancelar reserva"
            variant="danger"
            confirm="¿Seguro que quieres cancelar tu reserva?"
          />
        ) : (
          ["CONFIRMED", "PENDING_PAYMENT"].includes(appt.status) && (
            <Notice tone="info">
              Ya no es posible cancelar o cambiar en línea (hasta{" "}
              {Math.round(appt.tenant.cancellationWindowMinutes / 60)} h antes).
              {appt.tenant.publicPhone
                ? ` Llámanos al ${appt.tenant.publicPhone}.`
                : " Contáctanos directamente."}
            </Notice>
          )
        )}

        {["CANCELLED", "EXPIRED"].includes(appt.status) && (
          <ButtonLink href={`/b/${appt.tenant.slug}/reservar`}>Reservar otra hora</ButtonLink>
        )}
      </Card>
    </Shell>
  );
}

function Shell({ name, children }: { name?: string; children: React.ReactNode }) {
  return (
    <main className="bg-stripes min-h-dvh">
      <div className="mx-auto max-w-xl px-4 py-10">
        <div className="mb-6">
          <Logo name={name} small />
        </div>
        {children}
      </div>
    </main>
  );
}
