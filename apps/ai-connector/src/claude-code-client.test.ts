import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  claudeTurnArguments,
  readClaudeAuthStatus,
  resolveClaudeBinary,
} from "./claude-code-client.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("Claude Code subscription adapter", () => {
  it("uses only the isolated Spellbook MCP tools", () => {
    const args = claudeTurnArguments({
      modelSettings: { model: "sonnet", effort: "high" },
      outputSchema: {},
      resume: false,
      sessionId: "00000000-0000-4000-8000-000000000000",
      toolServer: {
        url: "http://127.0.0.1:43128/mcp",
        authorization: "Bearer test-only",
      },
      toolNames: ["native_observe", "native_edit", "native_review"],
    });
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
    expect(args).toContain("--no-chrome");
    expect(args).toContain("dontAsk");
    expect(args).toContain("");
    expect(args).toContain(
      "mcp__spellbook__native_observe,mcp__spellbook__native_edit,mcp__spellbook__native_review",
    );
    expect(args.join(" ")).not.toMatch(/dangerously-skip|Bash|Read|Edit/u);
    const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
    expect(config.mcpServers.spellbook).toEqual({
      type: "http",
      url: "http://127.0.0.1:43128/mcp",
      headers: { Authorization: "Bearer test-only" },
    });
  });

  it("maps the provider-owned nonzero logged-out status", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "spellbook-claude-"));
    temporaryDirectories.push(directory);
    const binary = path.join(directory, "claude");
    writeFileSync(
      binary,
      '#!/bin/sh\nprintf \'%s\\n\' \'{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}\'\nexit 1\n',
    );
    chmodSync(binary, 0o700);
    await expect(readClaudeAuthStatus(binary)).resolves.toEqual({
      loggedIn: false,
      authMethod: "none",
      apiProvider: "firstParty",
    });
  });

  it("uses an explicitly installed unmodified Claude Code binary", () => {
    expect(resolveClaudeBinary("/opt/homebrew/bin/claude")).toBe(
      "/opt/homebrew/bin/claude",
    );
  });
});
