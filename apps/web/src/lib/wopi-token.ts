import { createHmac, timingSafeEqual } from "node:crypto";

export interface WopiClaims {
  version: 1;
  sessionId: string;
  documentId: string;
  accountId: string;
  expiresAt: number;
}

function secret(): string {
  const value = process.env.SPELLBOOK_WOPI_SECRET?.trim();
  if (!value) throw new Error("SPELLBOOK_WOPI_SECRET is required.");
  if (Buffer.byteLength(value) < 32)
    throw new Error("SPELLBOOK_WOPI_SECRET must be at least 32 bytes.");
  return value;
}

export function signWopiToken(claims: WopiClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyWopiToken(token: string, documentId: string): WopiClaims {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("invalid_wopi_token");
  const expected = createHmac("sha256", secret()).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    throw new Error("invalid_wopi_token");
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new Error("invalid_wopi_token");
  let claims: WopiClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid_wopi_token");
  }
  if (
    claims.version !== 1 ||
    claims.documentId !== documentId ||
    !/^[0-9a-f-]{36}$/i.test(claims.sessionId) ||
    typeof claims.accountId !== "string" ||
    !claims.accountId ||
    !Number.isSafeInteger(claims.expiresAt) ||
    claims.expiresAt <= Date.now()
  )
    throw new Error("invalid_wopi_token");
  return claims;
}
