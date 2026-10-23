import { z } from "zod";
import { assertCan, type AuthContext } from "@/modules/identity";
import { audit } from "@/shared/audit";
import { db } from "@/shared/db";
import { notFound, validation } from "@/shared/errors";
import { parseInput } from "@/shared/validation";
import { renderTemplate, unknownVariables, type TemplateVars } from "./templates";

export async function listTemplates(ctx: AuthContext) {
  return db.messageTemplate.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ key: "asc" }, { channel: "asc" }],
  });
}

const templateSchema = z.object({
  id: z.uuid().optional(),
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{2,40}$/, "Clave: minúsculas, números y _"),
  channel: z.enum(["WHATSAPP", "EMAIL"]),
  name: z.string().trim().min(2).max(80),
  subject: z.string().trim().max(150).optional().nullable(),
  body: z.string().trim().min(1).max(2000),
  waTemplateName: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,512}$/, "Nombre de plantilla de Meta inválido")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  waLanguage: z.string().trim().max(10).optional().nullable(),
  active: z.boolean().default(true),
});

export async function saveTemplate(ctx: AuthContext, input: z.input<typeof templateSchema>) {
  assertCan(ctx, "automations.manage");
  const data = parseInput(templateSchema, input);
  const bad = [...unknownVariables(data.body), ...unknownVariables(data.subject ?? "")];
  if (bad.length) throw validation(`Variables no permitidas: ${[...new Set(bad)].join(", ")}`);
  const { id, ...rest } = data;
  if (id) {
    const r = await db.messageTemplate.updateMany({ where: { id, tenantId: ctx.tenantId }, data: rest });
    if (r.count !== 1) throw notFound("Plantilla");
  } else {
    await db.messageTemplate.create({ data: { ...rest, tenantId: ctx.tenantId } });
  }
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "template.saved",
    metadata: { key: data.key, channel: data.channel },
  });
}

/** Previsualización con datos de ejemplo (claramente ficticios). */
export function previewTemplate(body: string): string {
  const sample: TemplateVars = {
    customer_name: "Juan",
    barbershop_name: "Tu barbería",
    service_name: "Corte + barba",
    appointment_date: "viernes, 24 de octubre",
    appointment_time: "17:30",
    barber_name: "Matías",
    branch_name: "Centro",
    branch_address: "Av. Ejemplo 123",
    management_url: "https://ejemplo.invalid/reservas/gestionar/…",
    booking_url: "https://ejemplo.invalid/b/tu-barberia",
    amount_due: "$5.000",
  };
  return renderTemplate(body, sample, "text");
}
