/**
 * Logger estructurado (JSON en una línea, que Vercel indexa).
 * Redacta claves sensibles: nunca deben llegar a los logs tokens, contraseñas ni teléfonos completos.
 */
type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE = /(pass(word)?|token|secret|authorization|cookie|signature|access_?key|api_?key|card)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE.test(k)) out[k] = "[redacted]";
      else if (/phone|destination|to$/i.test(k) && typeof v === "string") out[k] = maskPhone(v);
      else if (/email/i.test(k) && typeof v === "string") out[k] = maskEmail(v);
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function maskPhone(v: string): string {
  return v.length <= 4 ? "****" : `${v.slice(0, 3)}****${v.slice(-2)}`;
}

export function maskEmail(v: string): string {
  const [user, domain] = v.split("@");
  if (!domain) return "***";
  return `${(user ?? "").slice(0, 1)}***@${domain}`;
}

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level !== "error" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...(redact(ctx) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => write("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
};
