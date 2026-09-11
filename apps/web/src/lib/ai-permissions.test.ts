import { describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ db: vi.fn(), ensureSchema: vi.fn() }));
import { permissionForGraph, validatePermission } from "./ai-permissions";
import type { ElementGraph } from "./models";

describe("AI document permissions", () => {
  it("shows the current page number without transferring a grant to a different slide", () => {
    const permission = {
      mode: "slides" as const,
      slideIndexes: [0],
      slidePartUris: ["original"],
    };
    const graph = {
      slides: [
        { slideIndex: 0, partUri: "new" },
        { slideIndex: 1, partUri: "original" },
      ],
    } as ElementGraph;
    expect(permissionForGraph(permission, graph).slideIndexes).toEqual([1]);
    expect(
      permissionForGraph(permission, {
        ...graph,
        slides: graph.slides.slice(0, 1),
      }).slideIndexes,
    ).toEqual([]);
    expect(permission.slideIndexes).toEqual([0]);
  });
  it("normalizes an explicitly selected set of pages", () => {
    expect(
      validatePermission({ mode: "slides", slideIndexes: [2, 0, 2] }, 3),
    ).toEqual({ mode: "slides", slideIndexes: [0, 2] });
  });
  it.each([[], [-1], [3], [0.5], ["1"]].map((indexes) => [indexes]))(
    "rejects invalid page scope %j",
    (indexes) => {
      expect(() =>
        validatePermission({ mode: "slides", slideIndexes: indexes }, 3),
      ).toThrow();
    },
  );
  it("does not preserve hidden page grants in read-only mode", () => {
    expect(
      validatePermission({ mode: "read_only", slideIndexes: [0, 1] }, 3),
    ).toEqual({ mode: "read_only", slideIndexes: [] });
  });
  it("rejects unknown modes instead of granting full document access", () => {
    expect(() =>
      validatePermission({ mode: "full_access", slideIndexes: [] }, 3),
    ).toThrow();
  });
});
