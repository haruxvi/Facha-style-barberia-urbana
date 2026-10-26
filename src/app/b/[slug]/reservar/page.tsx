import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { availableProvider } from "@/modules/payments";
import { getPublicTenant } from "@/modules/tenancy";
import { Logo } from "@/components/ui";
import { BookingWizard } from "./booking-wizard";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ c?: string; servicio?: string }> };

export const metadata: Metadata = { title: "Reservar" };

export default async function ReservePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { c, servicio } = await searchParams;
  const tenant = await getPublicTenant(slug);
  if (!tenant) notFound();
  // Sin proveedor de pagos, "pago opcional" equivale a pagar en el local: no se ofrece una casilla que no funcionaría.
  const canPayOnline = !!(await availableProvider(tenant.id));
  const paymentPolicy = tenant.paymentPolicy === "OPTIONAL" && !canPayOnline ? "NONE" : tenant.paymentPolicy;

  return (
    <main className="bg-brand min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link href={`/b/${tenant.slug}`} className="mb-6 inline-block">
          <Logo name={tenant.name} logoUrl={tenant.logoUrl} size="md" />
        </Link>
        <BookingWizard
          slug={tenant.slug}
          currency={tenant.currency}
          paymentPolicy={paymentPolicy}
          depositAmount={tenant.depositAmount}
          horizonDays={Math.min(tenant.bookingHorizonDays, 21)}
          bookingTerms={tenant.bookingTerms}
          cancellationHours={Math.round(tenant.cancellationWindowMinutes / 60)}
          branches={tenant.branches}
          campaign={c && /^[a-z0-9-]{1,40}$/.test(c) ? c : null}
          initialServiceId={servicio && /^[0-9a-f-]{36}$/.test(servicio) ? servicio : null}
        />
      </div>
    </main>
  );
}
