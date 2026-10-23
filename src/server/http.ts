import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isAppError } from "@/shared/errors";
import { logger } from "@/shared/logger";

/** Traduce errores a respuestas JSON sin filtrar detalles internos. */
export function errorResponse(err: unknown): NextResponse {
  if (isAppError(err)) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, field: err.details?.field ?? null } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: err.issues[0]?.message ?? "Datos inválidos" } },
      { status: 400 },
    );
  }
  logger.error("http.unhandled", { error: err });
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Error interno. Inténtalo de nuevo." } },
    { status: 500 },
  );
}

const MAX_BODY = 32 * 1024;

/** Lee el cuerpo con límite de tamaño. */
export async function readBody(req: Request, max = MAX_BODY): Promise<string> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > max) throw Object.assign(new Error("payload too large"), { status: 413 });
  const text = await req.text();
  if (text.length > max) throw Object.assign(new Error("payload too large"), { status: 413 });
  return text;
}

export async function readJson<T = unknown>(req: Request, max = MAX_BODY): Promise<T> {
  const text = await readBody(req, max);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw Object.assign(new Error("invalid json"), { status: 400 });
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
  );
}

/** Verificación de Vercel Cron: Authorization: Bearer <CRON_SECRET>. */
export function isCronAuthorized(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
