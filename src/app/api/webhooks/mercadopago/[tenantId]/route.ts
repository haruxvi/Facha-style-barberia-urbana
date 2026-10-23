import { after, NextResponse } from "next/server";
import { handlePaymentWebhook } from "@/modules/payments";
import { readBody } from "@/server/http";
import { drainSoon } from "@/server/worker";
import { logger } from "@/shared/logger";

/**
 * Webhook de Mercado Pago de una barbería. El tenant de la URL solo elige con qué secreto verificar:
 * si la firma no es válida para ESA barbería, el evento se descarta.
 */
export async function POST(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) return new NextResponse("Not found", { status: 404 });
  let raw: string;
  try {
    raw = await readBody(req, 64 * 1024);
  } catch {
    return new NextResponse("Payload too large", { status: 413 });
  }
  try {
    const outcome = await handlePaymentWebhook("MERCADOPAGO", tenantId, {
      headers: req.headers,
      url: new URL(req.url),
      rawBody: raw,
    });
    if (outcome.status === "invalid_signature") return new NextResponse("Invalid signature", { status: 401 });
    after(drainSoon);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("payments.webhook_error", { tenantId, error: err });
    return new NextResponse("Retry", { status: 500 }); // Mercado Pago reintentará
  }
}
