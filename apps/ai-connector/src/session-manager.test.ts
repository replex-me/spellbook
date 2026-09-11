import { afterEach, describe, expect, it, vi } from "vitest";

import { isAllowedAiIdentity, stableIdentityKey } from "./session-manager.js";

afterEach(() => vi.unstubAllEnvs());

describe("local AI subscription identity", () => {
  it("allows only the authenticated self-hosted account", () => {
    vi.stubEnv("SPELLBOOK_LOCAL_EMAIL", "owner@example.test");
    expect(isAllowedAiIdentity("OWNER@example.test")).toBe(true);
    expect(isAllowedAiIdentity("other@example.test")).toBe(false);
  });

  it("maps an email to a stable non-identifying directory name", () => {
    expect(stableIdentityKey("OWNER@example.test")).toBe(
      stableIdentityKey("owner@example.test"),
    );
    expect(stableIdentityKey("owner@example.test")).toMatch(/^[0-9a-f]{20}$/);
  });
});
