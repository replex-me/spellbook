import { afterEach, describe, expect, it, vi } from "vitest";

import { browserRevision, requireBrowserOrigin } from "./browser-session";

afterEach(() => vi.unstubAllEnvs());

describe("browser edit session boundary", () => {
  it("uses one opaque ETag for the exact version and content digest", () => {
    expect(browserRevision("version-1", "A".repeat(64))).toBe(
      `"version-1:${"a".repeat(64)}"`,
    );
    expect(() => browserRevision("version-1", "short")).toThrow(
      "document_context_not_ready",
    );
  });

  it("accepts only the configured browser origin for a candidate mutation", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://spellbook.example");
    expect(() =>
      requireBrowserOrigin(
        new Request("https://spellbook.example/api/candidate", {
          headers: { origin: "https://spellbook.example" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      requireBrowserOrigin(
        new Request("https://spellbook.example/api/candidate", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toThrow("invalid_browser_origin");
  });
});
