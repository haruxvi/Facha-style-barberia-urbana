import { randomUUID } from "node:crypto";
import { getIntegration } from "@/modules/tenancy";
import { env, isProduction } from "@/shared/env";
import { AppError } from "@/shared/errors";
import { logger, maskEmail, maskPhone } from "@/shared/logger";
import { e164ToWaId } from "@/shared/phone";

/** Error de proveedor externo. `retryable` = vale la pena reintentar (5xx, 429, red). */
export class ProviderError extends Error {
  override name = "ProviderError";
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

// ───────────── Correo ─────────────

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
}

export interface EmailProvider {
  readonly name: string;
  /** true = no es un envío real (desarrollo). */
  readonly simulated: boolean;
  send(msg: EmailMessage): Promise<{ providerMessageId: string }>;
}

/** Solo registra en logs. Para desarrollo: NO envía correos reales. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  readonly simulated = true;
  async send(msg: EmailMessage) {
    logger.info("email.simulated", { to: maskEmail(msg.to), subject: msg.subject });
    return { providerMessageId: `console-${randomUUID()}` };
  }
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  readonly simulated = false;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(msg: EmailMessage) {
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: this.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new ProviderError(`Resend no responde: ${(err as Error).message}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) {
      throw new ProviderError(
        `Resend ${res.status}: ${body.message ?? "error"}`,
        res.status >= 500 || res.status === 429,
      );
    }
    return { providerMessageId: body.id };
  }
}

// ───────────── WhatsApp ─────────────

export interface WhatsAppSender {
  readonly name: string;
  readonly simulated: boolean;
  sendText(toE164: string, body: string): Promise<{ providerMessageId: string }>;
  sendTemplate(
    toE164: string,
    template: string,
    language: string,
    params: string[],
  ): Promise<{ providerMessageId: string }>;
}

/** WhatsApp Business Platform Cloud API (oficial de Meta). */
export class CloudApiWhatsAppSender implements WhatsAppSender {
  readonly name = "whatsapp_cloud";
  readonly simulated = false;
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly version = env().WHATSAPP_API_VERSION,
  ) {}

  private async post(payload: Record<string, unknown>) {
    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/${this.version}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new ProviderError(`WhatsApp no responde: ${(err as Error).message}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    const id = body.messages?.[0]?.id;
    if (!res.ok || !id) {
      throw new ProviderError(
        `WhatsApp ${res.status}: ${body.error?.message ?? "error"} (code ${body.error?.code ?? "?"})`,
        res.status >= 500 || res.status === 429,
      );
    }
    return { providerMessageId: id };
  }

  sendText(toE164: string, body: string) {
    return this.post({
      to: e164ToWaId(toE164),
      type: "text",
      text: { preview_url: true, body: body.slice(0, 4096) },
    });
  }

  sendTemplate(toE164: string, template: string, language: string, params: string[]) {
    return this.post({
      to: e164ToWaId(toE164),
      type: "template",
      template: {
        name: template,
        language: { code: language },
        components: params.length
          ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
          : [],
      },
    });
  }
}

/** Simulador para desarrollo: NO envía mensajes reales. Nunca se usa en producción. */
export class ConsoleWhatsAppSender implements WhatsAppSender {
  readonly name = "whatsapp_simulado";
  readonly simulated = true;
  async sendText(toE164: string, body: string) {
    logger.info("whatsapp.simulated", { to: maskPhone(toE164), chars: body.length });
    return { providerMessageId: `sim-${randomUUID()}` };
  }
  async sendTemplate(toE164: string, template: string) {
    logger.info("whatsapp.simulated_template", { to: maskPhone(toE164), template });
    return { providerMessageId: `sim-${randomUUID()}` };
  }
}

// ───────────── Resolución (con posibilidad de sustituir en tests) ─────────────

let overrides: {
  email?: EmailProvider;
  whatsapp?: (tenantId: string) => WhatsAppSender | Promise<WhatsAppSender>;
} = {};

/** Solo para tests: inyecta proveedores falsos. */
export function setProviderOverrides(o: typeof overrides) {
  overrides = o;
}

export function getEmailProvider(): EmailProvider {
  if (overrides.email) return overrides.email;
  const e = env();
  if (e.EMAIL_PROVIDER === "resend") {
    if (!e.EMAIL_API_KEY) throw new AppError("CONFIG", "Falta EMAIL_API_KEY para Resend");
    return new ResendEmailProvider(e.EMAIL_API_KEY, e.EMAIL_FROM);
  }
  if (isProduction()) logger.warn("email.console_in_production");
  return new ConsoleEmailProvider();
}

export async function getWhatsAppSender(tenantId: string): Promise<WhatsAppSender> {
  if (overrides.whatsapp) return overrides.whatsapp(tenantId);
  const integration = await getIntegration(tenantId, "WHATSAPP");
  const token = integration?.secrets.accessToken;
  if (integration?.enabled && integration.externalAccountId && token) {
    return new CloudApiWhatsAppSender(integration.externalAccountId, token);
  }
  if (!isProduction()) return new ConsoleWhatsAppSender();
  throw new AppError("CONFIG", "WhatsApp no está configurado para esta barbería");
}
