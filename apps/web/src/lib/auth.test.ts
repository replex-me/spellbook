import { afterEach, describe, expect, it } from "vitest";

import {
  authenticateLocal,
  createPasswordHash,
  createSession,
  createSessionToken,
  localAccountId,
  safeRedirect,
  verifyPasswordHash,
} from "./auth";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("self-hosted authentication", () => {
  it("accepts only same-origin path redirects", () => {
    expect(safeRedirect("/documents/abc")).toBe("/documents/abc");
    expect(safeRedirect("//attacker.example")).toBe("/");
    expect(safeRedirect("https://attacker.example")).toBe("/");
  });

  it("uses salted scrypt password hashes", () => {
    const encoded = createPasswordHash("correct horse battery staple");
    expect(encoded).toMatch(/^scrypt:/);
    expect(verifyPasswordHash("correct horse battery staple", encoded)).toBe(
      true,
    );
    expect(verifyPasswordHash("wrong password", encoded)).toBe(false);
  });

  it("signs and verifies a scoped expiring session", async () => {
    process.env.SPELLBOOK_SESSION_SECRET = "s".repeat(48);
    process.env.SPELLBOOK_LOCAL_EMAIL = "owner@example.test";
    process.env.SPELLBOOK_LOCAL_PASSWORD_HASH = createPasswordHash(
      "correct horse battery staple",
    );
    const authenticated = authenticateLocal(
      "OWNER@example.test",
      "correct horse battery staple",
    );
    expect(authenticated.accountId).toBe(localAccountId("owner@example.test"));
    const token = createSessionToken(authenticated);
    await expect(createSession(token)).resolves.toMatchObject({
      email: "owner@example.test",
      admin: true,
    });
    await expect(createSession(`${token}x`)).rejects.toThrow("invalid_session");
  });
});
