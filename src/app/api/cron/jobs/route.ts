import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/server/http";
import { runWorkerTick } from "@/server/worker";
import { env } from "@/shared/env";

export const maxDuration = 60;

/** Procesa la cola de trabajos (recordatorios, confirmaciones, mensajes de WhatsApp) y vence holds. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env().CRON_SECRET)) return new NextResponse("Unauthorized", { status: 401 });
  const result = await runWorkerTick({ deadlineMs: 45_000 });
  return NextResponse.json(result);
}
