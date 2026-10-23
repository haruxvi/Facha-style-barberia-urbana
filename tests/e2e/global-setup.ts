import "dotenv/config";
import { Client } from "pg";

/**
 * Limpia los contadores de rate limit de login para que el e2e sea repetible
 * (el limitador funciona: tras muchas corridas seguidas bloquearía el usuario de desarrollo).
 * Solo actúa sobre una base local; nunca contra producción.
 */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV === "production" || !/127\.0\.0\.1|localhost/.test(url)) return;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`DELETE FROM "RateLimit" WHERE "key" LIKE 'login:%' OR "key" LIKE 'book:%'`);
    await client.query(
      `UPDATE "User" SET "failedLoginCount" = 0, "lockedUntil" = NULL WHERE "email" LIKE '%@facha.dev'`,
    );
  } finally {
    await client.end();
  }
}
