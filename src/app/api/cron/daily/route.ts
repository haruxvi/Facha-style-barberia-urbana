import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/server/http";
import { runDailyMaintenance, runWorkerTick } from "@/server/worker";
import { env } from "@/shared/env";

export const maxDuration = 60;

/** Mantenimiento diario: clientes inactivos, conciliación de pagos, limpieza. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env().CRON_SECRET)) return new NextResponse("Unauthorized", { status: 401 });
  const daily = await runDailyMaintenance();
  // En el plan Hobby de Vercel solo hay cron diario: también procesa la cola.
  const tick = await runWorkerTick({ deadlineMs: 30_000 });
  return NextResponse.json({ daily, tick });
}
