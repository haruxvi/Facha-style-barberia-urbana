import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { forbidden } from "@/shared/errors";
import { resolveSession, type AuthContext } from "./auth-service";
import { can, type Permission } from "./rbac";

/**
 * Adaptador Next.js de la sesión administrativa: cookie HttpOnly, SameSite=Lax y Secure en producción.
 * En producción se usa el prefijo __Host- (obliga a Secure, Path=/ y sin Domain).
 */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-fs_session" : "fs_session";

export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
});

/** Para páginas: redirige al login si no hay sesión; si falta permiso redirige a /admin/sin-permiso. */
export async function requireAuth(permission?: Permission): Promise<AuthContext> {
  const ctx = await getAuth();
  if (!ctx) redirect("/admin/login");
  if (permission && !can(ctx.role, permission)) redirect("/admin/sin-permiso");
  return ctx;
}

/** Para Server Actions y route handlers: lanza error en vez de redirigir. */
export async function requireAuthOrThrow(permission?: Permission): Promise<AuthContext> {
  const ctx = await getAuth();
  if (!ctx) redirect("/admin/login");
  if (permission && !can(ctx.role, permission)) throw forbidden();
  return ctx;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  return value;
}

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: forwarded || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
}
