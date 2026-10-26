import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET debe tener al menos 32 caracteres"),
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY debe ser 32 bytes en base64"),
    CRON_SECRET: z.string().min(16),

    WHATSAPP_API_VERSION: z.string().default("v23.0"),
    WHATSAPP_VERIFY_TOKEN: optional,
    WHATSAPP_APP_SECRET: optional,
    WHATSAPP_ACCESS_TOKEN: optional,
    WHATSAPP_PHONE_NUMBER_ID: optional,

    MERCADOPAGO_ACCESS_TOKEN: optional,
    MERCADOPAGO_WEBHOOK_SECRET: optional,

    EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
    EMAIL_API_KEY: optional,
    EMAIL_FROM: z.string().default("Facha Style <reservas@example.com>"),

    PAYMENTS_FAKE_ENABLED: optional,
    // Demo local (Docker): http, cookies sin Secure y proveedores simulados. Solo con URLs locales.
    DEMO_MODE: optional,
  })
  .superRefine((env, ctx) => {
    const demo = env.DEMO_MODE === "true";
    if (demo && !isLocalUrl(env.APP_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["DEMO_MODE"],
        message: "DEMO_MODE solo se permite con APP_URL local (localhost o IP de red privada)",
      });
    }
    if (env.NODE_ENV === "production" && !demo) {
      if (!env.APP_URL.startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "En producción APP_URL debe ser https" });
      }
      if (env.EMAIL_PROVIDER === "resend" && !env.EMAIL_API_KEY) {
        ctx.addIssue({ code: "custom", path: ["EMAIL_API_KEY"], message: "Falta EMAIL_API_KEY" });
      }
    }
  });

export type Env = z.infer<typeof schema>;

/** localhost, *.local, *.localhost o IP privada (10/8, 172.16/12, 192.168/16). */
export function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

let cached: Env | undefined;

/** Variables de entorno validadas. Falla de forma explícita si falta alguna obligatoria. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Configuración inválida de variables de entorno:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

/** Demo local: validado al arrancar para que solo funcione con URLs locales. */
export function demoMode(): boolean {
  return env().DEMO_MODE === "true";
}

/** Se permiten simuladores (WhatsApp/correo/pagos) en desarrollo, tests o la demo local. */
export function simulatorsAllowed(): boolean {
  return !isProduction() || demoMode();
}

/**
 * Cookies con Secure y prefijo __Host- en producción real. Se lee de process.env directamente
 * porque también lo usa el proxy (que no debe cargar toda la validación).
 */
export function secureCookies(): boolean {
  return process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true";
}

/** El proveedor de pagos simulado NUNCA está disponible en producción real (sí en la demo local). */
export function fakePaymentsEnabled(): boolean {
  return simulatorsAllowed() && env().PAYMENTS_FAKE_ENABLED === "true";
}

export function appUrl(path = ""): string {
  return new URL(path, env().APP_URL).toString();
}
