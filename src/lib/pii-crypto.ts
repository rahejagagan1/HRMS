import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * AES-256-GCM column-level encryption for personally identifiable data
 * (bank account numbers, PAN, Aadhaar, etc.).
 *
 *   encrypted = encryptPII(plain)
 *   plain     = decryptPII(encrypted)
 *
 * Stored format: `enc:v1:<iv-base64>:<tag-base64>:<ciphertext-base64>`
 *
 * • Values that are null / undefined / empty pass through unchanged.
 * • Reading a value that doesn't start with the `enc:v1:` prefix returns
 *   the value as-is — so legacy plaintext rows keep working until the
 *   next write naturally upgrades them.
 *
 * Set `PII_ENCRYPTION_KEY` in the environment. The string is hashed with
 * SHA-256 to produce the 32-byte key AES-256 needs, so any password-grade
 * length is acceptable.
 */

const PREFIX = "enc:v1:";

function getKey(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      "PII_ENCRYPTION_KEY is missing or too short (need ≥16 chars). " +
      "Set it in .env to a long random string and never rotate without a re-encryption migration."
    );
  }
  return createHash("sha256").update(raw).digest();
}

export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

export function encryptPII(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined) return null;
  const trimmed = String(plain).trim();
  if (trimmed === "") return null;
  // Don't double-encrypt — if the caller passes already-encrypted text, return it.
  if (isEncrypted(trimmed)) return trimmed;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptPII(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null;
  if (typeof stored !== "string") return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext — return as-is

  const rest = stored.slice(PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) return null;
  const [ivB64, tagB64, encB64] = parts;
  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const enc = Buffer.from(encB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    // Tampered or wrong-key — surface as null so callers can detect it
    // rather than crashing the whole route.
    return null;
  }
}

/** Convenience: mask all but the last `keep` chars after decrypting. */
export function decryptAndMask(stored: string | null | undefined, keep = 4): string {
  const dec = decryptPII(stored);
  if (!dec) return "";
  if (dec.length <= keep) return dec;
  return "X".repeat(dec.length - keep) + dec.slice(-keep);
}
