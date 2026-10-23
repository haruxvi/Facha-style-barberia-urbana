import { z } from "zod";
import type { Role } from "@/generated/prisma/enums";
import { audit } from "@/shared/audit";
import { randomToken, sha256 } from "@/shared/crypto";
import { db } from "@/shared/db";
import { appUrl } from "@/shared/env";
import { AppError, conflict, forbidden, notFound, validation } from "@/shared/errors";
import { escapeHtml } from "@/shared/html";
import { hitRateLimit } from "@/shared/rate-limit";
import { assertCan, revokeAllSessions, type AuthContext } from "./auth-service";
import { hashPassword, passwordPolicyError, verifyPassword } from "./password";
import { parseInput } from "@/shared/validation";

/** Envío de correo inyectado por la capa de composición (evita acoplar identity a messaging). */
export type Mailer = (msg: { to: string; subject: string; text: string; html: string }) => Promise<void>;

const RESET_TTL_MIN = 30;
const INVITE_TTL_DAYS = 7;

// ───────────── Recuperación de contraseña ─────────────

/** Siempre responde igual exista o no el correo (no revela cuentas). */
export async function requestPasswordReset(rawEmail: string, ip: string | null, send: Mailer): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const limit = await hitRateLimit(`reset:${ip ?? "?"}`, 5, 15 * 60);
  const limitEmail = await hitRateLimit(`reset:email:${email}`, 3, 60 * 60);
  if (!limit.allowed || !limitEmail.allowed) return;
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.disabledAt) return;
  const token = randomToken(32);
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60000),
    },
  });
  const url = appUrl(`/admin/restablecer?token=${encodeURIComponent(token)}`);
  await send({
    to: user.email,
    subject: "Restablecer tu contraseña",
    text: `Hola ${user.name}. Para crear una nueva contraseña abre este enlace (válido ${RESET_TTL_MIN} minutos): ${url}\nSi no lo solicitaste, ignora este correo.`,
    html: `<p>Hola ${escapeHtml(user.name)}.</p><p>Para crear una nueva contraseña abre <a href="${url}">este enlace</a> (válido ${RESET_TTL_MIN} minutos).</p><p>Si no lo solicitaste, ignora este correo.</p>`,
  });
  await audit({ actor: { type: "STAFF", userId: user.id, ip }, action: "auth.password_reset_requested" });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const err = passwordPolicyError(newPassword);
  if (err) throw validation(err);
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("VALIDATION", "El enlace no es válido o ha expirado. Solicita uno nuevo.");
  }
  // Marca de uso atómica: un token solo sirve una vez aunque llegue dos veces a la vez.
  const used = await db.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (used.count !== 1) throw new AppError("VALIDATION", "El enlace ya fue utilizado.");
  await db.user.update({
    where: { id: record.userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await revokeAllSessions(record.userId);
  await audit({ actor: { type: "STAFF", userId: record.userId }, action: "auth.password_reset" });
}

// ───────────── Miembros e invitaciones ─────────────

export async function listMembers(ctx: AuthContext) {
  assertCan(ctx, "users.manage");
  const [members, invitations] = await Promise.all([
    db.membership.findMany({
      where: { tenantId: ctx.tenantId },
      include: { user: { select: { id: true, name: true, email: true, disabledAt: true } }, barber: true },
      orderBy: { createdAt: "asc" },
    }),
    db.invitation.findMany({
      where: { tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { members, invitations };
}

const inviteSchema = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  role: z.enum(["ADMIN", "BARBER", "RECEPTIONIST", "OWNER"]),
});

/** Crea una invitación de un solo uso y con expiración. Devuelve la URL para compartirla. */
export async function inviteMember(
  ctx: AuthContext,
  input: { email: string; role: Role },
  send?: Mailer,
): Promise<{ url: string }> {
  assertCan(ctx, "users.manage");
  const data = parseInput(inviteSchema, input);
  const existing = await db.membership.findFirst({
    where: { tenantId: ctx.tenantId, user: { email: data.email } },
  });
  if (existing) throw conflict("Esa persona ya es miembro de la barbería");
  const token = randomToken(32);
  await db.invitation.create({
    data: {
      tenantId: ctx.tenantId,
      email: data.email,
      role: data.role,
      tokenHash: sha256(token),
      invitedById: ctx.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400000),
    },
  });
  const url = appUrl(`/admin/invitacion?token=${encodeURIComponent(token)}`);
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "member.invited",
    metadata: { role: data.role },
  });
  if (send) {
    await send({
      to: data.email,
      subject: `Invitación a ${ctx.tenantName}`,
      text: `Te invitaron a ${ctx.tenantName}. Acepta aquí (válido ${INVITE_TTL_DAYS} días): ${url}`,
      html: `<p>Te invitaron a <b>${escapeHtml(ctx.tenantName)}</b>.</p><p><a href="${url}">Aceptar invitación</a> (válido ${INVITE_TTL_DAYS} días)</p>`,
    });
  }
  return { url };
}

export async function getInvitation(token: string) {
  const inv = await db.invitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { tenant: true },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  const userExists = !!(await db.user.findUnique({ where: { email: inv.email }, select: { id: true } }));
  return { email: inv.email, role: inv.role, tenantName: inv.tenant.name, userExists };
}

export async function acceptInvitation(
  token: string,
  input: { name?: string; password: string },
): Promise<void> {
  const inv = await db.invitation.findUnique({ where: { tokenHash: sha256(token) } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) {
    throw validation("La invitación no es válida o ha expirado");
  }
  const user = await db.user.findUnique({ where: { email: inv.email } });
  await db.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw validation("La invitación ya fue utilizada");
    let userId: string;
    if (user) {
      // Cuenta existente: debe demostrar que es su dueño.
      if (!(await verifyPassword(input.password, user.passwordHash)))
        throw validation("Contraseña incorrecta");
      userId = user.id;
    } else {
      const err = passwordPolicyError(input.password);
      if (err) throw validation(err);
      if (!input.name || input.name.trim().length < 2) throw validation("Indica tu nombre");
      const created = await tx.user.create({
        data: { email: inv.email, name: input.name.trim(), passwordHash: await hashPassword(input.password) },
      });
      userId = created.id;
    }
    await tx.membership.create({ data: { tenantId: inv.tenantId, userId, role: inv.role } });
    await audit({ tenantId: inv.tenantId, actor: { type: "STAFF", userId }, action: "member.joined" }, tx);
  });
}

export async function revokeInvitation(ctx: AuthContext, invitationId: string): Promise<void> {
  assertCan(ctx, "users.manage");
  const r = await db.invitation.updateMany({
    where: { id: invitationId, tenantId: ctx.tenantId, acceptedAt: null },
    data: { revokedAt: new Date() },
  });
  if (r.count !== 1) throw notFound("Invitación");
}

export async function updateMember(
  ctx: AuthContext,
  membershipId: string,
  input: { role?: Role; active?: boolean; barberId?: string | null },
): Promise<void> {
  assertCan(ctx, "users.manage");
  const m = await db.membership.findFirst({ where: { id: membershipId, tenantId: ctx.tenantId } });
  if (!m) throw notFound("Miembro");
  if (m.userId === ctx.userId && (input.role !== undefined || input.active === false)) {
    throw forbidden("No puedes cambiar tu propio rol ni desactivarte");
  }
  if (m.role === "OWNER" && (input.role !== "OWNER" || input.active === false)) {
    const owners = await db.membership.count({
      where: { tenantId: ctx.tenantId, role: "OWNER", active: true },
    });
    if (owners <= 1) throw forbidden("La barbería debe tener al menos un dueño activo");
  }
  if (input.barberId) {
    const barber = await db.barber.findFirst({ where: { id: input.barberId, tenantId: ctx.tenantId } });
    if (!barber) throw notFound("Barbero");
  }
  await db.membership.update({
    where: { id: m.id },
    data: { role: input.role, active: input.active, barberId: input.barberId },
  });
  if (input.active === false) await revokeAllSessions(m.userId);
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "member.updated",
    entityType: "Membership",
    entityId: m.id,
    metadata: { role: input.role ?? null, active: input.active ?? null },
  });
}

// ───────────── Alta de barberías ─────────────

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/, "Usa minúsculas, números y guiones (3-50 caracteres)");

const DEFAULT_TEMPLATES = [
  {
    key: "booking_confirmed",
    name: "Confirmación de reserva",
    subject: "Tu reserva en {{barbershop_name}} está confirmada",
    body: "Hola {{customer_name}}, tu reserva de {{service_name}} con {{barber_name}} quedó confirmada para el {{appointment_date}} a las {{appointment_time}}. Para cambiarla o cancelarla: {{management_url}}",
  },
  {
    key: "reminder",
    name: "Recordatorio",
    subject: "Recordatorio: tu cita en {{barbershop_name}}",
    body: "Hola {{customer_name}}, te recordamos tu cita de {{service_name}} el {{appointment_date}} a las {{appointment_time}} con {{barber_name}}. Gestiona tu reserva: {{management_url}}",
  },
  {
    key: "rescheduled",
    name: "Cambio de hora",
    subject: "Tu reserva cambió de hora",
    body: "Hola {{customer_name}}, tu cita de {{service_name}} ahora es el {{appointment_date}} a las {{appointment_time}} con {{barber_name}}. Detalles: {{management_url}}",
  },
  {
    key: "cancelled",
    name: "Cancelación",
    subject: "Tu reserva fue cancelada",
    body: "Hola {{customer_name}}, tu cita de {{service_name}} del {{appointment_date}} a las {{appointment_time}} fue cancelada. Puedes reservar de nuevo cuando quieras en {{booking_url}}",
  },
  {
    key: "post_visit",
    name: "Gracias por tu visita",
    subject: "¡Gracias por venir a {{barbershop_name}}!",
    body: "¡Gracias por tu visita, {{customer_name}}! Te esperamos de vuelta. Reserva tu próxima cita en {{booking_url}}",
  },
  {
    key: "review_request",
    name: "Solicitud de reseña",
    subject: "¿Cómo te fue en {{barbershop_name}}?",
    body: "Hola {{customer_name}}, ¿nos cuentas cómo te fue? Tu opinión nos ayuda mucho.",
  },
  {
    key: "inactive_followup",
    name: "Cliente inactivo",
    subject: "Te extrañamos en {{barbershop_name}}",
    body: "Hola {{customer_name}}, hace tiempo que no te vemos. Reserva cuando quieras en {{booking_url}}",
  },
  {
    key: "owner_new_booking",
    name: "Aviso interno: nueva reserva",
    subject: "Nueva reserva: {{service_name}} {{appointment_date}} {{appointment_time}}",
    body: "Nueva reserva de {{customer_name}}: {{service_name}} con {{barber_name}} el {{appointment_date}} a las {{appointment_time}}.",
  },
] as const;

/** Crea una barbería con su configuración por defecto y el usuario dado como OWNER. */
export async function createTenant(input: {
  name: string;
  slug: string;
  ownerUserId: string;
  timezone?: string;
  currency?: string;
}): Promise<{ id: string; slug: string }> {
  const slug = parseInput(tenantSlugSchema, input.slug);
  if (await db.tenant.findUnique({ where: { slug } }))
    throw conflict("Ese identificador (slug) ya está en uso");
  return db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: input.name.trim(),
        slug,
        timezone: input.timezone ?? "America/Santiago",
        currency: input.currency ?? "CLP",
        subscription: { create: {} },
      },
    });
    await tx.membership.create({ data: { tenantId: tenant.id, userId: input.ownerUserId, role: "OWNER" } });
    for (const channel of ["WHATSAPP", "EMAIL"] as const) {
      await tx.messageTemplate.createMany({
        data: DEFAULT_TEMPLATES.map((t) => ({
          tenantId: tenant.id,
          channel,
          key: t.key,
          name: t.name,
          subject: channel === "EMAIL" ? t.subject : null,
          body: t.body,
        })),
      });
    }
    await tx.automationRule.createMany({
      data: [
        {
          tenantId: tenant.id,
          trigger: "BOOKING_CONFIRMED",
          channel: "WHATSAPP",
          templateKey: "booking_confirmed",
          active: true,
        },
        {
          tenantId: tenant.id,
          trigger: "BOOKING_CONFIRMED",
          channel: "EMAIL",
          templateKey: "booking_confirmed",
          active: true,
        },
        {
          tenantId: tenant.id,
          trigger: "REMINDER",
          channel: "WHATSAPP",
          templateKey: "reminder",
          offsetMinutes: 24 * 60,
          active: true,
        },
        {
          tenantId: tenant.id,
          trigger: "REMINDER",
          channel: "EMAIL",
          templateKey: "reminder",
          offsetMinutes: 24 * 60,
          active: false,
        },
        {
          tenantId: tenant.id,
          trigger: "RESCHEDULED",
          channel: "WHATSAPP",
          templateKey: "rescheduled",
          active: true,
        },
        {
          tenantId: tenant.id,
          trigger: "RESCHEDULED",
          channel: "EMAIL",
          templateKey: "rescheduled",
          active: true,
        },
        {
          tenantId: tenant.id,
          trigger: "CANCELLED",
          channel: "WHATSAPP",
          templateKey: "cancelled",
          active: true,
        },
        {
          tenantId: tenant.id,
          trigger: "CANCELLED",
          channel: "EMAIL",
          templateKey: "cancelled",
          active: true,
        },
        {
          tenantId: tenant.id,
          trigger: "POST_VISIT",
          channel: "WHATSAPP",
          templateKey: "post_visit",
          offsetMinutes: 120,
          active: false,
        },
        {
          tenantId: tenant.id,
          trigger: "REVIEW_REQUEST",
          channel: "EMAIL",
          templateKey: "review_request",
          offsetMinutes: 24 * 60,
          active: false,
        },
        {
          tenantId: tenant.id,
          trigger: "INACTIVE_FOLLOWUP",
          channel: "WHATSAPP",
          templateKey: "inactive_followup",
          offsetMinutes: 60 * 1440,
          active: false,
        },
        {
          tenantId: tenant.id,
          trigger: "OWNER_NEW_BOOKING",
          channel: "EMAIL",
          templateKey: "owner_new_booking",
          active: false,
        },
      ],
    });
    await tx.qrCampaign.createMany({
      data: [
        { tenantId: tenant.id, code: "mostrador", label: "Mostrador" },
        { tenantId: tenant.id, code: "espejo", label: "Espejo" },
        { tenantId: tenant.id, code: "tarjeta", label: "Tarjeta de presentación" },
        { tenantId: tenant.id, code: "instagram", label: "Instagram" },
      ],
    });
    await audit(
      { tenantId: tenant.id, actor: { type: "STAFF", userId: input.ownerUserId }, action: "tenant.created" },
      tx,
    );
    return { id: tenant.id, slug: tenant.slug };
  });
}

/** Alta segura del primer dueño (CLI). La contraseña la elige quien ejecuta el script. */
export async function createOwnerUser(input: { email: string; name: string; password: string }) {
  const email = parseInput(z.email(), input.email.trim().toLowerCase());
  const err = passwordPolicyError(input.password);
  if (err) throw validation(err);
  if (await db.user.findUnique({ where: { email } })) throw conflict("Ya existe un usuario con ese correo");
  return db.user.create({
    data: { email, name: input.name.trim(), passwordHash: await hashPassword(input.password) },
  });
}
