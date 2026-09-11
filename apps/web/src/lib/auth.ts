import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { cookies, headers } from "next/headers";

import type { Session } from "./models";

export const SESSION_COOKIE = "spellbook_session";
const SESSION_AUDIENCE = "spellbook-selfhost";
const SESSION_MS = 12 * 60 * 60 * 1000;
const SCRYPT_KEY_BYTES = 64;

interface LocalSessionClaims {
  version: 1;
  audience: typeof SESSION_AUDIENCE;
  subject: string;
  email: string;
  expiresAt: number;
}

export function safeRedirect(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

export function createPasswordHash(password: string): string {
  if (password.length < 12)
    throw new Error("Local password must contain at least 12 characters.");
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, SCRYPT_KEY_BYTES);
  return `scrypt:${salt.toString("base64url")}:${digest.toString("base64url")}`;
}

export function verifyPasswordHash(password: string, encoded: string): boolean {
  const [algorithm, saltValue, digestValue, extra] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltValue || !digestValue || extra)
    return false;
  let expected: Buffer;
  let actual: Buffer;
  try {
    const salt = Buffer.from(saltValue, "base64url");
    expected = Buffer.from(digestValue, "base64url");
    actual = scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function authenticateLocal(email: string, password: string): Session {
  const configuredEmail = requiredEnv("SPELLBOOK_LOCAL_EMAIL")
    .trim()
    .toLowerCase();
  const configuredHash = requiredEnv("SPELLBOOK_LOCAL_PASSWORD_HASH");
  const normalizedEmail = email.trim().toLowerCase();
  const emailMatches = timingSafeTextEqual(normalizedEmail, configuredEmail);
  const passwordMatches = verifyPasswordHash(password, configuredHash);
  if (!emailMatches || !passwordMatches) throw new Error("invalid_credentials");
  return {
    accountId: `local:${createHmac("sha256", sessionSecret())
      .update(configuredEmail)
      .digest("base64url")
      .slice(0, 24)}`,
    email: configuredEmail,
    admin: true,
    token: "",
  };
}

export function createSessionToken(session: Session): string {
  const claims: LocalSessionClaims = {
    version: 1,
    audience: SESSION_AUDIENCE,
    subject: session.accountId,
    email: session.email,
    expiresAt: Date.now() + SESSION_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export async function createSession(token: string): Promise<Session> {
  const [payload, provided, extra] = token.split(".");
  if (!payload || !provided || extra) throw new Error("invalid_session");
  const expected = signature(payload);
  if (!timingSafeTextEqual(provided, expected))
    throw new Error("invalid_session");
  let claims: LocalSessionClaims;
  try {
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as LocalSessionClaims;
  } catch {
    throw new Error("invalid_session");
  }
  if (
    claims.version !== 1 ||
    claims.audience !== SESSION_AUDIENCE ||
    !claims.subject ||
    !claims.email ||
    !Number.isFinite(claims.expiresAt) ||
    claims.expiresAt <= Date.now()
  )
    throw new Error("invalid_session");
  return {
    accountId: claims.subject,
    email: claims.email,
    admin: true,
    token,
  };
}

export async function sessionFromRequest(
  request: Request,
): Promise<Session | null> {
  return sessionFromToken(
    cookieValue(request.headers.get("cookie") ?? "", SESSION_COOKIE),
  );
}

export async function currentSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  return sessionFromToken(token);
}

export async function publicBaseUrl(request?: Request): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  if (request) {
    const host =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const proto =
      request.headers.get("x-forwarded-proto") ??
      new URL(request.url).protocol.replace(":", "");
    if (host) return `${proto}://${host}`;
    return new URL(request.url).origin;
  }
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const proto =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function secureRequest(request: Request): boolean {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

async function sessionFromToken(token: string | null): Promise<Session | null> {
  if (!token) return null;
  try {
    return await createSession(token);
  } catch {
    return null;
  }
}

function signature(payload: string): string {
  return createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

function sessionSecret(): string {
  const secret = requiredEnv("SPELLBOOK_SESSION_SECRET");
  if (Buffer.byteLength(secret) < 32)
    throw new Error("SPELLBOOK_SESSION_SECRET must be at least 32 bytes.");
  return secret;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function cookieValue(header: string, key: string): string | null {
  for (const part of header.split(";")) {
    const [name, ...raw] = part.trim().split("=");
    if (name === key) return decodeURIComponent(raw.join("="));
  }
  return null;
}
