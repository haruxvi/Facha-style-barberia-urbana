import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

export { Prisma };
export type Db = PrismaClient;
/** Cliente utilizable dentro o fuera de una transacción interactiva. */
export type Tx = Prisma.TransactionClient | PrismaClient;

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no está configurada");
  // En Vercel cada instancia serverless abre pocas conexiones; Supabase pooler (6543) multiplexa.
  const adapter = new PrismaPg({ connectionString, max: process.env.VERCEL ? 3 : 10 });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** Detecta la violación de la restricción de exclusión anti-solapamiento de citas. */
export function isOverlapViolation(err: unknown): boolean {
  const text = errorText(err);
  return text.includes("Appointment_no_overlap") || text.includes("23P01");
}

/** Conflicto de escritura o deadlock (Postgres 40001/40P01, Prisma P2034): se puede reintentar. */
export function isRetryableTxError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") return true;
  const text = errorText(err);
  return text.includes("40P01") || text.includes("40001") || /deadlock|write conflict/i.test(text);
}

/**
 * Ejecuta una transacción y la reintenta (con espera aleatoria) ante deadlocks o conflictos de escritura,
 * que pueden ocurrir cuando dos personas reservan el mismo hueco a la vez.
 */
export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isRetryableTxError(err)) throw err;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * i));
    }
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function errorText(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error) {
    const meta = (err as { meta?: unknown }).meta;
    const cause = (err as { cause?: unknown }).cause;
    return `${err.message} ${JSON.stringify(meta ?? "")} ${cause ? errorText(cause) : ""}`;
  }
  return String(err);
}
