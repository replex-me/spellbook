import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  signNativeConnectorToken,
  verifyNativeConnectorToken,
} from "./native-connector-token";

afterEach(() => vi.unstubAllEnvs());

describe("native connector job capability", () => {
  it("binds a short-lived token to one job, native session, and account", () => {
    vi.stubEnv(
      "SPELLBOOK_WOPI_SECRET",
      "connector-capability-test-secret-1234567890",
    );
    const claims = {
      version: 1 as const,
      jobId: randomUUID(),
      sessionId: randomUUID(),
      accountId: "account-1",
      expiresAt: Date.now() + 60_000,
    };
    const token = signNativeConnectorToken(claims);
    expect(verifyNativeConnectorToken(token, claims.jobId)).toEqual(claims);
    expect(() => verifyNativeConnectorToken(token, randomUUID())).toThrow(
      "invalid_native_connector_capability",
    );
    expect(() => verifyNativeConnectorToken(`${token}x`, claims.jobId)).toThrow(
      "invalid_native_connector_capability",
    );
  });

  it("rejects an expired capability", () => {
    vi.stubEnv(
      "SPELLBOOK_WOPI_SECRET",
      "connector-capability-test-secret-1234567890",
    );
    const jobId = randomUUID();
    const token = signNativeConnectorToken({
      version: 1,
      jobId,
      sessionId: randomUUID(),
      accountId: "account-1",
      expiresAt: Date.now() - 1,
    });
    expect(() => verifyNativeConnectorToken(token, jobId)).toThrow(
      "invalid_native_connector_capability",
    );
  });
});
