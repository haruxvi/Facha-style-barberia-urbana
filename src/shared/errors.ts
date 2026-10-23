/**
 * Errores de dominio. La capa HTTP los traduce a códigos de estado sin filtrar detalles internos.
 * `message` siempre es apto para mostrarse al usuario (en español).
 */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SLOT_UNAVAILABLE"
  | "POLICY"
  | "RATE_LIMITED"
  | "PROVIDER"
  | "CONFIG";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SLOT_UNAVAILABLE: 409,
  POLICY: 422,
  RATE_LIMITED: 429,
  PROVIDER: 502,
  CONFIG: 503,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const notFound = (what = "Recurso") => new AppError("NOT_FOUND", `${what} no encontrado`);
export const forbidden = (msg = "No tienes permiso para realizar esta acción") =>
  new AppError("FORBIDDEN", msg);
export const validation = (msg: string, details?: Record<string, unknown>) =>
  new AppError("VALIDATION", msg, details);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const policy = (msg: string) => new AppError("POLICY", msg);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
