import { after, NextResponse } from "next/server";
import { clientIp, errorResponse, readJson } from "@/server/http";
import { BOOKING_COOKIE, bookingCookieOptions } from "@/server/booking-cookie";
import { bookPublicly, resolvePublicTenant } from "@/server/public-booking";
import { drainSoon } from "@/server/worker";
import { appUrl } from "@/shared/env";
import { enforceRateLimit } from "@/shared/rate-limit";
import type { BookingInput } from "@/modules/booking";

/**
 * Crea una reserva SIN cuenta. El tenant sale del slug (validado), nunca del cuerpo.
 * El precio, la disponibilidad y el estado del pago los decide el servidor.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await enforceRateLimit(`book:${clientIp(req)}`, 10, 10 * 60);
    const { slug } = await params;
    const tenant = await resolvePublicTenant(slug);
    const body = await readJson<BookingInput & { tenantId?: unknown }>(req, 8 * 1024);
    const { tenantId: _ignored, ...input } = body;
    const result = await bookPublicly(tenant.id, input, "WEB");

    const next = result.checkoutUrl ?? appUrl(`/b/${tenant.slug}/confirmacion/${result.appointmentId}`);
    const res = NextResponse.json(
      { appointmentId: result.appointmentId, status: result.status, next },
      { status: 201 },
    );
    // El token de gestión viaja en una cookie HttpOnly (no en la respuesta JSON ni en analítica).
    res.cookies.set(BOOKING_COOKIE, result.manageToken, bookingCookieOptions());
    after(drainSoon); // confirmación inmediata sin esperar al cron
    return res;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 413 || status === 400) {
      return NextResponse.json({ error: { code: "VALIDATION", message: "Solicitud inválida" } }, { status });
    }
    return errorResponse(err);
  }
}
