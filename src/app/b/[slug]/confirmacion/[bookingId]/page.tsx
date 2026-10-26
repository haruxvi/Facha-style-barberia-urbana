import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicAppointment } from "@/modules/booking";
import { reconcilePayment } from "@/modules/payments";
import { getPublicTenant } from "@/modules/tenancy";
import { ActionForm } from "@/components/action-form";
import { AppointmentStatusBadge, ButtonLink, Card, Logo, Notice } from "@/components/ui";
import { bookingAccessFromCookies } from "@/server/booking-cookie";
import { formatMoney } from "@/shared/money";
import { formatDateTime, formatTime } from "@/shared/time";
import { payPendingAction } from "@/app/reservas/gestionar/actions";

export const metadata: Metadata = { title: "Tu reserva", robots: { index: false } };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string; bookingId: string }>;
  searchParams: Promise<{ pago?: string }>;
};

export default async function ConfirmationPage({ params, searchParams }: Props) {
  const { slug, bookingId } = await params;
  const { pago } = await searchParams;
  const tenant = await getPublicTenant(slug);
  if (!tenant) notFound();
  const access = /^[0-9a-f-]{36}$/.test(bookingId) ? await bookingAccessFromCookies(bookingId) : null;

  if (!access || access.tenantId !== tenant.id) {
    // Sin el token de esta reserva no mostramos ningún dato (el id por sí solo no da acceso).
    return (
      <Shell name={tenant.name} logoUrl={tenant.logoUrl}>
        <Card>
          <h1 className="heading-page">Reserva registrada</h1>
          <p className="mt-2 text-sm text-muted">
            Revisa tu WhatsApp o correo: ahí tienes el enlace para ver, cambiar o cancelar tu reserva.
          </p>
          <ButtonLink href={`/b/${tenant.slug}`} variant="secondary" className="mt-4">
            Volver
          </ButtonLink>
        </Card>
      </Shell>
    );
  }

  let appt = await getPublicAppointment(tenant.id, bookingId);
  if (!appt) notFound();
  const lastPayment = appt.payments[0];
  // Al volver del checkout NO confiamos en el parámetro "pago=ok": consultamos al proveedor desde el servidor.
  if (pago && appt.status === "PENDING_PAYMENT" && lastPayment && lastPayment.status === "PENDING") {
    try {
      await reconcilePayment(tenant.id, lastPayment.id);
      appt = (await getPublicAppointment(tenant.id, bookingId))!;
    } catch {
      /* el webhook lo resolverá */
    }
  }
  const tz = appt.branch.timezone;

  return (
    <Shell name={tenant.name} logoUrl={tenant.logoUrl}>
      <Card className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="heading-page">
              {appt.status === "CONFIRMED"
                ? "¡Te esperamos!"
                : appt.status === "PENDING_PAYMENT"
                  ? "Falta el pago"
                  : "Tu reserva"}
            </h1>
            <p className="text-sm text-muted">Hola, {appt.customer.name.split(" ")[0]}.</p>
          </div>
          <AppointmentStatusBadge status={appt.status} />
        </div>

        <dl className="grid gap-3 rounded-lg border border-line bg-surface-2 p-4 text-sm sm:grid-cols-2">
          <Item label="Servicio" value={appt.serviceName} />
          <Item label="Profesional" value={appt.barber.displayName} />
          <Item label="Cuándo" value={formatDateTime(appt.startsAt, tz)} />
          <Item
            label="Dónde"
            value={`${appt.branch.name}${appt.branch.address ? ` · ${appt.branch.address}` : ""}`}
          />
          <Item label="Precio" value={formatMoney(appt.priceAmount, appt.currency)} />
          {appt.amountDue > 0 && (
            <Item label="Pago online" value={formatMoney(appt.amountDue, appt.currency)} />
          )}
        </dl>

        {appt.status === "PENDING_PAYMENT" && (
          <div className="space-y-3">
            {pago === "error" && (
              <Notice tone="danger">El pago no se completó. Puedes intentarlo de nuevo.</Notice>
            )}
            {pago === "pendiente" && (
              <Notice tone="warn">Tu pago está en proceso. Te avisaremos cuando se acredite.</Notice>
            )}
            <Notice tone="warn">
              Tu hora está reservada temporalmente
              {appt.holdExpiresAt ? ` hasta las ${formatTime(appt.holdExpiresAt, tz)}` : ""}. Si no se paga,
              se libera.
            </Notice>
            <ActionForm
              action={payPendingAction}
              submitLabel={`Pagar ${formatMoney(appt.amountDue, appt.currency)}`}
              pendingLabel="Abriendo pago…"
            >
              <input type="hidden" name="appointmentId" value={appt.id} />
            </ActionForm>
          </div>
        )}
        {appt.status === "EXPIRED" && (
          <Notice tone="danger">
            El tiempo para pagar terminó y la hora se liberó.{" "}
            <Link className="underline" href={`/b/${tenant.slug}/reservar`}>
              Reservar de nuevo
            </Link>
          </Notice>
        )}
        {appt.status === "CONFIRMED" && (
          <Notice tone="ok">
            Te enviamos la confirmación por WhatsApp (si lo aceptaste). Te recomendamos llegar 5 minutos
            antes.
          </Notice>
        )}

        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/reservas/gestionar" variant="secondary">
            Ver, cambiar o cancelar
          </ButtonLink>
          <ButtonLink href={`/b/${tenant.slug}`} variant="ghost">
            Volver a {tenant.name}
          </ButtonLink>
        </div>
      </Card>
    </Shell>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow text-subtle">{label}</dt>
      <dd className="font-medium first-letter:uppercase">{value}</dd>
    </div>
  );
}

function Shell({
  name,
  logoUrl,
  children,
}: {
  name: string;
  logoUrl: string | null;
  children: React.ReactNode;
}) {
  return (
    <main className="bg-brand min-h-dvh">
      <div className="mx-auto max-w-xl px-4 py-10">
        <div className="mb-6">
          <Logo name={name} logoUrl={logoUrl} size="md" />
        </div>
        {children}
      </div>
    </main>
  );
}
