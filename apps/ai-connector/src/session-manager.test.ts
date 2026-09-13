import { afterEach, describe, expect, it, vi } from "vitest";

import {
  codexSessionLocation,
  isAllowedAiIdentity,
  stableIdentityKey,
} from "./session-manager.js";

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

  it("reuses the standard Codex login only for the explicit local connector", () => {
    vi.stubEnv("SPELLBOOK_CONNECTOR_MODE", "local");
    vi.stubEnv("CODEX_HOME", "/tmp/existing-codex-home");
    expect(codexSessionLocation("owner@example.test")).toMatchObject({
      home: "/tmp/existing-codex-home",
      isolated: false,
    });

    vi.stubEnv("SPELLBOOK_CONNECTOR_MODE", "internal");
    expect(codexSessionLocation("owner@example.test")).toMatchObject({
      isolated: true,
    });
  });

  it("keeps a local connector isolated when the user chooses that mode", () => {
    vi.stubEnv("SPELLBOOK_CONNECTOR_MODE", "local");
    vi.stubEnv("SPELLBOOK_CODEX_AUTH_MODE", "isolated");
    vi.stubEnv("SPELLBOOK_CODEX_AUTH_DIR", "/tmp/spellbook-auth");
    const location = codexSessionLocation("owner@example.test");
    expect(location.home).toBe(
      `/tmp/spellbook-auth/${stableIdentityKey("owner@example.test")}`,
    );
    expect(location.isolated).toBe(true);
  });
});
