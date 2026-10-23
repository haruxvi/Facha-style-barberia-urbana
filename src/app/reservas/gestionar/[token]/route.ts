import { NextResponse } from "next/server";
import { verifyManageToken } from "@/modules/booking";
import { MANAGE_COOKIE, manageCookieOptions } from "@/server/booking-cookie";
import { appUrl } from "@/shared/env";
import { enforceRateLimit } from "@/shared/rate-limit";
import { clientIp } from "@/server/http";

/**
 * Enlace de gestión recibido por WhatsApp/correo. Valida el token, lo cambia por una sesión limitada
 * (cookie HttpOnly de 30 min) y redirige a una URL SIN el token, para que no quede en el historial
 * ni se filtre por Referer.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    await enforceRateLimit(`manage:${clientIp(req)}`, 30, 10 * 60);
  } catch {
    return NextResponse.redirect(appUrl("/reservas/gestionar?error=rate"), 303);
  }
  const check = await verifyManageToken(decodeURIComponent(token));
  if (!check.ok) return NextResponse.redirect(appUrl(`/reservas/gestionar?error=${check.reason}`), 303);
  const res = NextResponse.redirect(appUrl("/reservas/gestionar"), 303);
  res.cookies.set(MANAGE_COOKIE, decodeURIComponent(token), manageCookieOptions());
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
