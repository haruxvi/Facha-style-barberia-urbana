import { z } from "zod";
import type { AutomationTrigger } from "@/generated/prisma/enums";
import { assertCan, type AuthContext } from "@/modules/identity";
import { enqueueNotification } from "@/modules/messaging";
import { audit } from "@/shared/audit";
import { db } from "@/shared/db";
import { notFound } from "@/shared/errors";
import { addMinutes } from "@/shared/time";
import { parseInput } from "@/shared/validation";

/** Qué automatizaciones dispara cada evento de reserva. */
const EVENT_TRIGGERS: Record<string, AutomationTrigger[]> = {
  confirmed: ["BOOKING_CONFIRMED", "REMINDER", "OWNER_NEW_BOOKING"],
  rescheduled: ["RESCHEDULED", "REMINDER"],
  cancelled: ["CANCELLED"],
  completed: ["POST_VISIT", "REVIEW_REQUEST"],
};

/**
 * Handler del evento outbox "booking.event". Idempotente: cada notificación tiene un dedupeKey
 * determinista (cita + disparador + canal + hora), así que reprocesar el evento no duplica nada.
 */
export async function onBookingEvent(payload: { appointmentId?: unknown; event?: unknown }): Promise<void> {
  const appointmentId = String(payload.appointmentId ?? "");
  const event = String(payload.event ?? "");
  const triggers = EVENT_TRIGGERS[event];
  if (!triggers) return;
  const appt = await db.appointment.findUnique({ where: { id: appointmentId } });
  if (!appt) return;
  const rules = await db.automationRule.findMany({
    where: { tenantId: appt.tenantId, active: true, trigger: { in: triggers } },
  });
  const now = new Date();
  const startsIso = appt.startsAt.toISOString();

  if (event === "cancelled") {
    // Los recordatorios pendientes se descartan ya (además se revalida al enviar).
    await db.notification.updateMany({
      where: {
        appointmentId: appt.id,
        status: "QUEUED",
        trigger: { in: ["REMINDER", "POST_VISIT", "REVIEW_REQUEST"] },
      },
      data: { status: "CANCELLED", error: "Reserva cancelada" },
    });
  }

  await db.$transaction(async (tx) => {
    for (const rule of rules) {
      // El bot ya confirmó en la propia conversación: no repetir la confirmación por WhatsApp.
      if (
        rule.trigger === "BOOKING_CONFIRMED" &&
        rule.channel === "WHATSAPP" &&
        appt.source === "WHATSAPP" &&
        appt.paymentRequirement === "NONE"
      ) {
        continue;
      }
      let scheduledFor = now;
      if (rule.trigger === "REMINDER") {
        scheduledFor = addMinutes(appt.startsAt, -rule.offsetMinutes);
        if (scheduledFor <= now) continue; // ya no tiene sentido recordar
      } else if (rule.trigger === "POST_VISIT" || rule.trigger === "REVIEW_REQUEST") {
        scheduledFor = addMinutes(now, rule.offsetMinutes);
      }

      if (rule.trigger === "OWNER_NEW_BOOKING") {
        const owners = await tx.membership.findMany({
          where: { tenantId: appt.tenantId, role: { in: ["OWNER", "ADMIN"] }, active: true },
          include: { user: { select: { email: true } } },
        });
        if (rule.channel !== "EMAIL") continue;
        for (const o of owners) {
          await enqueueNotification(tx, {
            tenantId: appt.tenantId,
            channel: "EMAIL",
            customerId: null,
            appointmentId: appt.id,
            trigger: rule.trigger,
            templateKey: rule.templateKey,
            destination: o.user.email,
            dedupeKey: `auto:${appt.id}:${rule.trigger}:${o.userId}`,
            purpose: "INTERNAL",
          });
        }
        continue;
      }

      await enqueueNotification(tx, {
        tenantId: appt.tenantId,
        channel: rule.channel,
        customerId: appt.customerId,
        appointmentId: appt.id,
        trigger: rule.trigger,
        templateKey: rule.templateKey,
        dedupeKey: `auto:${appt.id}:${rule.trigger}:${rule.channel}:${startsIso}`,
        scheduledFor,
        purpose: "TRANSACTIONAL",
        expectedStartsAt: ["REMINDER", "RESCHEDULED"].includes(rule.trigger) ? startsIso : undefined,
      });
    }
  });
}

/**
 * Seguimiento de clientes inactivos (cron diario). Solo con consentimiento de MARKETING.
 * Un mensaje como máximo por cada última visita.
 */
export async function runInactiveFollowups(now = new Date()): Promise<number> {
  const rules = await db.automationRule.findMany({ where: { trigger: "INACTIVE_FOLLOWUP", active: true } });
  let count = 0;
  for (const rule of rules) {
    const threshold = addMinutes(now, -rule.offsetMinutes);
    const customers = await db.customer.findMany({
      where: {
        tenantId: rule.tenantId,
        anonymizedAt: null,
        lastVisitAt: { lt: threshold },
        consents: { some: { channel: rule.channel, purpose: "MARKETING", granted: true } },
        appointments: { none: { startsAt: { gte: now }, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } } },
      },
      take: 200,
    });
    for (const c of customers) {
      const id = await db.$transaction((tx) =>
        enqueueNotification(tx, {
          tenantId: rule.tenantId,
          channel: rule.channel,
          customerId: c.id,
          trigger: "INACTIVE_FOLLOWUP",
          templateKey: rule.templateKey,
          dedupeKey: `inactive:${c.id}:${rule.channel}:${c.lastVisitAt?.toISOString().slice(0, 10)}`,
          purpose: "MARKETING",
        }),
      );
      if (id) count++;
    }
  }
  return count;
}

// ───────────── Administración de reglas ─────────────

export async function listAutomationRules(ctx: AuthContext) {
  return db.automationRule.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ trigger: "asc" }, { channel: "asc" }],
  });
}

const ruleUpdateSchema = z.object({
  active: z.boolean(),
  offsetMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(365 * 1440),
  templateKey: z.string().regex(/^[a-z0-9_]{2,40}$/),
});

export async function updateAutomationRule(
  ctx: AuthContext,
  ruleId: string,
  input: z.input<typeof ruleUpdateSchema>,
) {
  assertCan(ctx, "automations.manage");
  const data = parseInput(ruleUpdateSchema, input);
  const rule = await db.automationRule.findFirst({ where: { id: ruleId, tenantId: ctx.tenantId } });
  if (!rule) throw notFound("Automatización");
  const tpl = await db.messageTemplate.findUnique({
    where: { tenantId_key_channel: { tenantId: ctx.tenantId, key: data.templateKey, channel: rule.channel } },
  });
  if (!tpl) throw notFound("Plantilla para ese canal");
  await db.automationRule.update({ where: { id: rule.id }, data });
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "automation.updated",
    entityType: "AutomationRule",
    entityId: rule.id,
    metadata: { active: data.active, offsetMinutes: data.offsetMinutes },
  });
}
