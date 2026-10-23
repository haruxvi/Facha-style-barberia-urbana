import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http";
import { resolvePublicTenant } from "@/server/public-booking";

/** Información pública mínima de la barbería. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const t = await resolvePublicTenant(slug);
    return NextResponse.json({
      slug: t.slug,
      name: t.name,
      description: t.description,
      phone: t.publicPhone,
      instagram: t.instagram,
      timezone: t.timezone,
      currency: t.currency,
      paymentPolicy: t.paymentPolicy,
      depositAmount: t.depositAmount,
      bookingTerms: t.bookingTerms,
      branches: t.branches,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
