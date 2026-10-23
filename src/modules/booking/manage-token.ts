import { deriveKey, hmacSha256, safeEqual } from "@/shared/crypto";
import { env } from "@/shared/env";

/**
 * Token de gestión de una reserva (sin login).
 *
 * Formato: <id de la cita en base64url>.<versión>.<HMAC-SHA256 (256 bits)>
 * - Alta entropía: la parte secreta es un HMAC con una subclave derivada de SESSION_SECRET.
 * - Vinculado a una única reserva (el id va firmado).
 * - Revocable: al subir manageTokenVersion en BD los tokens anteriores dejan de valer.
 * - Expira: se compara con manageTokenExpiresAt en BD.
 * - No se almacena en BD ni en logs; se puede regenerar para incluirlo en recordatorios.
 */

function key(): Buffer {
  return deriveKey(env().SESSION_SECRET, "manage-token");
}

function uuidToB64(id: string): string {
  return Buffer.from(id.replace(/-/g, ""), "hex").toString("base64url");
}

function b64ToUuid(b64: string): string | null {
  const hex = Buffer.from(b64, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createManageToken(appointmentId: string, version: number): string {
  const idPart = uuidToB64(appointmentId);
  const mac = hmacSha256(key(), `${appointmentId}.${version}`, "base64url");
  return `${idPart}.${version}.${mac}`;
}

/** Verifica la firma. Devuelve el id y versión si el token es auténtico (la vigencia se valida contra la BD). */
export function parseManageToken(token: string): { appointmentId: string; version: number } | null {
  if (typeof token !== "string" || token.length > 120) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [idPart, versionPart, mac] = parts as [string, string, string];
  if (!/^\d{1,6}$/.test(versionPart)) return null;
  const appointmentId = b64ToUuid(idPart);
  if (!appointmentId) return null;
  const version = Number(versionPart);
  const expected = hmacSha256(key(), `${appointmentId}.${version}`, "base64url");
  if (!safeEqual(mac, expected)) return null;
  return { appointmentId, version };
}
