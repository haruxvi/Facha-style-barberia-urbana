import type { IntegrationKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { assertCan, type AuthContext } from "@/modules/identity";
import { audit } from "@/shared/audit";
import { decryptSecret, encryptSecret } from "@/shared/crypto";
import { db, isUniqueViolation } from "@/shared/db";
import { env } from "@/shared/env";
import { conflict } from "@/shared/errors";

/**
 * Credenciales de proveedores por barbería. Los secretos se guardan cifrados con AES-256-GCM
 * y nunca se devuelven a la UI (solo se indica si están configurados).
 *
 * Secretos por tipo:
 *  - WHATSAPP:    accessToken            (externalAccountId = phone_number_id)
 *  - MERCADOPAGO: accessToken, webhookSecret
 */
export const SECRET_FIELDS: Record<IntegrationKind, string[]> = {
  WHATSAPP: ["accessToken"],
  MERCADOPAGO: ["accessToken", "webhookSecret"],
  EMAIL: [],
};

export interface ResolvedIntegration {
  enabled: boolean;
  externalAccountId: string | null;
  publicConfig: Record<string, unknown>;
  secrets: Record<string, string>;
  source: "tenant" | "env";
}

export async function getIntegration(
  tenantId: string,
  kind: IntegrationKind,
): Promise<ResolvedIntegration | null> {
  const row = await db.tenantIntegration.findUnique({ where: { tenantId_kind: { tenantId, kind } } });
  if (row) {
    const secrets = row.secretsEncrypted
      ? (JSON.parse(decryptSecret(row.secretsEncrypted, env().ENCRYPTION_KEY)) as Record<string, string>)
      : {};
    const resolved: ResolvedIntegration = {
      enabled: row.enabled,
      externalAccountId: row.externalAccountId,
      publicConfig: row.publicConfig as Record<string, unknown>,
      secrets,
      source: "tenant",
    };
    // Credenciales globales de respaldo (instalación de una sola barbería).
    if (row.enabled && Object.keys(secrets).length === 0) {
      const fallback = envFallback(kind);
      if (fallback) resolved.secrets = fallback.secrets;
    }
    return resolved;
  }
  return null;
}

function envFallback(kind: IntegrationKind): { secrets: Record<string, string> } | null {
  const e = env();
  if (kind === "WHATSAPP" && e.WHATSAPP_ACCESS_TOKEN)
    return { secrets: { accessToken: e.WHATSAPP_ACCESS_TOKEN } };
  if (kind === "MERCADOPAGO" && e.MERCADOPAGO_ACCESS_TOKEN) {
    return {
      secrets: {
        accessToken: e.MERCADOPAGO_ACCESS_TOKEN,
        ...(e.MERCADOPAGO_WEBHOOK_SECRET ? { webhookSecret: e.MERCADOPAGO_WEBHOOK_SECRET } : {}),
      },
    };
  }
  return null;
}

/** Vista segura para la UI: nunca expone valores secretos. */
export async function getIntegrationStatus(ctx: AuthContext) {
  assertCan(ctx, "integrations.manage");
  const rows = await db.tenantIntegration.findMany({ where: { tenantId: ctx.tenantId } });
  return (["WHATSAPP", "MERCADOPAGO"] as const).map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    let configured: string[] = [];
    if (row?.secretsEncrypted) {
      try {
        configured = Object.keys(JSON.parse(decryptSecret(row.secretsEncrypted, env().ENCRYPTION_KEY)));
      } catch {
        configured = [];
      }
    }
    return {
      kind,
      enabled: row?.enabled ?? false,
      externalAccountId: row?.externalAccountId ?? null,
      publicConfig: (row?.publicConfig ?? {}) as Record<string, unknown>,
      secretsConfigured: configured,
      envFallback: !!envFallback(kind),
    };
  });
}

export async function saveIntegration(
  ctx: AuthContext,
  kind: IntegrationKind,
  input: {
    enabled: boolean;
    externalAccountId?: string | null;
    publicConfig?: Record<string, string>;
    secrets?: Record<string, string | undefined>;
  },
): Promise<void> {
  assertCan(ctx, "integrations.manage");
  const existing = await getIntegration(ctx.tenantId, kind);
  const merged: Record<string, string> = existing?.source === "tenant" ? { ...existing.secrets } : {};
  for (const field of SECRET_FIELDS[kind]) {
    const v = input.secrets?.[field]?.trim();
    if (v) merged[field] = v; // vacío = conservar el valor anterior
  }
  const secretsEncrypted =
    Object.keys(merged).length > 0 ? encryptSecret(JSON.stringify(merged), env().ENCRYPTION_KEY) : null;
  const data = {
    enabled: input.enabled,
    externalAccountId: input.externalAccountId?.trim() || null,
    publicConfig: (input.publicConfig ?? {}) as Prisma.InputJsonValue,
    secretsEncrypted,
  };
  try {
    await db.tenantIntegration.upsert({
      where: { tenantId_kind: { tenantId: ctx.tenantId, kind } },
      create: { tenantId: ctx.tenantId, kind, ...data },
      update: data,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Esa cuenta externa ya está vinculada a otra barbería");
    throw err;
  }
  await audit({
    tenantId: ctx.tenantId,
    actor: { type: "STAFF", userId: ctx.userId },
    action: "integration.updated",
    metadata: {
      kind,
      enabled: input.enabled,
      secretsUpdated: Object.keys(input.secrets ?? {}).filter((k) => input.secrets?.[k]),
    },
  });
}

/** Identifica la barbería por el número receptor de WhatsApp (phone_number_id), nunca por datos del cliente. */
export async function findTenantByWhatsappNumber(phoneNumberId: string): Promise<string | null> {
  const row = await db.tenantIntegration.findUnique({
    where: { kind_externalAccountId: { kind: "WHATSAPP", externalAccountId: phoneNumberId } },
    select: { tenantId: true, enabled: true },
  });
  return row?.enabled ? row.tenantId : null;
}
