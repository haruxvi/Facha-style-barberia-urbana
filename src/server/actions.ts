import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { isAppError } from "@/shared/errors";
import { logger } from "@/shared/logger";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string } | null;

/** Envuelve una Server Action: traduce errores de dominio a mensajes y deja pasar redirect()/notFound(). */
export async function runAction(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? "Guardado" };
  } catch (err) {
    unstable_rethrow(err);
    if (isAppError(err)) return { ok: false, error: err.message };
    if (err instanceof ZodError) return { ok: false, error: err.issues[0]?.message ?? "Datos inválidos" };
    logger.error("action.unhandled", { error: err });
    return { ok: false, error: "Ocurrió un error inesperado. Inténtalo de nuevo." };
  }
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function optStr(fd: FormData, key: string): string | null {
  const v = str(fd, key).trim();
  return v === "" ? null : v;
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

export function list(fd: FormData, key: string): string[] {
  return fd.getAll(key).filter((v): v is string => typeof v === "string" && v !== "");
}
