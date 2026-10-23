import type { ActorType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "./db";

export interface Actor {
  type: ActorType;
  userId?: string | null;
  ip?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: "SYSTEM" };

/** Registro de auditoría de acciones importantes. No guardes aquí secretos ni datos personales completos. */
export async function audit(
  entry: {
    tenantId?: string | null;
    actor: Actor;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Prisma.InputJsonValue;
  },
  client: Tx = db,
): Promise<void> {
  await client.auditLog.create({
    data: {
      tenantId: entry.tenantId ?? null,
      actorType: entry.actor.type,
      actorUserId: entry.actor.userId ?? null,
      ip: entry.actor.ip ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
    },
  });
}
