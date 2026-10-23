import { hmacSha256, safeEqual } from "@/shared/crypto";
import { env } from "@/shared/env";

/** Verificación inicial del webhook (GET con hub.mode, hub.verify_token y hub.challenge). */
export function verifySubscription(params: URLSearchParams): string | null {
  const expected = env().WHATSAPP_VERIFY_TOKEN;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge");
  if (!expected || mode !== "subscribe" || !challenge) return null;
  return safeEqual(token, expected) ? challenge : null;
}

/** Autenticidad de eventos: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(App Secret, cuerpo crudo). */
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = env().WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  return safeEqual(header.slice(7), hmacSha256(secret, rawBody, "hex"));
}

export interface InboundMessage {
  phoneNumberId: string;
  from: string; // wa_id del cliente (sin +)
  id: string;
  timestamp: number;
  type: string;
  text: string;
  profileName: string | null;
}

export interface StatusUpdate {
  phoneNumberId: string;
  id: string;
  status: "sent" | "delivered" | "read" | "failed" | string;
  error: string | null;
}

interface WebhookPayload {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: {
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: {
            button_reply?: { title?: string; id?: string };
            list_reply?: { title?: string; id?: string };
          };
        }[];
        statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[];
      };
    }[];
  }[];
}

export function parseWebhookPayload(raw: string): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw) as WebhookPayload;
  } catch {
    return { messages: [], statuses: [] };
  }
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  if (payload.object !== "whatsapp_business_account") return { messages, statuses };
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      const phoneNumberId = v?.metadata?.phone_number_id;
      if (!v || !phoneNumberId) continue;
      for (const m of v.messages ?? []) {
        if (!m.id || !m.from) continue;
        const text =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.id ??
          m.interactive?.list_reply?.id ??
          "";
        messages.push({
          phoneNumberId,
          from: m.from,
          id: m.id,
          timestamp: Number(m.timestamp ?? 0),
          type: m.type ?? "unknown",
          text: text.slice(0, 1000),
          profileName: v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null,
        });
      }
      for (const s of v.statuses ?? []) {
        if (!s.id || !s.status) continue;
        statuses.push({
          phoneNumberId,
          id: s.id,
          status: s.status,
          error: s.errors?.[0] ? `${s.errors[0].title ?? ""} ${s.errors[0].message ?? ""}`.trim() : null,
        });
      }
    }
  }
  return { messages, statuses };
}
