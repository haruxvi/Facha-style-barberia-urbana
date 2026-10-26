import type { Role } from "@/generated/prisma/enums";
import { audit } from "@/shared/audit";
import { randomToken, sha256 } from "@/shared/crypto";
import { db } from "@/shared/db";
import { AppError, forbidden } from "@/shared/errors";
import { hitRateLimit } from "@/shared/rate-limit";
import { can, type Permission } from "./rbac";
import { getDummyHash, hashPassword, passwordPolicyError, verifyPassword } from "./password";

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000; // 12 h sin actividad
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días como máximo
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface AuthContext {
  sessionId: string;
  userId: string;
  userName: string;
  email: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantLogoUrl: string | null;
  timezone: string;
  currency: string;
  role: Role;
  barberId: string | null;
  memberships: { tenantId: string; tenantName: string; role: Role }[];
}

const INVALID = "Correo o contraseña incorrectos, o la cuenta está bloqueada temporalmente.";

export async function login(input: {
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const email = input.email.trim().toLowerCase();
  const ipLimit = await hitRateLimit(`login:ip:${input.ip ?? "unknown"}`, 30, 15 * 60);
  const emailLimit = await hitRateLimit(`login:email:${email}`, 10, 15 * 60);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    throw new AppError("RATE_LIMITED", "Demasiados intentos de acceso. Espera unos minutos.");
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    await verifyPassword(input.password, await getDummyHash());
    throw new AppError("UNAUTHENTICATED", INVALID);
  }
  if (user.disabledAt || (user.lockedUntil && user.lockedUntil > new Date())) {
    await verifyPassword(input.password, await getDummyHash());
    throw new AppError("UNAUTHENTICATED", INVALID);
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db.user.update({
      where: { id: user.id },
      data:
        failed >= MAX_FAILED
          ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
          : { failedLoginCount: failed },
    });
    await audit({ actor: { type: "STAFF", userId: user.id, ip: input.ip }, action: "auth.login_failed" });
    throw new AppError("UNAUTHENTICATED", INVALID);
  }

  const membership = await db.membership.findFirst({
    where: { userId: user.id, active: true, tenant: { status: "ACTIVE" } },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new AppError("FORBIDDEN", "Tu usuario no tiene acceso a ninguna barbería activa.");

  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_IDLE_MS);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } }),
    db.session.create({
      data: {
        tokenHash: sha256(token),
        userId: user.id,
        activeTenantId: membership.tenantId,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        expiresAt,
      },
    }),
  ]);
  await audit({
    tenantId: membership.tenantId,
    actor: { type: "STAFF", userId: user.id, ip: input.ip },
    action: "auth.login",
  });
  return { token, expiresAt: new Date(now + SESSION_ABSOLUTE_MS) };
}

export async function logout(token: string): Promise<void> {
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session || session.revokedAt) return;
  await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await audit({
    tenantId: session.activeTenantId,
    actor: { type: "STAFF", userId: session.userId },
    action: "auth.logout",
  });
}

/**
 * Valida el token de sesión y resuelve el tenant activo comprobando la membresía en BD.
 * El tenant NUNCA proviene del navegador: sale de la sesión y se revalida en cada petición.
 */
export async function resolveSession(token: string | undefined | null): Promise<AuthContext | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          memberships: {
            where: { active: true, tenant: { status: "ACTIVE" } },
            include: { tenant: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  const now = Date.now();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now) return null;
  if (session.createdAt.getTime() + SESSION_ABSOLUTE_MS <= now) return null;
  const user = session.user;
  if (user.disabledAt) return null;
  // Sesiones emitidas antes de un cambio de contraseña quedan invalidadas.
  if (user.passwordChangedAt && session.createdAt < user.passwordChangedAt) return null;

  const membership =
    user.memberships.find((m) => m.tenantId === session.activeTenantId) ?? user.memberships[0];
  if (!membership) return null;

  // Renovación deslizante (como mucho una escritura cada 5 minutos).
  if (now - session.lastSeenAt.getTime() > 5 * 60000 || membership.tenantId !== session.activeTenantId) {
    await db.session.update({
      where: { id: session.id },
      data: {
        lastSeenAt: new Date(now),
        expiresAt: new Date(
          Math.min(now + SESSION_IDLE_MS, session.createdAt.getTime() + SESSION_ABSOLUTE_MS),
        ),
        activeTenantId: membership.tenantId,
      },
    });
  }

  return {
    sessionId: session.id,
    userId: user.id,
    userName: user.name,
    email: user.email,
    tenantId: membership.tenantId,
    tenantSlug: membership.tenant.slug,
    tenantName: membership.tenant.name,
    tenantLogoUrl: membership.tenant.logoUrl,
    timezone: membership.tenant.timezone,
    currency: membership.tenant.currency,
    role: membership.role,
    barberId: membership.barberId,
    memberships: user.memberships.map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      role: m.role,
    })),
  };
}

export function assertCan(ctx: AuthContext, permission: Permission): void {
  if (!can(ctx.role, permission)) throw forbidden();
}

export async function switchTenant(ctx: AuthContext, tenantId: string): Promise<void> {
  const m = ctx.memberships.find((x) => x.tenantId === tenantId);
  if (!m) throw forbidden("No perteneces a esa barbería");
  await db.session.update({ where: { id: ctx.sessionId }, data: { activeTenantId: tenantId } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const r = await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return r.count;
}

export async function changePassword(ctx: AuthContext, current: string, next: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!(await verifyPassword(current, user.passwordHash)))
    throw new AppError("VALIDATION", "La contraseña actual no es correcta");
  const err = passwordPolicyError(next);
  if (err) throw new AppError("VALIDATION", err);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date(Date.now() - 1000) },
  });
  await revokeAllSessions(user.id, ctx.sessionId);
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "auth.password_changed",
  });
}

export async function purgeExpiredSessions(): Promise<number> {
  const r = await db.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date(Date.now() - 7 * 86400000) } },
        { revokedAt: { lt: new Date(Date.now() - 7 * 86400000) } },
      ],
    },
  });
  return r.count;
}
