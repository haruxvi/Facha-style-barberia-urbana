import { cookies } from "next/headers";
import { verifyManageToken } from "@/modules/booking";

/** Cookie con el token de la ÚLTIMA reserva hecha en este navegador (para la página de confirmación). */
export const BOOKING_COOKIE = "fs_booking";
/** Sesión limitada de gestión: el token se retira de la URL y queda aquí 30 minutos. */
export const MANAGE_COOKIE = "fs_manage";

export function bookingCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 2 * 24 * 3600,
  };
}

export function manageCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 60,
  };
}

/** Comprueba que el navegador tiene un token válido para ESA reserva. */
export async function bookingAccessFromCookies(appointmentId: string): Promise<{ tenantId: string } | null> {
  const store = await cookies();
  for (const name of [BOOKING_COOKIE, MANAGE_COOKIE]) {
    const token = store.get(name)?.value;
    if (!token) continue;
    const check = await verifyManageToken(token);
    if (check.ok && check.appointmentId === appointmentId) return { tenantId: check.tenantId };
  }
  return null;
}

/** Sesión de gestión: primero el enlace abierto (fs_manage), si no, la última reserva de este navegador. */
export async function manageSessionFromCookies() {
  const store = await cookies();
  for (const name of [MANAGE_COOKIE, BOOKING_COOKIE]) {
    const token = store.get(name)?.value;
    if (!token) continue;
    const check = await verifyManageToken(token);
    if (check.ok) return { ...check, token };
  }
  return null;
}
