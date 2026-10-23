import { after, NextResponse } from "next/server";
import { ingestWhatsAppWebhook, processInboundMessage, verifySubscription } from "@/modules/whatsapp";
import { botPortsFactory } from "@/server/bot-ports";
import { readBody } from "@/server/http";
import { logger } from "@/shared/logger";

/** Verificación del webhook por Meta. */
export async function GET(req: Request) {
  const challenge = verifySubscription(new URL(req.url).searchParams);
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

/** Eventos de WhatsApp: firma X-Hub-Signature-256 obligatoria; respuesta rápida y proceso diferido. */
export async function POST(req: Request) {
  let raw: string;
  try {
    raw = await readBody(req, 256 * 1024);
  } catch {
    return new NextResponse("Payload too large", { status: 413 });
  }
  const result = await ingestWhatsAppWebhook(raw, req.headers.get("x-hub-signature-256"));
  if (!result.ok) return new NextResponse("Invalid signature", { status: 401 });
  if (result.inbound.length) {
    after(async () => {
      for (const id of result.inbound) {
        try {
          await processInboundMessage(id, botPortsFactory);
        } catch (err) {
          // Queda en la cola ("whatsapp.inbound") y el cron lo reintenta.
          logger.error("whatsapp.process_failed", { messageId: id, error: err });
        }
      }
    });
  }
  return NextResponse.json({ ok: true });
}
