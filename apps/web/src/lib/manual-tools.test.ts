import { describe, expect, it } from "vitest";
import { cmToEmu, emuToCm, supportsManualOperation } from "./manual-tools";
import { parseModelSettings, supportsSettings } from "./ai-models";
import type { ElementNode } from "./models";

describe("direct edit and model controls", () => {
  it("preserves unedited fractional geometry rather than round-tripping display rounding", () => {
    expect(cmToEmu(emuToCm(1234567), 1234567)).toBe(1234567);
    expect(cmToEmu("1.25")).toBe(450000);
    expect(() => cmToEmu("")).toThrow();
    expect(() => cmToEmu("abc")).toThrow();
  });
  it("uses the native capability registry for controls", () => {
    const table = {
      editable: true,
      kind: "graphicFrame",
      tableCells: [["a"]],
    } as ElementNode;
    expect(supportsManualOperation(table, "set_text_style")).toBe(false);
    expect(supportsManualOperation(table, "set_table_cell")).toBe(true);
    expect(
      supportsManualOperation({ ...table, editable: false }, "move_shape"),
    ).toBe(false);
  });
  it("rejects arbitrary settings and unsupported model/effort combinations", () => {
    const settings = { model: "account-model", effort: "high" };
    expect(parseModelSettings(settings)).toEqual(settings);
    expect(() =>
      parseModelSettings({ ...settings, sandbox: "full-access" }),
    ).toThrow();
    expect(() => parseModelSettings({ model: "x", effort: 2 })).toThrow();
    expect(() =>
      parseModelSettings({
        provider: "untrusted-runtime",
        model: "x",
        effort: "high",
      }),
    ).toThrow();
    const models = [
      {
        model: "account-model",
        displayName: "Model",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "high", description: "" },
        ],
        isDefault: true,
      },
    ];
    expect(supportsSettings(models, settings)).toBe(true);
    expect(supportsSettings(models, { ...settings, effort: "max" })).toBe(
      false,
    );
    expect(
      supportsSettings([{ ...models[0], provider: "codex" }], {
        ...settings,
        provider: "claude_code",
      }),
    ).toBe(false);
  });
});
