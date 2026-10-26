import type { AppointmentStatus } from "@/generated/prisma/enums";
import { assertCan, can, type AuthContext } from "@/modules/identity";
import { db } from "@/shared/db";
import { forbidden, notFound } from "@/shared/errors";
import { normalizePhone } from "@/shared/phone";
import { createManageToken, parseManageToken } from "./manage-token";

const listInclude = {
  customer: { select: { id: true, name: true, phoneE164: true, email: true } },
  barber: { select: { id: true, displayName: true } },
  branch: { select: { id: true, name: true, timezone: true } },
  payments: { select: { id: true, status: true, amount: true, provider: true } },
} as const;

/**
 * Citas en un rango. Un BARBERO solo ve las suyas (filtro forzado en el servidor).
 */
export async function listAppointments(
  ctx: AuthContext,
  filter: { from: Date; to: Date; branchId?: string; barberId?: string; status?: AppointmentStatus[] },
) {
  let barberId = filter.barberId;
  if (!can(ctx.role, "agenda.view")) {
    if (!ctx.barberId) throw forbidden();
    barberId = ctx.barberId;
  }
  return db.appointment.findMany({
    where: {
      tenantId: ctx.tenantId,
      startsAt: { gte: filter.from, lt: filter.to },
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(barberId ? { barberId } : {}),
      ...(filter.status?.length ? { status: { in: filter.status } } : {}),
    },
    include: listInclude,
    orderBy: { startsAt: "asc" },
    take: 2000,
  });
}

export type AgendaAppointment = Awaited<ReturnType<typeof listAppointments>>[number];

export async function getAppointmentDetail(ctx: AuthContext, appointmentId: string) {
  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, tenantId: ctx.tenantId },
    include: {
      ...listInclude,
      service: { select: { id: true, name: true } },
      events: { orderBy: { createdAt: "desc" }, take: 50 },
      payments: { include: { refunds: true }, orderBy: { createdAt: "desc" } },
      notifications: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!appt) throw notFound("Reserva");
  if (!can(ctx.role, "agenda.view") && appt.barberId !== ctx.barberId) throw notFound("Reserva");
  return appt;
}

/** Comprueba que el miembro puede operar sobre la cita (personal o el barbero asignado). */
export async function assertCanOperate(ctx: AuthContext, appointmentId: string, onlyAttendance = false) {
  if (can(ctx.role, "appointments.manage")) return;
  if (onlyAttendance && ctx.barberId) {
    const appt = await db.appointment.findFirst({
      where: { id: appointmentId, tenantId: ctx.tenantId },
      select: { barberId: true },
    });
    if (appt?.barberId === ctx.barberId) return;
  }
  assertCan(ctx, "appointments.manage");
}

/** Genera de nuevo el enlace de gestión de una cita (para mensajes y para el panel). */
export async function getManageTokenFor(tenantId: string, appointmentId: string): Promise<string | null> {
  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, tenantId },
    select: { id: true, manageTokenVersion: true, manageTokenRevokedAt: true },
  });
  if (!appt || appt.manageTokenRevokedAt) return null;
  return createManageToken(appt.id, appt.manageTokenVersion);
}

// ───────────── Acceso público mediante token ─────────────

export type ManageTokenCheck =
  | { ok: true; appointmentId: string; tenantId: string }
  | { ok: false; reason: "invalid" | "revoked" | "expired" };

/** Valida firma, versión (revocación) y expiración. */
export async function verifyManageToken(token: string, now = new Date()): Promise<ManageTokenCheck> {
  const parsed = parseManageToken(token);
  if (!parsed) return { ok: false, reason: "invalid" };
  const appt = await db.appointment.findUnique({
    where: { id: parsed.appointmentId },
    select: {
      id: true,
      tenantId: true,
      manageTokenVersion: true,
      manageTokenExpiresAt: true,
      manageTokenRevokedAt: true,
    },
  });
  if (!appt) return { ok: false, reason: "invalid" };
  if (appt.manageTokenRevokedAt || appt.manageTokenVersion !== parsed.version)
    return { ok: false, reason: "revoked" };
  if (appt.manageTokenExpiresAt && appt.manageTokenExpiresAt < now) return { ok: false, reason: "expired" };
  return { ok: true, appointmentId: appt.id, tenantId: appt.tenantId };
}

/**
 * Datos de UNA reserva para el cliente. No incluye historial de visitas ni otras reservas.
 */
export async function getPublicAppointment(tenantId: string, appointmentId: string) {
  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, tenantId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      serviceName: true,
      serviceId: true,
      priceAmount: true,
      currency: true,
      amountDue: true,
      paymentRequirement: true,
      holdExpiresAt: true,
      durationMinutes: true,
      branchId: true,
      barberId: true,
      customer: { select: { name: true } },
      barber: { select: { displayName: true } },
      branch: { select: { name: true, address: true, timezone: true } },
      tenant: {
        select: {
          slug: true,
          name: true,
          logoUrl: true,
          cancellationWindowMinutes: true,
          rescheduleWindowMinutes: true,
          publicPhone: true,
        },
      },
      payments: {
        select: { id: true, status: true, checkoutUrl: true, amount: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  return appt;
}

export type PublicAppointment = NonNullable<Awaited<ReturnType<typeof getPublicAppointment>>>;

/**
 * Reservas futuras de un número que escribe por WhatsApp. El número viene verificado por Meta
 * (es el remitente del mensaje), por eso es seguro mostrarle SUS propias reservas.
 * No usar con un teléfono escrito por un tercero en un formulario.
 */
export async function upcomingAppointmentsForVerifiedPhone(
  tenantId: string,
  waPhone: string,
  now = new Date(),
) {
  const phone = normalizePhone(waPhone);
  if (!phone) return [];
  return db.appointment.findMany({
    where: {
      tenantId,
      customer: { phoneE164: phone },
      status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
      startsAt: { gte: now },
    },
    include: {
      barber: { select: { displayName: true } },
      branch: { select: { timezone: true, name: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 5,
  });
}

export async function findAppointmentOrThrow(tenantId: string, appointmentId: string) {
  const appt = await db.appointment.findFirst({ where: { id: appointmentId, tenantId } });
  if (!appt) throw notFound("Reserva");
  return appt;
}
