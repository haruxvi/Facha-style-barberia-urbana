import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicTenant } from "@/modules/tenancy";
import { Logo } from "@/components/ui";
import { BookingWizard } from "./booking-wizard";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ c?: string }> };

export const metadata: Metadata = { title: "Reservar" };

export default async function ReservePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { c } = await searchParams;
  const tenant = await getPublicTenant(slug);
  if (!tenant) notFound();

  return (
    <main className="bg-stripes min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link href={`/b/${tenant.slug}`} className="mb-6 inline-block">
          <Logo name={tenant.name} small />
        </Link>
        <BookingWizard
          slug={tenant.slug}
          currency={tenant.currency}
          paymentPolicy={tenant.paymentPolicy}
          depositAmount={tenant.depositAmount}
          horizonDays={Math.min(tenant.bookingHorizonDays, 21)}
          bookingTerms={tenant.bookingTerms}
          cancellationHours={Math.round(tenant.cancellationWindowMinutes / 60)}
          branches={tenant.branches}
          campaign={c && /^[a-z0-9-]{1,40}$/.test(c) ? c : null}
        />
      </div>
    </main>
  );
}
