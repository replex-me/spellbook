import { describe, expect, it } from "vitest";

import {
  availableDocumentFormatForFile,
  currentPresentationFormat,
  documentFormats,
} from "./document-formats";

describe("document format registry", () => {
  it("keeps the current PPTX vertical available", () => {
    expect(availableDocumentFormatForFile("deck.PPTX")?.id).toBe("pptx");
    expect(currentPresentationFormat.editor.wopiApp).toBe("impress");
  });

  it("does not expose planned adapters as implemented features", () => {
    expect(availableDocumentFormatForFile("draft.docx")).toBeNull();
    expect(availableDocumentFormatForFile("book.spellbook")).toBeNull();
    expect(
      documentFormats().filter((format) => format.availability === "planned"),
    ).toHaveLength(2);
  });
});
