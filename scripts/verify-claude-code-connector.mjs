#!/usr/bin/env node

import { ClaudeCodeClient } from "../apps/ai-connector/dist/claude-code-client.js";

if (process.env.SPELLBOOK_VERIFY_CLAUDE_CODE !== "1")
  throw new Error(
    "Set SPELLBOOK_VERIFY_CLAUDE_CODE=1 to run the real local subscription check.",
  );

const client = new ClaudeCodeClient();
const status = await client.accountRead();
if (status.account?.type !== "claude")
  throw new Error("A Claude subscription is not connected in Claude Code.");

let calls = 0;
let streamed = "";
const expected = `spellbook-claude-${Date.now()}`;
const result = await client.runStructuredTurn(
  [
    {
      type: "text",
      text: `Call spellbook_connector_check exactly once with value ${expected}. Return only the tool result.`,
    },
  ],
  {},
  60_000,
  {
    modelSettings: { model: "haiku", effort: "low" },
    tools: [
      {
        type: "function",
        name: "spellbook_connector_check",
        description: "Return the exact Spellbook connector check value.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    ],
    onTool: async (name, argumentsValue) => {
      if (
        name !== "spellbook_connector_check" ||
        argumentsValue?.value !== expected
      )
        throw new Error("Claude called an unexpected tool or argument.");
      calls += 1;
      return {
        success: true,
        contentItems: [{ type: "inputText", text: expected }],
      };
    },
    onEvent: (event) => {
      if (event.method === "item/agentMessage/delta")
        streamed += event.params?.delta ?? "";
    },
  },
);

if (calls !== 1 || !result.includes(expected) || !streamed.includes(expected))
  throw new Error("Claude Code did not complete the isolated MCP tool loop.");

process.stdout.write(
  `${JSON.stringify({
    provider: "claude_code",
    subscriptionConnected: true,
    isolatedMcpToolCalls: calls,
    streamingVerified: true,
    resultVerified: true,
  })}\n`,
);
