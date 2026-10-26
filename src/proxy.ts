import { NextResponse, type NextRequest } from "next/server";
import { secureCookies } from "@/shared/env";

/**
 * Comprobación optimista (Next 16 "proxy", antes middleware): si no hay cookie de sesión,
 * redirige al login. La autorización REAL se hace en el servidor en cada página/acción
 * (resolveSession + permisos), nunca aquí.
 */
// Debe coincidir con SESSION_COOKIE (identity/next-session).
const COOKIE = secureCookies() ? "__Host-fs_session" : "fs_session";
const PUBLIC_ADMIN = ["/admin/login", "/admin/olvide", "/admin/restablecer", "/admin/invitacion"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_ADMIN.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get(COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/barber/:path*"],
};
