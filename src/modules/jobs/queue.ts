import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/shared/db";
import { logger } from "@/shared/logger";

/**
 * Cola de trabajos sobre Postgres (patrón outbox): los trabajos se insertan en la MISMA transacción
 * que el cambio de negocio, así nunca se pierde un evento ni se envía uno de una transacción revertida.
 * Vercel Cron (o pg_cron de Supabase) llama a /api/cron/jobs para procesarlos.
 */

export interface EnqueueInput {
  type: string;
  payload: Prisma.InputJsonValue;
  tenantId?: string | null;
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
}

/** Inserta un trabajo. Si ya existe uno con el mismo dedupeKey, no hace nada (idempotente). */
export async function enqueueJob(client: Tx, input: EnqueueInput): Promise<void> {
  await client.job.createMany({
    data: [
      {
        type: input.type,
        payload: input.payload,
        tenantId: input.tenantId ?? null,
        runAt: input.runAt ?? new Date(),
        dedupeKey: input.dedupeKey ?? null,
        maxAttempts: input.maxAttempts ?? 5,
      },
    ],
    skipDuplicates: true,
  });
}

/** Error que no debe reintentarse (datos inválidos, configuración ausente…). */
export class NonRetryableError extends Error {
  override name = "NonRetryableError";
}

export type JobHandler = (payload: Record<string, unknown>, job: ClaimedJob) => Promise<void>;

export interface ClaimedJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  tenantId: string | null;
}

const STALE_LOCK_MINUTES = 5;

/** Reclama trabajos vencidos de forma segura entre procesos concurrentes (SKIP LOCKED). */
export async function claimDueJobs(limit: number): Promise<ClaimedJob[]> {
  return db.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = now(), "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE ("status" = 'PENDING' AND "runAt" <= now())
         OR ("status" = 'RUNNING' AND "lockedAt" < now() - make_interval(mins => ${STALE_LOCK_MINUTES}))
      ORDER BY "runAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "type", "payload", "attempts", "maxAttempts", "tenantId"`;
}

function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** (attempts - 1), 3600);
}

export async function runDueJobs(
  handlers: Record<string, JobHandler>,
  opts: { limit?: number; deadlineMs?: number } = {},
): Promise<{ processed: number; failed: number }> {
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000);
  let processed = 0;
  let failed = 0;
  while (Date.now() < deadline) {
    const jobs = await claimDueJobs(opts.limit ?? 20);
    if (jobs.length === 0) break;
    for (const job of jobs) {
      const handler = handlers[job.type];
      try {
        if (!handler) throw new NonRetryableError(`Sin handler para el tipo de trabajo "${job.type}"`);
        await handler(job.payload, job);
        await db.job.update({
          where: { id: job.id },
          data: { status: "DONE", completedAt: new Date(), lockedAt: null, lastError: null },
        });
        processed++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        const dead = err instanceof NonRetryableError || job.attempts >= job.maxAttempts;
        logger.warn("job.failed", {
          jobId: job.id,
          type: job.type,
          attempts: job.attempts,
          dead,
          error: message,
        });
        await db.job.update({
          where: { id: job.id },
          data: {
            status: dead ? "DEAD" : "PENDING",
            lockedAt: null,
            lastError: message.slice(0, 1000),
            runAt: dead ? undefined : new Date(Date.now() + backoffSeconds(job.attempts) * 1000),
          },
        });
      }
    }
  }
  return { processed, failed };
}
