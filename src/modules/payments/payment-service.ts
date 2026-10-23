import type { PaymentProvider } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { applyApprovedPayment } from "@/modules/booking";
import { assertCan, type AuthContext } from "@/modules/identity";
import { getIntegration } from "@/modules/tenancy";
import { audit } from "@/shared/audit";
import { db, isUniqueViolation } from "@/shared/db";
import { appUrl, fakePaymentsEnabled } from "@/shared/env";
import { AppError, conflict, notFound, validation } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { FakeGateway } from "./fake";
import type { PaymentGateway, ProviderPaymentState, WebhookRequest } from "./gateway";
import { MercadoPagoGateway } from "./mercadopago";

// ───────────── Resolución del gateway por barbería ─────────────

let gatewayOverride: ((tenantId: string, provider: PaymentProvider) => PaymentGateway) | null = null;
/** Solo tests: sustituye gateways (p. ej. Mercado Pago con respuestas simuladas). */
export function setGatewayOverride(fn: typeof gatewayOverride) {
  gatewayOverride = fn;
}

export async function getGateway(tenantId: string, provider: PaymentProvider): Promise<PaymentGateway> {
  if (gatewayOverride) return gatewayOverride(tenantId, provider);
  if (provider === "FAKE") return new FakeGateway();
  const mp = await getIntegration(tenantId, "MERCADOPAGO");
  if (!mp?.enabled || !mp.secrets.accessToken) {
    throw new AppError("CONFIG", "Mercado Pago no está configurado para esta barbería");
  }
  return new MercadoPagoGateway(mp.secrets.accessToken, mp.secrets.webhookSecret);
}

/** Proveedor de pagos online disponible para la barbería, o null si no hay ninguno. */
export async function availableProvider(tenantId: string): Promise<PaymentProvider | null> {
  if (gatewayOverride) return "MERCADOPAGO";
  const mp = await getIntegration(tenantId, "MERCADOPAGO");
  if (mp?.enabled && mp.secrets.accessToken) return "MERCADOPAGO";
  if (fakePaymentsEnabled()) return "FAKE";
  return null;
}

// ───────────── Checkout ─────────────

/** Crea (o reutiliza) el checkout de una reserva pendiente de pago. El importe sale de la reserva, no del navegador. */
export async function startCheckout(
  tenantId: string,
  appointmentId: string,
): Promise<{ checkoutUrl: string; paymentId: string }> {
  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, tenantId },
    include: { tenant: true, customer: true },
  });
  if (!appt) throw notFound("Reserva");
  if (appt.status !== "PENDING_PAYMENT" || appt.amountDue <= 0)
    throw conflict("Esta reserva no requiere pago");
  if (appt.holdExpiresAt && appt.holdExpiresAt <= new Date())
    throw conflict("El tiempo para pagar expiró. Reserva de nuevo.");

  const existing = await db.payment.findFirst({
    where: { tenantId, appointmentId, status: "PENDING", checkoutUrl: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (existing?.checkoutUrl) return { checkoutUrl: existing.checkoutUrl, paymentId: existing.id };

  const provider = await availableProvider(tenantId);
  if (!provider) throw new AppError("CONFIG", "Los pagos online no están disponibles en este momento");
  const gateway = await getGateway(tenantId, provider);
  const payment = await db.payment.create({
    data: {
      tenantId,
      appointmentId,
      provider,
      kind: appt.paymentRequirement,
      amount: appt.amountDue,
      currency: appt.currency,
    },
  });
  const back = (r: string) => appUrl(`/b/${appt.tenant.slug}/confirmacion/${appt.id}?pago=${r}`);
  try {
    const checkout = await gateway.createCheckout({
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      title: `${appt.paymentRequirement === "DEPOSIT" ? "Seña" : "Pago"} · ${appt.serviceName} · ${appt.tenant.name}`,
      payerEmail: appt.customer.email,
      expiresAt: appt.holdExpiresAt ?? new Date(Date.now() + 15 * 60000),
      successUrl: back("ok"),
      failureUrl: back("error"),
      pendingUrl: back("pendiente"),
      notificationUrl: appUrl(`/api/webhooks/${provider === "FAKE" ? "fake" : "mercadopago"}/${tenantId}`),
    });
    await db.payment.update({
      where: { id: payment.id },
      data: { checkoutId: checkout.checkoutId, checkoutUrl: checkout.checkoutUrl },
    });
    return { checkoutUrl: checkout.checkoutUrl, paymentId: payment.id };
  } catch (err) {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "CANCELLED",
        providerDetail: `checkout_error: ${(err as Error).message}`.slice(0, 300),
      },
    });
    logger.error("payments.checkout_failed", { tenantId, paymentId: payment.id, error: err });
    throw new AppError("PROVIDER", "No pudimos iniciar el pago. Inténtalo de nuevo en unos segundos.");
  }
}

// ───────────── Webhooks ─────────────

export type WebhookOutcome =
  | { status: "processed"; result: string }
  | { status: "duplicate" }
  | { status: "invalid_signature" }
  | { status: "ignored"; reason: string };

/**
 * Procesa un webhook de pagos:
 * 1. Verifica la firma con el secreto de ESA barbería.
 * 2. Registra el evento (único por proveedor+clave → idempotencia ante reintentos).
 * 3. Consulta el estado real en el proveedor.
 * 4. Valida referencia, barbería, importe y moneda; descarta estados más antiguos.
 * 5. Aplica el estado y, si se aprobó, confirma la reserva.
 */
export async function handlePaymentWebhook(
  provider: PaymentProvider,
  tenantId: string,
  req: WebhookRequest,
): Promise<WebhookOutcome> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return { status: "ignored", reason: "tenant desconocido" };
  let gateway: PaymentGateway;
  try {
    gateway = await getGateway(tenantId, provider);
  } catch {
    return { status: "ignored", reason: "proveedor no configurado" };
  }
  const parsed = gateway.parseWebhook(req);
  const payload = sanitizePayload(req.rawBody);

  if (!parsed.signatureValid) {
    await db.paymentWebhookEvent
      .create({
        data: {
          provider,
          eventKey: `invalid:${parsed.eventKey}:${Date.now()}`,
          tenantId,
          signatureValid: false,
          payload,
          error: "firma inválida",
        },
      })
      .catch(() => undefined);
    logger.warn("payments.webhook_invalid_signature", { provider, tenantId });
    return { status: "invalid_signature" };
  }

  let eventId: string;
  try {
    eventId = (
      await db.paymentWebhookEvent.create({
        data: { provider, eventKey: parsed.eventKey, tenantId, signatureValid: true, payload },
      })
    ).id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const prev = await db.paymentWebhookEvent.findUnique({
      where: { provider_eventKey: { provider, eventKey: parsed.eventKey } },
    });
    if (prev?.processedAt) return { status: "duplicate" };
    eventId = prev!.id; // falló a mitad la vez anterior: reprocesar es seguro (idempotente)
  }

  if (parsed.topic !== "payment" || !parsed.resourceId) {
    await db.paymentWebhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
    return { status: "ignored", reason: `tópico ${parsed.topic}` };
  }

  try {
    const state = await gateway.fetchPayment(parsed.resourceId);
    const result = await applyProviderState(tenantId, provider, state);
    await db.paymentWebhookEvent.update({
      where: { id: eventId },
      data: { processedAt: new Date(), error: null },
    });
    return { status: "processed", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.paymentWebhookEvent.update({ where: { id: eventId }, data: { error: message.slice(0, 500) } });
    // Validaciones (importe/moneda/referencia) no se reintentan: quedan registradas para revisión.
    if (err instanceof AppError && err.code === "VALIDATION") return { status: "ignored", reason: message };
    throw err; // error transitorio: el proveedor reintentará el webhook
  }
}

function sanitizePayload(raw: string): Prisma.InputJsonValue {
  try {
    const parsed = JSON.parse(raw) as Prisma.InputJsonValue;
    return JSON.stringify(parsed).length > 20_000 ? { truncated: true } : parsed;
  } catch {
    return { unparseable: true };
  }
}

/** Aplica un estado verificado del proveedor a nuestro Payment. */
export async function applyProviderState(
  tenantId: string,
  provider: PaymentProvider,
  state: ProviderPaymentState,
): Promise<string> {
  if (!state.externalReference) throw validation("Pago sin referencia externa");
  const payment = await db.payment.findFirst({ where: { id: state.externalReference, tenantId, provider } });
  if (!payment) throw validation("La referencia del pago no corresponde a esta barbería");

  if (state.currency !== payment.currency) {
    await flag(payment.id, tenantId, "payment.currency_mismatch", {
      expected: payment.currency,
      got: state.currency,
    });
    throw validation("Moneda del pago no coincide");
  }
  if (
    state.amount !== payment.amount &&
    ["APPROVED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(state.status)
  ) {
    await flag(payment.id, tenantId, "payment.amount_mismatch", {
      expected: payment.amount,
      got: state.amount,
    });
    throw validation("Importe del pago no coincide");
  }
  if (payment.externalPaymentId && payment.externalPaymentId !== state.externalPaymentId) {
    // Segundo pago para la misma reserva: no se mezcla con el primero, se marca para revisión/reembolso.
    await flag(payment.id, tenantId, "payment.duplicate_charge", {
      other: state.externalPaymentId,
      status: state.status,
    });
    return "duplicate_charge";
  }
  // Eventos fuera de orden: nunca retroceder a un estado más antiguo.
  if (payment.providerUpdatedAt && state.updatedAt && state.updatedAt < payment.providerUpdatedAt)
    return "stale";

  const wasApproved = payment.status === "APPROVED" || payment.approvedAt !== null;
  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: state.status,
      externalPaymentId: state.externalPaymentId,
      providerStatus: state.rawStatus,
      providerDetail: state.detail ?? null,
      providerUpdatedAt: state.updatedAt ?? new Date(),
      refundedAmount: Math.min(state.refundedAmount, payment.amount),
      ...(state.status === "APPROVED" && !payment.approvedAt ? { approvedAt: new Date() } : {}),
    },
  });
  await db.appointmentEvent.create({
    data: {
      tenantId,
      appointmentId: payment.appointmentId,
      type: `payment_${state.status.toLowerCase()}`,
      actorType: "PROVIDER",
      data: { paymentId: payment.id, amount: state.amount, provider },
    },
  });

  if (state.status === "APPROVED" && !wasApproved) {
    const outcome = await applyApprovedPayment(tenantId, payment.appointmentId);
    if (outcome === "cancelled" || outcome === "slot_taken") {
      await flag(payment.id, tenantId, "payment.requires_refund", { reason: outcome });
    }
    return `approved:${outcome}`;
  }
  return state.status.toLowerCase();
}

async function flag(paymentId: string, tenantId: string, action: string, metadata: Record<string, unknown>) {
  logger.warn(action, { tenantId, paymentId, ...metadata });
  await audit({
    tenantId,
    actor: { type: "PROVIDER" },
    action,
    entityType: "Payment",
    entityId: paymentId,
    metadata: metadata as Prisma.InputJsonValue,
  });
}

// ───────────── Reembolsos y conciliación ─────────────

export async function refundPayment(ctx: AuthContext, paymentId: string, amount?: number, reason?: string) {
  assertCan(ctx, "payments.refund");
  const payment = await db.payment.findFirst({ where: { id: paymentId, tenantId: ctx.tenantId } });
  if (!payment) throw notFound("Pago");
  if (!["APPROVED", "PARTIALLY_REFUNDED"].includes(payment.status) || !payment.externalPaymentId) {
    throw conflict("Solo se pueden reembolsar pagos aprobados");
  }
  const remaining = payment.amount - payment.refundedAmount;
  const value = amount ?? remaining;
  if (!Number.isInteger(value) || value <= 0 || value > remaining)
    throw validation(`Importe inválido (máximo ${remaining})`);
  const refund = await db.refund.create({
    data: {
      tenantId: ctx.tenantId,
      paymentId: payment.id,
      amount: value,
      status: "requested",
      reason,
      createdById: ctx.userId,
    },
  });
  const gateway = await getGateway(ctx.tenantId, payment.provider);
  try {
    const r = await gateway.refund(payment.externalPaymentId, value, payment.currency, `refund-${refund.id}`);
    const refunded = payment.refundedAmount + value;
    await db.$transaction([
      db.refund.update({
        where: { id: refund.id },
        data: { externalRefundId: r.externalRefundId, status: r.approved ? "approved" : "pending" },
      }),
      db.payment.update({
        where: { id: payment.id },
        data: r.approved
          ? {
              refundedAmount: refunded,
              status: refunded >= payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED",
            }
          : {},
      }),
    ]);
  } catch (err) {
    await db.refund.update({ where: { id: refund.id }, data: { status: "failed" } });
    logger.error("payments.refund_failed", { paymentId, error: err });
    throw new AppError("PROVIDER", "El proveedor rechazó el reembolso. Revisa el panel del proveedor.");
  }
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "payment.refunded",
    entityType: "Payment",
    entityId: payment.id,
    metadata: { amount: value },
  });
}

/** Consulta el estado real en el proveedor y lo aplica (para pagos cuyo webhook no llegó). */
export async function reconcilePayment(tenantId: string, paymentId: string): Promise<string> {
  const payment = await db.payment.findFirst({ where: { id: paymentId, tenantId } });
  if (!payment) throw notFound("Pago");
  const gateway = await getGateway(tenantId, payment.provider);
  const state = payment.externalPaymentId
    ? await gateway.fetchPayment(payment.externalPaymentId)
    : await gateway.findByReference(payment.id);
  if (!state) return "not_found";
  return applyProviderState(tenantId, payment.provider, state);
}

/** Cron: concilia pagos pendientes de las últimas 48 h. */
export async function reconcilePendingPayments(): Promise<number> {
  const pending = await db.payment.findMany({
    where: {
      status: { in: ["PENDING", "IN_PROCESS"] },
      provider: { not: "FAKE" },
      createdAt: { gte: new Date(Date.now() - 48 * 3600 * 1000), lte: new Date(Date.now() - 5 * 60000) },
    },
    take: 50,
  });
  let n = 0;
  for (const p of pending) {
    try {
      await reconcilePayment(p.tenantId, p.id);
      n++;
    } catch (err) {
      logger.warn("payments.reconcile_failed", { paymentId: p.id, error: err });
    }
  }
  return n;
}

export async function listPayments(ctx: AuthContext, opts: { take?: number } = {}) {
  assertCan(ctx, "payments.view");
  const payments = await db.payment.findMany({
    where: { tenantId: ctx.tenantId },
    include: {
      appointment: {
        select: {
          id: true,
          startsAt: true,
          status: true,
          serviceName: true,
          customer: { select: { name: true } },
        },
      },
      refunds: true,
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 100,
  });
  return payments.map((p) => ({
    ...p,
    requiresRefund:
      p.status === "APPROVED" && ["CANCELLED", "EXPIRED", "NO_SHOW"].includes(p.appointment.status),
  }));
}

/** Solo para el simulador de desarrollo. */
export async function getPaymentForSimulator(paymentId: string) {
  if (!fakePaymentsEnabled()) return null;
  return db.payment.findFirst({
    where: { id: paymentId, provider: "FAKE" },
    include: {
      appointment: {
        select: { id: true, serviceName: true, tenant: { select: { slug: true, name: true } } },
      },
    },
  });
}

export async function reconcilePaymentAsStaff(ctx: AuthContext, paymentId: string) {
  assertCan(ctx, "payments.view");
  return reconcilePayment(ctx.tenantId, paymentId);
}
