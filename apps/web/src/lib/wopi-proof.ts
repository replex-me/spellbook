import { createPublicKey, verify, type KeyObject } from "node:crypto";

const DOTNET_UNIX_EPOCH_TICKS = 621_355_968_000_000_000n;
const TICKS_PER_MILLISECOND = 10_000n;
const MAX_TIMESTAMP_SKEW_MS = 20 * 60 * 1000;

export interface WopiProofKey {
  modulus: string;
  exponent: string;
}

export interface WopiProofKeys {
  current: WopiProofKey;
  old: WopiProofKey;
}

export type WopiProofMatch =
  | "current-proof-current-key"
  | "old-proof-current-key"
  | "current-proof-old-key";

export interface WopiProofInput {
  accessToken: string;
  requestUrl: string;
  timestamp: string;
  proof: string;
  oldProof: string;
}

export function parseWopiProofKeys(xml: string): WopiProofKeys {
  const attributes = xml.match(/<proof-key\b([^>]*)\/?\s*>/i)?.[1];
  if (!attributes) throw new Error("office_proof_keys_not_discovered");
  const modulus = xmlAttribute(attributes, "modulus");
  const exponent = xmlAttribute(attributes, "exponent");
  const oldModulus = xmlAttribute(attributes, "oldmodulus");
  const oldExponent = xmlAttribute(attributes, "oldexponent");
  if (!modulus || !exponent || !oldModulus || !oldExponent)
    throw new Error("office_proof_keys_invalid");
  return {
    current: { modulus, exponent },
    old: { modulus: oldModulus, exponent: oldExponent },
  };
}

export function rawQueryParameter(
  requestUrl: string,
  name: string,
): string | undefined {
  const query = requestUrl.split("?", 2)[1]?.split("#", 1)[0];
  if (!query) return undefined;
  const prefix = `${name}=`;
  for (const entry of query.split("&")) {
    if (entry.startsWith(prefix)) return entry.slice(prefix.length);
  }
  return undefined;
}

export function buildExpectedWopiProof(input: {
  accessToken: string;
  requestUrl: string;
  timestamp: string;
}): Buffer {
  const timestamp = parseTimestamp(input.timestamp);
  const accessToken = Buffer.from(input.accessToken, "utf8");
  const requestUrl = Buffer.from(input.requestUrl.toUpperCase(), "utf8");
  const timestampBytes = Buffer.allocUnsafe(8);
  timestampBytes.writeBigInt64BE(timestamp);
  return Buffer.concat([
    lengthPrefix(accessToken.length),
    accessToken,
    lengthPrefix(requestUrl.length),
    requestUrl,
    lengthPrefix(timestampBytes.length),
    timestampBytes,
  ]);
}

export function verifyWopiProof(
  input: WopiProofInput,
  keys: WopiProofKeys,
  nowMs = Date.now(),
): WopiProofMatch | null {
  try {
    const timestamp = parseTimestamp(input.timestamp);
    const nowTicks =
      BigInt(Math.trunc(nowMs)) * TICKS_PER_MILLISECOND +
      DOTNET_UNIX_EPOCH_TICKS;
    const maximumSkew = BigInt(MAX_TIMESTAMP_SKEW_MS) * TICKS_PER_MILLISECOND;
    if (absolute(timestamp - nowTicks) > maximumSkew) return null;

    const expected = buildExpectedWopiProof(input);
    const current = toPublicKey(keys.current);
    if (verifySignature(expected, input.proof, current))
      return "current-proof-current-key";
    if (verifySignature(expected, input.oldProof, current))
      return "old-proof-current-key";
    if (verifySignature(expected, input.proof, toPublicKey(keys.old)))
      return "current-proof-old-key";
    return null;
  } catch {
    return null;
  }
}

function verifySignature(
  expected: Buffer,
  signature: string,
  key: KeyObject,
): boolean {
  try {
    return verify(
      "RSA-SHA256",
      expected,
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

function toPublicKey(key: WopiProofKey): KeyObject {
  const modulus = Buffer.from(key.modulus, "base64");
  const exponent = Buffer.from(key.exponent, "base64");
  if (!modulus.length || !exponent.length)
    throw new Error("office_proof_keys_invalid");
  return createPublicKey({
    key: {
      kty: "RSA",
      n: modulus.toString("base64url"),
      e: exponent.toString("base64url"),
    },
    format: "jwk",
  });
}

function parseTimestamp(value: string): bigint {
  if (!/^[0-9]{1,20}$/.test(value)) throw new Error("invalid_wopi_timestamp");
  const parsed = BigInt(value);
  if (parsed > 9_223_372_036_854_775_807n)
    throw new Error("invalid_wopi_timestamp");
  return parsed;
}

function lengthPrefix(value: number): Buffer {
  const result = Buffer.allocUnsafe(4);
  result.writeUInt32BE(value);
  return result;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function xmlAttribute(source: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(
    new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*["']([^"']*)["']`, "i"),
  )?.[1];
}
