import { describe, expect, it } from "vitest";

import {
  humanNativeSavePolicy,
  reviewedAiSavePolicy,
} from "./native-change-budget";

const result = (changedSlideIndexes: number[]) => ({ changedSlideIndexes });

describe("native save change budgets", () => {
  it("allows the complete native human surface but rejects opaque package mutation", () => {
    const policy = humanNativeSavePolicy();

    expect(policy.origin).toBe("human");
    expect(policy.budget.targetSlideIndexes).toBeNull();
    expect(policy.budget.allowPartCreationOrDeletion).toBe(true);
    expect(policy.budget.allowedCategories).toContain("slide_master_parts");
    expect(policy.budget.allowedCategories).toContain("diagram_parts");
    expect(policy.budget.allowedCategories).not.toContain("macros");
    expect(policy.budget.allowedCategories).not.toContain("custom_xml");
    expect(policy.budget.allowedCategories).not.toContain("unknown");
  });

  it("unions only the executed AI operation families and changed slides", () => {
    const policy = reviewedAiSavePolicy([
      {
        id: "task-text",
        request: {
          operation: "edit_batch",
          dryRun: false,
          commands: [
            { op: "replace_text", elementId: "0/0" },
            { op: "set_chart_data", elementId: "2/0" },
          ],
        },
        result: result([2, 0]),
      },
    ]);

    expect(policy).toMatchObject({
      origin: "ai",
      taskIds: ["task-text"],
      budget: {
        targetSlideIndexes: [0, 2],
        allowPartCreationOrDeletion: false,
      },
    });
    expect(policy.budget.allowedCategories).toEqual([
      "chart_parts",
      "embedded_workbooks",
      "slide_parts",
      "slide_relationships",
    ]);
  });

  it("grants package creation only for a creation mutation", () => {
    const policy = reviewedAiSavePolicy([
      {
        id: "task-image",
        request: { operation: "insert_image", slideIndex: 1 },
        result: result([1]),
      },
    ]);

    expect(policy.budget.allowPartCreationOrDeletion).toBe(true);
    expect(policy.budget.allowedCategories).toEqual([
      "media_parts",
      "slide_parts",
      "slide_relationships",
    ]);
  });

  it("fails closed when reviewed AI change evidence has no bounded mutation", () => {
    expect(() =>
      reviewedAiSavePolicy([
        {
          id: "task-observe",
          request: { operation: "observe" },
          result: result([]),
        },
      ]),
    ).toThrow("native_ai_change_evidence_missing");
    expect(() =>
      reviewedAiSavePolicy([
        {
          id: "task-unknown",
          request: {
            operation: "edit",
            command: { op: "run_arbitrary_macro" },
          },
          result: result([0]),
        },
      ]),
    ).toThrow("native_ai_change_budget_unknown_operation");
  });
});
