import { db, type Tx } from "./db";
import { AppError } from "./errors";

/**
 * Rate limiting de ventana fija sobre Postgres (Vercel no tiene memoria compartida entre instancias).
 * Una sola sentencia atómica: incrementa o reinicia la ventana.
 */
export async function hitRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  client: Tx = db,
): Promise<{ allowed: boolean; count: number; resetAt: Date }> {
  const rows = await client.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN "RateLimit"."resetAt" < now() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" < now() THEN now() + make_interval(secs => ${windowSeconds}) ELSE "RateLimit"."resetAt" END
    RETURNING "count", "resetAt"`;
  const row = rows[0]!;
  return { allowed: row.count <= limit, count: row.count, resetAt: row.resetAt };
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const r = await hitRateLimit(key, limit, windowSeconds);
  if (!r.allowed) {
    throw new AppError("RATE_LIMITED", "Demasiados intentos. Espera un momento y vuelve a intentarlo.");
  }
}

export async function purgeExpiredRateLimits(): Promise<number> {
  return db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date() } } }).then((r) => r.count);
}
