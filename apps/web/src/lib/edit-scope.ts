import type { EditCommandBatch, ElementGraph } from "./models";
import capabilities from "../../../../contracts/edit-target-capabilities.json";

export class EditValidationError extends Error {}

export const slideStructureOperations = new Set([
  "add_slide",
  "duplicate_slide",
  "delete_slide",
  "move_slide",
]);

/** Slide selections grant writes to that slide; element selections grant only that element. */
export function validateCommandTargets(
  batch: EditCommandBatch,
  graph: ElementGraph,
  selectedIds: string[],
  slideIndexes: number[],
  documentPermission = false,
): void {
  const selected = new Set(selectedIds);
  const slides = new Set(slideIndexes);
  const elements = new Map(
    graph.slides.flatMap((slide) =>
      slide.elements.map(
        (element) =>
          [
            element.elementId,
            { element, slideIndex: slide.slideIndex },
          ] as const,
      ),
    ),
  );
  for (const command of batch.commands) {
    if (slideStructureOperations.has(String(command.op))) {
      if (!documentPermission)
        throw new EditValidationError(
          "Slide structure changes require document-wide permission.",
        );
      if (batch.commands.length !== 1)
        throw new EditValidationError(
          "Observe after each single slide structure command.",
        );
      const source =
        command.op === "add_slide"
          ? command.templateSlideIndex
          : command.slideIndex;
      if (!graph.slides.some((slide) => slide.slideIndex === source))
        throw new EditValidationError("Invalid source slide.");
      if (command.op === "delete_slide" && graph.slides.length === 1)
        throw new EditValidationError("Cannot delete the last slide.");
      if (
        command.op !== "delete_slide" &&
        (!Number.isInteger(command.insertIndex) ||
          Number(command.insertIndex) < 0 ||
          Number(command.insertIndex) >
            graph.slides.length - (command.op === "move_slide" ? 1 : 0))
      )
        throw new EditValidationError("Invalid insertion index.");
    } else if (!command.target && !command.targets) {
      if (
        !graph.slides.some(
          (slide) => slide.slideIndex === command.slideIndex,
        ) ||
        !slides.has(Number(command.slideIndex))
      )
        throw new EditValidationError(
          "Creating content or changing a background requires permission for the whole target slide.",
        );
    }
  }
  const targets = batch.commands.flatMap((command) =>
    (command.targets
      ? Array.isArray(command.targets)
        ? command.targets
        : []
      : command.target
        ? [command.target]
        : []
    ).map((target) => ({ target, command })),
  ) as Array<{
    target: Record<string, unknown>;
    command: Record<string, unknown>;
  }>;
  for (const { target, command } of targets) {
    const op = String(command.op);
    const match = elements.get(String(target.elementId));
    if (
      !match?.element.editable ||
      match.element.sourceHash !== target.sourceHash ||
      match.slideIndex !== target.slideIndex
    )
      throw new EditValidationError(
        "AI command contains an invalid or stale element target.",
      );
    if (!selected.has(match.element.elementId) && !slides.has(match.slideIndex))
      throw new EditValidationError(
        "AI command targets an element outside the user selection.",
      );
    const capability = (
      capabilities as Record<
        string,
        { targetKinds: string[]; requiresTableCells?: boolean }
      >
    )[op];
    if (
      capability &&
      (!capability.targetKinds.includes(match.element.kind) ||
        (capability.requiresTableCells && !match.element.tableCells))
    )
      throw new EditValidationError(
        `${op} requires ${capability.targetKinds.join("/")}${capability.requiresTableCells ? " with native table cells" : ""}; target is ${match.element.kind}. Use supported native operations; do not cover this object with an imitation.`,
      );
    if (op === "set_table_cell") {
      if (
        !match.element.tableCells?.[Number(command.row)] ||
        typeof match.element.tableCells[Number(command.row)][
          Number(command.column)
        ] !== "string"
      )
        throw new EditValidationError(
          "Table cell is outside the observed rows and columns.",
        );
    }
  }
}

/** Never silently drop evidence: missing renders must prevent a successful review. */
export function selectedPreviews(
  graph: ElementGraph,
  slideIndexes: number[],
  selectedIds: string[],
): string[] {
  const indexes = new Set(slideIndexes);
  const remainingIds = new Set(selectedIds);
  for (const slide of graph.slides) {
    for (const element of slide.elements) {
      if (remainingIds.delete(element.elementId)) indexes.add(slide.slideIndex);
    }
  }
  if (remainingIds.size || !indexes.size)
    throw new EditValidationError(
      "Review selection is missing from the document graph.",
    );
  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => {
      const matches = graph.slides.filter(
        (slide) => slide.slideIndex === index,
      );
      if (matches.length !== 1 || !matches[0].previewObject)
        throw new EditValidationError(
          `Review image is missing or ambiguous for slide ${index}.`,
        );
      return matches[0].previewObject;
    });
}
