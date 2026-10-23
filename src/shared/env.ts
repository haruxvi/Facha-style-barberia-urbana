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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (!env.APP_URL.startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "En producción APP_URL debe ser https" });
      }
      if (env.EMAIL_PROVIDER === "resend" && !env.EMAIL_API_KEY) {
        ctx.addIssue({ code: "custom", path: ["EMAIL_API_KEY"], message: "Falta EMAIL_API_KEY" });
      }
    }
  });

export type Env = z.infer<typeof schema>;

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

/** El proveedor de pagos simulado NUNCA está disponible en producción. */
export function fakePaymentsEnabled(): boolean {
  const e = env();
  return e.NODE_ENV !== "production" && e.PAYMENTS_FAKE_ENABLED === "true";
}

export function appUrl(path = ""): string {
  return new URL(path, env().APP_URL).toString();
}
