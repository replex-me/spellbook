import { describe, expect, it } from "vitest";

import { activeAiRuntime, aiRuntimeContract } from "./ai-runtime-contract.js";

describe("AI runtime capability contract", () => {
  it("keeps every required product capability implemented by the active provider", () => {
    expect(activeAiRuntime.provider).toBe("codex");
    expect(Object.keys(activeAiRuntime.capabilities)).toEqual(
      expect.arrayContaining(
        aiRuntimeContract.productContract.requiredCapabilities,
      ),
    );
    expect(aiRuntimeContract.productContract.allowedModelTools).toEqual([
      "native_observe",
      "native_edit",
      "native_review",
      "image_generation",
    ]);
  });

  it("connects Claude through the user-owned unmodified Claude Code runtime", () => {
    const claude = aiRuntimeContract.providers.claude_code;
    expect(claude.integrationStatus).toBe("implemented");
    expect(claude.subscriptionConnection).toBe("user_direct_unmodified_cli");
    expect(claude.capabilities.structured_spellbook_tools).toBe(
      "implemented_by_spellbook",
    );
    expect(claude.capabilities.image_generation).toBe(
      "no_verified_native_equivalent",
    );
  });

  it("keeps generic coding-agent authority outside a document turn", () => {
    expect(
      aiRuntimeContract.productContract.genericCapabilitiesDisabledByDefault,
    ).toEqual(
      expect.arrayContaining([
        "shell",
        "filesystem",
        "browser_automation",
        "external_mcp",
        "multi_agent",
      ]),
    );
  });
});
