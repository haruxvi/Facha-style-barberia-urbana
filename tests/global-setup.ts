import { execSync } from "node:child_process";
import "dotenv/config";

/** Aplica las migraciones versionadas a la BD de tests (la misma ruta que producción: migrate deploy). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Define TEST_DATABASE_URL");
  if (!/facha_test|_test\b|test/.test(url))
    throw new Error("TEST_DATABASE_URL debe apuntar a una base de tests");
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
