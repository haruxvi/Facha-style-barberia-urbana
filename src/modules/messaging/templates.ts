import { escapeHtml } from "@/shared/html";

/** Variables permitidas en plantillas. Cualquier otra se rechaza al guardar. */
export const TEMPLATE_VARIABLES = [
  "customer_name",
  "barbershop_name",
  "service_name",
  "appointment_date",
  "appointment_time",
  "barber_name",
  "branch_name",
  "branch_address",
  "management_url",
  "booking_url",
  "amount_due",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string>>;

const VAR_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

export function extractVariables(body: string): string[] {
  return [...body.matchAll(VAR_RE)].map((m) => m[1]!);
}

export function unknownVariables(body: string): string[] {
  const allowed = new Set<string>(TEMPLATE_VARIABLES);
  return [...new Set(extractVariables(body).filter((v) => !allowed.has(v)))];
}

/** Limpia un valor para texto plano (WhatsApp): sin caracteres de control ni saltos inyectados. */
function sanitizeText(v: string): string {
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
}

/**
 * Sustituye {{variables}}. Los valores se escapan según el formato de salida:
 * - "html": escape HTML (los valores nunca pueden inyectar marcado).
 * - "text": sin caracteres de control.
 * Variables desconocidas o sin valor se reemplazan por cadena vacía.
 */
export function renderTemplate(body: string, vars: TemplateVars, mode: "text" | "html"): string {
  const allowed = new Set<string>(TEMPLATE_VARIABLES);
  return body.replace(VAR_RE, (_m, name: string) => {
    if (!allowed.has(name)) return "";
    const value = vars[name as TemplateVariable] ?? "";
    return mode === "html" ? escapeHtml(value) : sanitizeText(value);
  });
}

/** Valores en el orden en que aparecen, para los parámetros de una plantilla aprobada de WhatsApp. */
export function orderedValues(body: string, vars: TemplateVars): string[] {
  return extractVariables(body).map((name) => sanitizeText(vars[name as TemplateVariable] ?? "-") || "-");
}

/** Convierte el cuerpo de texto a un HTML simple y seguro para correo. */
export function textToEmailHtml(renderedHtmlBody: string, footerHtml = ""): string {
  const paragraphs = renderedHtmlBody
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const linked = paragraphs.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#b8860b">$1</a>');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5;max-width:560px;margin:0 auto;padding:16px">${linked}${footerHtml}</body></html>`;
}
