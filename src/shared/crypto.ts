import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** Token aleatorio de alta entropía (256 bits por defecto), apto para URLs. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hash de un token para almacenarlo (sesiones, reset de contraseña, invitaciones). */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(
  key: string | Buffer,
  data: string,
  encoding: "hex" | "base64" | "base64url" = "hex",
) {
  return createHmac("sha256", key).update(data).digest(encoding);
}

/** Comparación en tiempo constante de cadenas. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Deriva una subclave independiente por propósito a partir de un secreto maestro. */
export function deriveKey(master: string, purpose: string): Buffer {
  return createHmac("sha256", master).update(`facha:${purpose}`).digest();
}

// ── Cifrado simétrico de secretos de integraciones (AES-256-GCM) ──

export function encryptSecret(plaintext: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string, keyB64: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64)
    throw new Error("Formato de secreto cifrado inválido");
  const key = Buffer.from(keyB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString(
    "utf8",
  );
}
