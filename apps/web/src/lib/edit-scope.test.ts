import { describe, expect, it } from "vitest";
import { selectedPreviews, validateCommandTargets } from "./edit-scope";
import type { EditCommandBatch, ElementGraph, ElementNode } from "./models";

function fixture(): ElementGraph {
  return {
    contractVersion: "1.0",
    documentSha256: "hash",
    slideWidthEmu: 400,
    slideHeightEmu: 300,
    warnings: [],
    slides: [0, 1, 2, 3].map((slideIndex) => ({
      slideIndex,
      partUri: `slide${slideIndex}`,
      previewObject: `image${slideIndex}`,
      supportGrade: "A",
      warnings: [],
      elements: [0, 1].map(
        (i) =>
          ({
            elementId: `${slideIndex}-${i}`,
            sourceHash: "source",
            kind: "shape",
            editable: true,
          }) as ElementNode,
      ),
    })),
  };
}
function batch(elementId = "0-0", slideIndex = 0): EditCommandBatch {
  return {
    contractVersion: "1.0",
    baseDocumentSha256: "hash",
    summary: "test",
    commands: [
      {
        op: "replace_text",
        target: { elementId, slideIndex, sourceHash: "source" },
        text: "new",
      },
    ],
  };
}
describe("user-authorized edit scope", () => {
  it("rejects text styling of a native table before dispatch while allowing its cell text", () => {
    const graph = fixture();
    graph.slides[0].elements[0].kind = "graphicFrame";
    graph.slides[0].elements[0].tableCells = [["cell"]];
    const command = batch();
    command.commands = [
      {
        op: "set_text_style",
        target: { elementId: "0-0", slideIndex: 0, sourceHash: "source" },
        fontSize: 28,
      },
    ];
    expect(() => validateCommandTargets(command, graph, [], [0])).toThrow(
      "requires shape",
    );
    command.commands = [
      {
        op: "set_table_cell",
        target: { elementId: "0-0", slideIndex: 0, sourceHash: "source" },
        row: 0,
        column: 0,
        text: "changed",
      },
    ];
    expect(() => validateCommandTargets(command, graph, [], [0])).not.toThrow();
    command.commands[0].row = 1;
    expect(() => validateCommandTargets(command, graph, [], [0])).toThrow(
      "outside",
    );
  });
  it("requires document authority and an isolated command for slide topology", () => {
    const command = batch();
    command.commands = [
      { op: "add_slide", templateSlideIndex: 0, insertIndex: 4 },
    ];
    expect(() =>
      validateCommandTargets(command, fixture(), [], [0, 1, 2, 3]),
    ).toThrow(/document-wide/);
    expect(() =>
      validateCommandTargets(command, fixture(), [], [0, 1, 2, 3], true),
    ).not.toThrow();
    command.commands.push(batch().commands[0]);
    expect(() =>
      validateCommandTargets(command, fixture(), [], [0, 1, 2, 3], true),
    ).toThrow(/single/);
  });
  it("does not turn an element grant into permission to insert or change a background", () => {
    for (const op of [
      "add_text_box",
      "add_shape",
      "add_table",
      "add_image",
      "set_background",
    ]) {
      const command = batch();
      command.commands = [{ op, slideIndex: 0 }];
      expect(() =>
        validateCommandTargets(command, fixture(), ["0-0"], []),
      ).toThrow(/whole target slide/);
      expect(() =>
        validateCommandTargets(command, fixture(), [], [0]),
      ).not.toThrow();
    }
  });
  it("checks all group and distribution targets", () => {
    for (const op of ["group_shapes", "distribute_shapes"]) {
      const command = batch();
      command.commands = [
        {
          op,
          targets: [
            batch().commands[0].target,
            batch("0-1").commands[0].target,
          ],
        },
      ];
      expect(() =>
        validateCommandTargets(command, fixture(), ["0-0"], []),
      ).toThrow(/outside/);
    }
  });
  it("permits the selected element but rejects its unselected neighbor", () => {
    expect(() =>
      validateCommandTargets(batch(), fixture(), ["0-0"], []),
    ).not.toThrow();
    expect(() =>
      validateCommandTargets(batch("0-1"), fixture(), ["0-0"], []),
    ).toThrow(/outside/);
  });
  it("permits a whole slide but never a different slide", () => {
    expect(() =>
      validateCommandTargets(batch("0-1"), fixture(), [], [0]),
    ).not.toThrow();
    expect(() =>
      validateCommandTargets(batch("1-0", 1), fixture(), [], [0]),
    ).toThrow(/outside/);
  });
  it("rejects mismatched slide identity and stale source", () => {
    expect(() =>
      validateCommandTargets(batch("0-0", 1), fixture(), ["0-0"], []),
    ).toThrow(/invalid/);
    const command = batch();
    (command.commands[0].target as Record<string, unknown>).sourceHash =
      "stale";
    expect(() =>
      validateCommandTargets(command, fixture(), ["0-0"], []),
    ).toThrow(/stale/);
  });
  it("checks every alignment target", () => {
    const command = batch();
    command.commands = [
      {
        op: "align_shapes",
        targets: [batch().commands[0].target, batch("0-1").commands[0].target],
      },
    ];
    expect(() =>
      validateCommandTargets(command, fixture(), ["0-0"], []),
    ).toThrow(/outside/);
  });
});
describe("complete review evidence", () => {
  it("retains all four slides in stable slide order", () => {
    expect(selectedPreviews(fixture(), [3, 1, 0, 2], ["0-0"])).toEqual([
      "image0",
      "image1",
      "image2",
      "image3",
    ]);
  });
  it("rejects a missing preview instead of silently filtering it", () => {
    const graph = fixture();
    graph.slides[3].previewObject = null;
    expect(() => selectedPreviews(graph, [0, 1, 2, 3], [])).toThrow(/missing/);
  });
  it("rejects missing slide and element identities", () => {
    expect(() => selectedPreviews(fixture(), [99], [])).toThrow(/missing/);
    expect(() => selectedPreviews(fixture(), [], ["missing"])).toThrow(
      /missing/,
    );
  });
});
