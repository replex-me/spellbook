import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_DOMAIN = "spellbook-native-connector-v1";

export interface NativeConnectorClaims {
  version: 1;
  jobId: string;
  sessionId: string;
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

function signature(payload: string): Buffer {
  return createHmac("sha256", secret())
    .update(TOKEN_DOMAIN)
    .update("\0")
    .update(payload)
    .digest();
}

export function signNativeConnectorToken(
  claims: NativeConnectorClaims,
): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifyNativeConnectorToken(
  token: string,
  jobId: string,
): NativeConnectorClaims {
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra)
    throw new Error("invalid_native_connector_capability");
  let given: Buffer;
  try {
    given = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new Error("invalid_native_connector_capability");
  }
  const expected = signature(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new Error("invalid_native_connector_capability");
  let claims: NativeConnectorClaims;
  try {
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as NativeConnectorClaims;
  } catch {
    throw new Error("invalid_native_connector_capability");
  }
  if (
    claims.version !== 1 ||
    claims.jobId !== jobId ||
    !/^[0-9a-f-]{36}$/i.test(claims.jobId) ||
    !/^[0-9a-f-]{36}$/i.test(claims.sessionId) ||
    typeof claims.accountId !== "string" ||
    !claims.accountId ||
    !Number.isSafeInteger(claims.expiresAt) ||
    claims.expiresAt <= Date.now()
  )
    throw new Error("invalid_native_connector_capability");
  return claims;
}

export function bearerNativeConnectorToken(request: Request): string {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match || match[1].length > 2_048)
    throw new Error("invalid_native_connector_capability");
  return match[1];
}
