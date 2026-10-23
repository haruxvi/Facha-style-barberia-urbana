import { after, NextResponse } from "next/server";
import { handlePaymentWebhook } from "@/modules/payments";
import { readBody } from "@/server/http";
import { drainSoon } from "@/server/worker";
import { fakePaymentsEnabled } from "@/shared/env";

/** Webhook del proveedor SIMULADO. No existe en producción. */
export async function POST(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  if (!fakePaymentsEnabled()) return new NextResponse("Not found", { status: 404 });
  const { tenantId } = await params;
  const raw = await readBody(req, 16 * 1024);
  const outcome = await handlePaymentWebhook("FAKE", tenantId, {
    headers: req.headers,
    url: new URL(req.url),
    rawBody: raw,
  });
  if (outcome.status === "invalid_signature") return new NextResponse("Invalid signature", { status: 401 });
  after(drainSoon);
  return NextResponse.json(outcome);
}
