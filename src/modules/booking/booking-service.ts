import { z } from "zod";
import type { AppointmentStatus, BookingSource, PaymentRequirement } from "@/generated/prisma/enums";
import type { Appointment, Prisma } from "@/generated/prisma/client";
import { getBookableService } from "@/modules/catalog";
import { enqueueJob } from "@/modules/jobs";
import { loadAvailability } from "@/modules/scheduling";
import type { Actor } from "@/shared/audit";
import { db, isOverlapViolation, isUniqueViolation, withTxRetry, type Tx } from "@/shared/db";
import { AppError, conflict, notFound, policy, validation } from "@/shared/errors";
import { normalizePhone } from "@/shared/phone";
import { addMinutes, localParts } from "@/shared/time";
import { createManageToken } from "./manage-token";
import { parseInput } from "@/shared/validation";

export const bookingInputSchema = z.object({
  branchId: z.uuid(),
  serviceId: z.uuid(),
  barberId: z.uuid().nullable().optional(),
  startsAt: z.iso.datetime({ offset: true }),
  customer: z.object({
    name: z.string().trim().min(2, "Indica tu nombre").max(80),
    phone: z.string().trim().min(6).max(25),
    email: z
      .union([z.email("Correo inválido").max(200), z.literal("")])
      .optional()
      .nullable()
      .transform((v) => (v ? v.toLowerCase() : null)),
  }),
  consents: z
    .object({
      whatsapp: z.boolean().default(false),
      email: z.boolean().default(false),
      marketing: z.boolean().default(false),
    })
    .default({ whatsapp: false, email: false, marketing: false }),
  acceptTerms: z.literal(true, { error: "Debes aceptar las condiciones de reserva" }),
  payOnline: z.boolean().default(false),
  customerNotes: z.string().trim().max(300).optional().nullable(),
  campaign: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .optional()
    .nullable()
    .catch(null),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export type BookingInput = z.input<typeof bookingInputSchema>;

export interface BookingResult {
  appointment: Appointment;
  manageToken: string;
  replay: boolean;
}

const ACTIVE: AppointmentStatus[] = ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "COMPLETED"];

export function manageTokenExpiry(startsAt: Date): Date {
  return addMinutes(startsAt, 24 * 60);
}

/** Decide cuánto se cobra online según la política de la barbería. El navegador no decide importes. */
export function paymentRequirementFor(
  policyName: "NONE" | "OPTIONAL" | "DEPOSIT_REQUIRED" | "FULL_REQUIRED",
  price: number,
  depositAmount: number,
  payOnline: boolean,
): { requirement: PaymentRequirement; amountDue: number } {
  if (price <= 0) return { requirement: "NONE", amountDue: 0 };
  switch (policyName) {
    case "FULL_REQUIRED":
      return { requirement: "FULL", amountDue: price };
    case "DEPOSIT_REQUIRED":
      return depositAmount > 0
        ? { requirement: "DEPOSIT", amountDue: Math.min(depositAmount, price) }
        : { requirement: "NONE", amountDue: 0 };
    case "OPTIONAL":
      return payOnline ? { requirement: "FULL", amountDue: price } : { requirement: "NONE", amountDue: 0 };
    default:
      return { requirement: "NONE", amountDue: 0 };
  }
}

/** Marca como EXPIRED los holds de pago vencidos (de un barbero o de todos). */
export async function expireStaleHolds(tx: Tx, now: Date, barberId?: string): Promise<number> {
  const stale = await tx.appointment.findMany({
    where: { status: "PENDING_PAYMENT", holdExpiresAt: { lte: now }, ...(barberId ? { barberId } : {}) },
    select: { id: true, tenantId: true },
    take: 500,
  });
  for (const a of stale) {
    const r = await tx.appointment.updateMany({
      where: { id: a.id, status: "PENDING_PAYMENT" },
      data: { status: "EXPIRED" },
    });
    if (r.count === 1) {
      await tx.appointmentEvent.create({
        data: {
          tenantId: a.tenantId,
          appointmentId: a.id,
          type: "expired",
          fromStatus: "PENDING_PAYMENT",
          toStatus: "EXPIRED",
          actorType: "SYSTEM",
        },
      });
    }
  }
  return stale.length;
}

async function emitBookingEvent(
  tx: Tx,
  tenantId: string,
  appointmentId: string,
  event: string,
  extra: Record<string, string> = {},
) {
  await enqueueJob(tx, {
    type: "booking.event",
    tenantId,
    payload: { appointmentId, event, ...extra },
    dedupeKey: `booking:${appointmentId}:${event}:${extra.at ?? ""}`,
  });
}

/**
 * Crea una reserva. Es el ÚNICO punto de creación: lo usan la web pública, el bot de WhatsApp y el panel.
 * El cliente no necesita cuenta: se crea/actualiza su ficha CRM dentro del tenant.
 */
export async function createBooking(
  tenantId: string,
  rawInput: BookingInput,
  opts: { source: BookingSource; actor: Actor; now?: Date },
): Promise<BookingResult> {
  const input = parseInput(bookingInputSchema, rawInput);
  const now = opts.now ?? new Date();
  const phone = normalizePhone(input.customer.phone);
  if (!phone) throw validation("Número de WhatsApp inválido. Usa el formato +56 9 1234 5678");

  if (input.idempotencyKey) {
    const existing = await db.appointment.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return replayResult(existing);
  }

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== "ACTIVE") throw notFound("Barbería");
  const service = await getBookableService(tenantId, input.branchId, input.serviceId);
  if (!service) throw validation("El servicio no está disponible en esta sucursal");
  const branch = await db.branch.findFirstOrThrow({ where: { id: input.branchId, tenantId } });

  const startsAt = new Date(input.startsAt);
  const date = localParts(startsAt, branch.timezone).date;
  const availability = await loadAvailability({
    tenantId,
    branchId: branch.id,
    service,
    barberId: input.barberId ?? null,
    date,
    now,
    ignoreBookingWindow: opts.source === "ADMIN",
  });
  const slot = availability.slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) throw new AppError("SLOT_UNAVAILABLE", "Ese horario ya no está disponible. Elige otro.");
  // "Cualquier profesional": candidatos ordenados por menor carga; si uno se ocupa en el instante, se prueba el siguiente.
  const candidates = input.barberId
    ? [input.barberId]
    : await rankBarbersByLoad(tenantId, slot.barberIds, startsAt, branch.timezone);

  const { requirement, amountDue } =
    opts.source === "ADMIN"
      ? { requirement: "NONE" as const, amountDue: 0 }
      : paymentRequirementFor(
          tenant.paymentPolicy,
          service.priceAmount,
          tenant.depositAmount,
          input.payOnline,
        );
  const status: AppointmentStatus = requirement === "NONE" ? "CONFIRMED" : "PENDING_PAYMENT";
  const endsAt = addMinutes(startsAt, service.durationMinutes);

  const insert = (barberId: string) =>
    withTxRetry(() =>
      db.$transaction(async (tx) => {
        await expireStaleHolds(tx, now, barberId);
        const customer = await upsertCustomer(tx, tenantId, {
          name: input.customer.name,
          phone,
          email: input.customer.email ?? null,
        });
        await recordBookingConsents(tx, tenantId, customer.id, {
          whatsapp: input.consents.whatsapp,
          email: input.consents.email && !!(input.customer.email ?? customer.email),
          marketing: input.consents.marketing,
          source: opts.source === "WHATSAPP" ? "whatsapp" : opts.source === "ADMIN" ? "admin" : "web_form",
        });
        const created = await tx.appointment.create({
          data: {
            tenantId,
            branchId: branch.id,
            barberId,
            serviceId: service.id,
            customerId: customer.id,
            status,
            source: opts.source,
            startsAt,
            endsAt,
            blockedUntil: addMinutes(endsAt, service.bufferMinutes),
            serviceName: service.name,
            priceAmount: service.priceAmount,
            currency: tenant.currency,
            durationMinutes: service.durationMinutes,
            bufferMinutes: service.bufferMinutes,
            paymentRequirement: requirement,
            amountDue,
            holdExpiresAt: status === "PENDING_PAYMENT" ? addMinutes(now, tenant.holdMinutes) : null,
            customerNotes: input.customerNotes ?? null,
            campaign: input.campaign ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            manageTokenExpiresAt: manageTokenExpiry(startsAt),
            createdById: opts.actor.userId ?? null,
          },
        });
        await tx.appointmentEvent.create({
          data: {
            tenantId,
            appointmentId: created.id,
            type: "created",
            toStatus: status,
            actorType: opts.actor.type,
            actorUserId: opts.actor.userId ?? null,
            data: { source: opts.source, priceAmount: service.priceAmount, amountDue },
          },
        });
        await emitBookingEvent(
          tx,
          tenantId,
          created.id,
          status === "CONFIRMED" ? "confirmed" : "pending_payment",
        );
        return created;
      }),
    );

  for (const barberId of candidates) {
    try {
      const appointment = await insert(barberId);
      return {
        appointment,
        manageToken: createManageToken(appointment.id, appointment.manageTokenVersion),
        replay: false,
      };
    } catch (err) {
      if (isOverlapViolation(err)) continue; // ese barbero se ocupó justo ahora: probar el siguiente
      if (input.idempotencyKey && isUniqueViolation(err)) {
        const existing = await db.appointment.findUnique({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
        });
        if (existing) return replayResult(existing);
      }
      throw err;
    }
  }
  throw new AppError("SLOT_UNAVAILABLE", "Alguien acaba de tomar ese horario. Elige otro, por favor.");
}

function replayResult(appointment: Appointment): BookingResult {
  return {
    appointment,
    manageToken: createManageToken(appointment.id, appointment.manageTokenVersion),
    replay: true,
  };
}

async function rankBarbersByLoad(
  tenantId: string,
  barberIds: string[],
  startsAt: Date,
  tz: string,
): Promise<string[]> {
  if (barberIds.length <= 1) return barberIds;
  const dayStart = addMinutes(startsAt, -localParts(startsAt, tz).minutesOfDay);
  const counts = await db.appointment.groupBy({
    by: ["barberId"],
    where: {
      tenantId,
      barberId: { in: barberIds },
      status: { in: ACTIVE },
      startsAt: { gte: dayStart, lt: addMinutes(dayStart, 1440) },
    },
    _count: { _all: true },
  });
  const load = (id: string) => counts.find((c) => c.barberId === id)?._count._all ?? 0;
  return [...barberIds].sort((a, b) => load(a) - load(b));
}

/**
 * Reutiliza la ficha si el teléfono ya existe en ESTE tenant. No sobrescribe el nombre registrado
 * (el personal pudo corregirlo) y nunca expone visitas anteriores al cliente.
 */
async function upsertCustomer(
  tx: Tx,
  tenantId: string,
  c: { name: string; phone: string; email: string | null },
) {
  const existing = await tx.customer.findUnique({
    where: { tenantId_phoneE164: { tenantId, phoneE164: c.phone } },
  });
  if (existing) {
    if (c.email && c.email !== existing.email) {
      return tx.customer.update({ where: { id: existing.id }, data: { email: c.email } });
    }
    return existing;
  }
  return tx.customer.create({ data: { tenantId, name: c.name, phoneE164: c.phone, email: c.email } });
}

/** Solo se registran consentimientos otorgados explícitamente; no revoca los existentes desde el formulario. */
async function recordBookingConsents(
  tx: Tx,
  tenantId: string,
  customerId: string,
  c: { whatsapp: boolean; email: boolean; marketing: boolean; source: string },
) {
  const grants: { channel: "WHATSAPP" | "EMAIL"; purpose: "TRANSACTIONAL" | "MARKETING" }[] = [];
  if (c.whatsapp) grants.push({ channel: "WHATSAPP", purpose: "TRANSACTIONAL" });
  if (c.email) grants.push({ channel: "EMAIL", purpose: "TRANSACTIONAL" });
  if (c.marketing && c.whatsapp) grants.push({ channel: "WHATSAPP", purpose: "MARKETING" });
  if (c.marketing && c.email) grants.push({ channel: "EMAIL", purpose: "MARKETING" });
  for (const g of grants) {
    await tx.communicationConsent.upsert({
      where: { customerId_channel_purpose: { customerId, channel: g.channel, purpose: g.purpose } },
      create: { tenantId, customerId, ...g, granted: true, source: c.source },
      update: { granted: true, source: c.source },
    });
  }
}

// ───────────── Transiciones de estado ─────────────

const TRANSITIONS: Record<string, { from: AppointmentStatus[]; to: AppointmentStatus }> = {
  confirm: { from: ["PENDING_PAYMENT", "EXPIRED"], to: "CONFIRMED" },
  cancel: { from: ["PENDING_PAYMENT", "CONFIRMED"], to: "CANCELLED" },
  check_in: { from: ["CONFIRMED"], to: "CHECKED_IN" },
  complete: { from: ["CONFIRMED", "CHECKED_IN"], to: "COMPLETED" },
  no_show: { from: ["CONFIRMED"], to: "NO_SHOW" },
};

export type TransitionName = keyof typeof TRANSITIONS;

/**
 * Aplica una transición con control de concurrencia optimista (solo actualiza si el estado no cambió).
 * `enforceCustomerPolicy`: aplica la ventana de cancelación de la barbería (acciones del cliente).
 */
export async function transitionAppointment(
  tenantId: string,
  appointmentId: string,
  name: TransitionName,
  opts: { actor: Actor; reason?: string | null; enforceCustomerPolicy?: boolean; now?: Date },
): Promise<Appointment> {
  const t = TRANSITIONS[name]!;
  const now = opts.now ?? new Date();
  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, tenantId },
    include: { tenant: true },
  });
  if (!appt) throw notFound("Reserva");
  if (appt.status === t.to) return appt;
  if (!t.from.includes(appt.status)) throw conflict(`No se puede pasar de ${appt.status} a ${t.to}`);
  if (name === "cancel" && opts.enforceCustomerPolicy) {
    const limit = addMinutes(appt.startsAt, -appt.tenant.cancellationWindowMinutes);
    if (now > limit) {
      throw policy(
        `Las cancelaciones en línea se aceptan hasta ${Math.round(appt.tenant.cancellationWindowMinutes / 60)} h antes. Contáctanos directamente.`,
      );
    }
  }
  if (
    ["check_in", "no_show", "complete"].includes(name) &&
    appt.startsAt.getTime() - now.getTime() > 2 * 3600 * 1000
  ) {
    throw policy("Solo puedes registrar llegada, atención o ausencia cerca de la hora de la cita");
  }
  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        const data: Prisma.AppointmentUncheckedUpdateManyInput = { status: t.to };
        if (name === "cancel")
          Object.assign(data, { cancelledAt: now, cancelReason: opts.reason ?? null, holdExpiresAt: null });
        if (name === "check_in") data.checkedInAt = now;
        if (name === "complete") data.completedAt = now;
        if (name === "confirm") data.holdExpiresAt = null;
        const r = await tx.appointment.updateMany({ where: { id: appt.id, status: appt.status }, data });
        if (r.count !== 1) throw conflict("La reserva cambió mientras tanto. Recarga e inténtalo de nuevo.");
        await tx.appointmentEvent.create({
          data: {
            tenantId,
            appointmentId: appt.id,
            type:
              name === "check_in"
                ? "checked_in"
                : name === "no_show"
                  ? "no_show"
                  : `${name === "confirm" ? "confirmed" : name === "cancel" ? "cancelled" : "completed"}`,
            fromStatus: appt.status,
            toStatus: t.to,
            actorType: opts.actor.type,
            actorUserId: opts.actor.userId ?? null,
            data: opts.reason ? { reason: opts.reason } : undefined,
          },
        });
        if (name === "complete") {
          await tx.customer.update({
            where: { id: appt.customerId },
            data: { visitCount: { increment: 1 }, lastVisitAt: appt.startsAt },
          });
          await emitBookingEvent(tx, tenantId, appt.id, "completed");
        }
        if (name === "no_show") {
          await tx.customer.update({
            where: { id: appt.customerId },
            data: { noShowCount: { increment: 1 } },
          });
        }
        if (name === "cancel") await emitBookingEvent(tx, tenantId, appt.id, "cancelled");
        if (name === "confirm") await emitBookingEvent(tx, tenantId, appt.id, "confirmed");
        return tx.appointment.findUniqueOrThrow({ where: { id: appt.id } });
      }),
    );
  } catch (err) {
    // Confirmar un hold EXPIRED puede chocar con otra cita que ya tomó el horario.
    if (isOverlapViolation(err))
      throw new AppError("SLOT_UNAVAILABLE", "El horario ya fue ocupado por otra reserva");
    throw err;
  }
}

/** Reprograma (mismo servicio) validando disponibilidad real. */
export async function rescheduleAppointment(
  tenantId: string,
  appointmentId: string,
  input: { startsAt: string; barberId?: string | null },
  opts: { actor: Actor; enforceCustomerPolicy?: boolean; now?: Date },
): Promise<Appointment> {
  const now = opts.now ?? new Date();
  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, tenantId },
    include: { tenant: true, branch: true },
  });
  if (!appt) throw notFound("Reserva");
  if (appt.status !== "CONFIRMED") throw conflict("Solo se pueden reprogramar reservas confirmadas");
  if (opts.enforceCustomerPolicy && now > addMinutes(appt.startsAt, -appt.tenant.rescheduleWindowMinutes)) {
    throw policy("Ya no es posible reprogramar en línea. Contáctanos directamente.");
  }
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw validation("Fecha inválida");
  const barberId = input.barberId ?? appt.barberId;
  const availability = await loadAvailability({
    tenantId,
    branchId: appt.branchId,
    service: { id: appt.serviceId, durationMinutes: appt.durationMinutes, bufferMinutes: appt.bufferMinutes },
    barberId,
    date: localParts(startsAt, appt.branch.timezone).date,
    now,
    excludeAppointmentId: appt.id,
    ignoreBookingWindow: opts.actor.type === "STAFF",
  });
  if (
    !availability.slots.some(
      (s) => s.startsAt.getTime() === startsAt.getTime() && s.barberIds.includes(barberId),
    )
  ) {
    throw new AppError("SLOT_UNAVAILABLE", "Ese horario no está disponible");
  }
  const endsAt = addMinutes(startsAt, appt.durationMinutes);
  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        const r = await tx.appointment.updateMany({
          where: { id: appt.id, status: "CONFIRMED", startsAt: appt.startsAt },
          data: {
            startsAt,
            endsAt,
            blockedUntil: addMinutes(endsAt, appt.bufferMinutes),
            barberId,
            manageTokenExpiresAt: manageTokenExpiry(startsAt),
          },
        });
        if (r.count !== 1) throw conflict("La reserva cambió mientras tanto. Recarga e inténtalo de nuevo.");
        await tx.appointmentEvent.create({
          data: {
            tenantId,
            appointmentId: appt.id,
            type: "rescheduled",
            fromStatus: "CONFIRMED",
            toStatus: "CONFIRMED",
            actorType: opts.actor.type,
            actorUserId: opts.actor.userId ?? null,
            data: {
              from: appt.startsAt.toISOString(),
              to: startsAt.toISOString(),
              fromBarber: appt.barberId,
              toBarber: barberId,
            },
          },
        });
        await emitBookingEvent(tx, tenantId, appt.id, "rescheduled", { at: startsAt.toISOString() });
        return tx.appointment.findUniqueOrThrow({ where: { id: appt.id } });
      }),
    );
  } catch (err) {
    if (isOverlapViolation(err)) throw new AppError("SLOT_UNAVAILABLE", "Ese horario acaba de ser ocupado");
    throw err;
  }
}

/** Revoca el enlace de gestión (p. ej. si el cliente lo compartió por error). */
export async function revokeManageToken(
  tenantId: string,
  appointmentId: string,
  actor: Actor,
): Promise<void> {
  const r = await db.appointment.updateMany({
    where: { id: appointmentId, tenantId },
    data: { manageTokenVersion: { increment: 1 } },
  });
  if (r.count !== 1) throw notFound("Reserva");
  await db.appointmentEvent.create({
    data: {
      tenantId,
      appointmentId,
      type: "manage_link_revoked",
      actorType: actor.type,
      actorUserId: actor.userId ?? null,
    },
  });
}

/**
 * Llamado por el módulo de pagos cuando un pago queda APROBADO y verificado.
 * Devuelve qué pasó para que pagos decida (p. ej. marcar reembolso si la reserva ya no es válida).
 */
export async function applyApprovedPayment(
  tenantId: string,
  appointmentId: string,
): Promise<"confirmed" | "already_confirmed" | "revived" | "slot_taken" | "cancelled"> {
  const appt = await db.appointment.findFirst({ where: { id: appointmentId, tenantId } });
  if (!appt) throw notFound("Reserva");
  if (["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(appt.status)) return "already_confirmed";
  if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") return "cancelled";
  try {
    await transitionAppointment(tenantId, appointmentId, "confirm", { actor: { type: "PROVIDER" } });
    return appt.status === "EXPIRED" ? "revived" : "confirmed";
  } catch (err) {
    if (err instanceof AppError && err.code === "SLOT_UNAVAILABLE") return "slot_taken";
    throw err;
  }
}
