import type { PaymentProvider, PaymentStatus } from "@/generated/prisma/enums";

/** Estado de un pago según el proveedor (la única fuente de verdad para aprobarlo). */
export interface ProviderPaymentState {
  externalPaymentId: string;
  /** Nuestra referencia: el id de Payment. */
  externalReference: string | null;
  status: PaymentStatus;
  rawStatus: string;
  detail?: string | null;
  /** En unidad menor de la moneda. */
  amount: number;
  currency: string;
  refundedAmount: number;
  updatedAt: Date | null;
}

export interface WebhookRequest {
  headers: Headers;
  url: URL;
  rawBody: string;
}

export interface ParsedWebhook {
  /** Clave para idempotencia del evento. */
  eventKey: string;
  signatureValid: boolean;
  topic: string;
  /** Id del recurso a consultar en el proveedor (p. ej. id de pago). */
  resourceId: string | null;
}

export interface CheckoutInput {
  paymentId: string;
  amount: number;
  currency: string;
  title: string;
  payerEmail?: string | null;
  expiresAt: Date;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  notificationUrl: string;
}

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  createCheckout(input: CheckoutInput): Promise<{ checkoutId: string; checkoutUrl: string }>;
  parseWebhook(req: WebhookRequest): ParsedWebhook;
  fetchPayment(resourceId: string): Promise<ProviderPaymentState>;
  /** Para conciliar pagos cuyo webhook nunca llegó. */
  findByReference(externalReference: string): Promise<ProviderPaymentState | null>;
  refund(
    externalPaymentId: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
  ): Promise<{ externalRefundId: string; approved: boolean }>;
}
