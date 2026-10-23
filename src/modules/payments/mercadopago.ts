import { MercadoPagoConfig, Payment, PaymentRefund, Preference } from "mercadopago";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { hmacSha256, safeEqual } from "@/shared/crypto";
import { toMajorUnits, toMinorUnits } from "@/shared/money";
import type {
  CheckoutInput,
  ParsedWebhook,
  PaymentGateway,
  ProviderPaymentState,
  WebhookRequest,
} from "./gateway";

/**
 * Adaptador de Mercado Pago (Checkout Pro). Cada barbería usa SU access token (cobra en su cuenta).
 * Webhooks: validación de x-signature según la documentación oficial:
 *   manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 *   v1 = HMAC-SHA256(secret, manifest) en hex
 * Después SIEMPRE se consulta el pago en la API: el cuerpo del webhook no se usa como verdad.
 */
export class MercadoPagoGateway implements PaymentGateway {
  readonly provider = "MERCADOPAGO" as const;
  private readonly client: MercadoPagoConfig;
  /** Credenciales de prueba "TEST-…": el checkout debe abrirse en el entorno sandbox. */
  private readonly sandbox: boolean;

  constructor(
    accessToken: string,
    private readonly webhookSecret: string | undefined,
  ) {
    this.client = new MercadoPagoConfig({ accessToken, options: { timeout: 10_000 } });
    this.sandbox = accessToken.startsWith("TEST-");
  }

  async createCheckout(input: CheckoutInput) {
    const pref = await new Preference(this.client).create({
      body: {
        items: [
          {
            id: input.paymentId,
            title: input.title.slice(0, 250),
            quantity: 1,
            unit_price: toMajorUnits(input.amount, input.currency),
            currency_id: input.currency,
          },
        ],
        external_reference: input.paymentId,
        notification_url: input.notificationUrl,
        back_urls: { success: input.successUrl, failure: input.failureUrl, pending: input.pendingUrl },
        auto_return: "approved",
        expires: true,
        expiration_date_to: input.expiresAt.toISOString(),
        ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
      },
      requestOptions: { idempotencyKey: `pref-${input.paymentId}` },
    });
    const url = this.sandbox ? (pref.sandbox_init_point ?? pref.init_point) : pref.init_point;
    if (!pref.id || !url) throw new Error("Mercado Pago no devolvió el checkout");
    return { checkoutId: pref.id, checkoutUrl: url };
  }

  parseWebhook(req: WebhookRequest): ParsedWebhook {
    const signatureHeader = req.headers.get("x-signature") ?? "";
    const requestId = req.headers.get("x-request-id") ?? "";
    let body: { type?: string; topic?: string; data?: { id?: string | number } } = {};
    try {
      body = JSON.parse(req.rawBody || "{}");
    } catch {
      body = {};
    }
    const rawId =
      req.url.searchParams.get("data.id") ?? (body.data?.id !== undefined ? String(body.data.id) : null);
    // La documentación indica usar data.id en minúsculas si es alfanumérico.
    const dataId = rawId ? (/^[a-z0-9]+$/i.test(rawId) ? rawId.toLowerCase() : rawId) : null;
    const topic = req.url.searchParams.get("type") ?? body.type ?? body.topic ?? "unknown";

    let ts = "";
    let v1 = "";
    for (const part of signatureHeader.split(",")) {
      const [k, v] = part.split("=").map((s) => s.trim());
      if (k === "ts") ts = v ?? "";
      if (k === "v1") v1 = v ?? "";
    }
    let signatureValid = false;
    if (this.webhookSecret && ts && v1) {
      let manifest = "";
      if (dataId) manifest += `id:${dataId};`;
      if (requestId) manifest += `request-id:${requestId};`;
      manifest += `ts:${ts};`;
      signatureValid = safeEqual(hmacSha256(this.webhookSecret, manifest, "hex"), v1);
    }
    return {
      eventKey: `${topic}:${dataId ?? "-"}:${requestId || ts}`,
      signatureValid,
      topic,
      resourceId: dataId,
    };
  }

  async fetchPayment(resourceId: string): Promise<ProviderPaymentState> {
    const p = await new Payment(this.client).get({ id: resourceId });
    return toState(p);
  }

  async findByReference(externalReference: string): Promise<ProviderPaymentState | null> {
    const res = await new Payment(this.client).search({
      options: { external_reference: externalReference, sort: "date_last_updated", criteria: "desc" },
    });
    const first = res.results?.[0];
    return first ? toState(first) : null;
  }

  async refund(externalPaymentId: string, amount: number, currency: string, idempotencyKey: string) {
    const r = await new PaymentRefund(this.client).create({
      payment_id: externalPaymentId,
      body: { amount: toMajorUnits(amount, currency) },
      requestOptions: { idempotencyKey },
    });
    return { externalRefundId: String(r.id ?? ""), approved: r.status === "approved" };
  }
}

interface MpPayment {
  id?: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  transaction_amount_refunded?: number;
  currency_id?: string;
  external_reference?: string;
  date_last_updated?: string;
}

export function mapMercadoPagoStatus(
  status: string | undefined,
  refunded: number,
  amount: number,
): PaymentStatus {
  switch (status) {
    case "approved":
      return refunded > 0 ? (refunded >= amount ? "REFUNDED" : "PARTIALLY_REFUNDED") : "APPROVED";
    case "authorized":
    case "in_process":
    case "in_mediation":
      return "IN_PROCESS";
    case "pending":
      return "PENDING";
    case "rejected":
      return "REJECTED";
    case "cancelled":
      return "CANCELLED";
    case "refunded":
    case "charged_back":
      return "REFUNDED";
    default:
      return "PENDING";
  }
}

function toState(p: MpPayment): ProviderPaymentState {
  const currency = (p.currency_id ?? "").toUpperCase();
  const amount = toMinorUnits(p.transaction_amount ?? 0, currency || "CLP");
  const refundedAmount = toMinorUnits(p.transaction_amount_refunded ?? 0, currency || "CLP");
  return {
    externalPaymentId: String(p.id ?? ""),
    externalReference: p.external_reference ?? null,
    status: mapMercadoPagoStatus(p.status, refundedAmount, amount),
    rawStatus: p.status ?? "unknown",
    detail: p.status_detail ?? null,
    amount,
    currency,
    refundedAmount,
    updatedAt: p.date_last_updated ? new Date(p.date_last_updated) : null,
  };
}
