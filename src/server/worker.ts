import { onBookingEvent, runInactiveFollowups } from "@/modules/automation";
import { expireStaleHolds } from "@/modules/booking";
import { purgeExpiredSessions } from "@/modules/identity";
import { runDueJobs, type JobHandler } from "@/modules/jobs";
import { sendNotification, type Purpose } from "@/modules/messaging";
import { reconcilePendingPayments } from "@/modules/payments";
import { processInboundMessage } from "@/modules/whatsapp";
import { db } from "@/shared/db";
import { purgeExpiredRateLimits } from "@/shared/rate-limit";
import { botPortsFactory } from "./bot-ports";

/** Registro de handlers de la cola (composición: aquí se conectan los módulos). */
export const jobHandlers: Record<string, JobHandler> = {
  "booking.event": (p) => onBookingEvent(p),
  "notification.send": async (p) => {
    await sendNotification(String(p.notificationId), {
      purpose: (p.purpose as Purpose) ?? "TRANSACTIONAL",
      expectedStartsAt: (p.expectedStartsAt as string | null) ?? null,
    });
  },
  "whatsapp.inbound": (p) => processInboundMessage(String(p.messageId), botPortsFactory),
};

/** Ejecutado por /api/cron/jobs (cada minuto). */
export async function runWorkerTick(opts: { deadlineMs?: number } = {}) {
  const expired = await db.$transaction((tx) => expireStaleHolds(tx, new Date()));
  const jobs = await runDueJobs(jobHandlers, { deadlineMs: opts.deadlineMs ?? 40_000 });
  return { expiredHolds: expired, ...jobs };
}

/** Ejecutado por /api/cron/daily. */
export async function runDailyMaintenance() {
  const [followups, reconciled, sessions, rateLimits] = await Promise.all([
    runInactiveFollowups(),
    reconcilePendingPayments(),
    purgeExpiredSessions(),
    purgeExpiredRateLimits(),
  ]);
  const oldJobs = await db.job.deleteMany({
    where: { status: "DONE", completedAt: { lt: new Date(Date.now() - 30 * 86400000) } },
  });
  return { followups, reconciled, sessions, rateLimits, oldJobs: oldJobs.count };
}

/** Procesa trabajos pendientes justo después de una respuesta HTTP (confirmaciones inmediatas). */
export async function drainSoon() {
  try {
    await runDueJobs(jobHandlers, { deadlineMs: 8_000, limit: 10 });
  } catch {
    /* el cron lo reintentará */
  }
}
