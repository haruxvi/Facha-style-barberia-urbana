import { randomUUID } from "node:crypto";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { deriveKey, hmacSha256, safeEqual } from "@/shared/crypto";
import { appUrl, env, fakePaymentsEnabled } from "@/shared/env";
import type {
  CheckoutInput,
  ParsedWebhook,
  PaymentGateway,
  ProviderPaymentState,
  WebhookRequest,
} from "./gateway";

/**
 * ⚠️ PROVEEDOR SIMULADO — SOLO DESARROLLO Y TESTS.
 * Está deshabilitado cuando NODE_ENV=production (ver fakePaymentsEnabled) y nunca mueve dinero.
 * Imita el contrato de un proveedor real: webhook firmado + consulta del "estado en el proveedor".
 * El estado viaja firmado dentro del propio evento, de modo que la ruta de procesamiento
 * (verificar firma → consultar → validar importe/moneda/referencia → aplicar) es la misma que en producción.
 */
export interface FakeProviderEvent {
  paymentId: string; // nuestra referencia
  externalPaymentId: string;
  status: "approved" | "rejected" | "pending" | "refunded" | "cancelled";
  amount: number;
  currency: string;
  updatedAt: string;
  eventId: string;
}

function key() {
  return deriveKey(env().SESSION_SECRET, "fake-payments");
}

export function signFakeEvent(event: FakeProviderEvent): { body: string; signature: string } {
  const body = JSON.stringify(event);
  return { body, signature: hmacSha256(key(), body, "hex") };
}

export function buildFakeEvent(
  partial: Partial<FakeProviderEvent> &
    Pick<FakeProviderEvent, "paymentId" | "status" | "amount" | "currency">,
): FakeProviderEvent {
  return {
    externalPaymentId: `fake-${partial.paymentId}`,
    updatedAt: new Date().toISOString(),
    eventId: randomUUID(),
    ...partial,
  };
}

const STATUS: Record<FakeProviderEvent["status"], PaymentStatus> = {
  approved: "APPROVED",
  rejected: "REJECTED",
  pending: "PENDING",
  refunded: "REFUNDED",
  cancelled: "CANCELLED",
};

export class FakeGateway implements PaymentGateway {
  readonly provider = "FAKE" as const;

  constructor() {
    if (!fakePaymentsEnabled()) throw new Error("El proveedor de pagos simulado está deshabilitado");
  }

  async createCheckout(input: CheckoutInput) {
    return {
      checkoutId: `fake-pref-${input.paymentId}`,
      checkoutUrl: appUrl(`/pagos/simulador/${input.paymentId}`),
    };
  }

  parseWebhook(req: WebhookRequest): ParsedWebhook {
    const signature = req.headers.get("x-fake-signature") ?? "";
    const valid = !!signature && safeEqual(hmacSha256(key(), req.rawBody, "hex"), signature);
    let eventId = "invalid";
    try {
      eventId = (JSON.parse(req.rawBody) as FakeProviderEvent).eventId ?? "invalid";
    } catch {
      /* cuerpo inválido */
    }
    return {
      eventKey: `fake:${eventId}`,
      signatureValid: valid,
      topic: "payment",
      resourceId: valid ? Buffer.from(req.rawBody).toString("base64url") : null,
    };
  }

  async fetchPayment(resourceId: string): Promise<ProviderPaymentState> {
    const e = JSON.parse(Buffer.from(resourceId, "base64url").toString("utf8")) as FakeProviderEvent;
    const status = STATUS[e.status];
    return {
      externalPaymentId: e.externalPaymentId,
      externalReference: e.paymentId,
      status,
      rawStatus: e.status,
      amount: e.amount,
      currency: e.currency,
      refundedAmount: status === "REFUNDED" ? e.amount : 0,
      updatedAt: new Date(e.updatedAt),
    };
  }

  async findByReference(): Promise<ProviderPaymentState | null> {
    return null;
  }

  async refund() {
    return { externalRefundId: `fake-refund-${randomUUID()}`, approved: true };
  }
}
