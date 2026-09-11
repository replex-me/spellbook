import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const activeSurfaces = [
  new URL("../app/page.tsx", import.meta.url),
  new URL("../components/dashboard.tsx", import.meta.url),
  new URL("../components/native-document.tsx", import.meta.url),
  new URL("../components/native-workspace.tsx", import.meta.url),
  new URL("../components/model-control.tsx", import.meta.url),
];

describe("Spellbook design system contract", () => {
  it("defines global primitives and semantic aliases", async () => {
    const css = await readFile(
      new URL("../app/design-system.css", import.meta.url),
      "utf8",
    );
    for (const token of [
      "--ds-bg-app",
      "--ds-bg-canvas",
      "--ds-bg-surface",
      "--ds-text",
      "--ds-text-secondary",
      "--ds-border",
      "--ds-accent",
      "--ds-focus",
      "--ds-danger",
      "--ds-warning",
      "--ds-success",
      "--ds-space-4",
      "--ds-radius-md",
      "--ds-shadow-2",
      "--ds-font-sans",
    ]) {
      expect(css).toContain(`${token}:`);
    }
  });

  it("keeps accessibility behavior in the shared foundation", async () => {
    const css = await readFile(
      new URL("../app/design-system.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline: 2px solid var(--ds-focus)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".ds-visually-hidden");
  });

  it("routes every active product surface through the shared vocabulary", async () => {
    const source = (
      await Promise.all(activeSurfaces.map((file) => readFile(file, "utf8")))
    ).join("\n");
    expect(source).toContain("SpellbookBrand");
    expect(source).toContain("SpellbookIcon");
    for (const retiredClass of [
      'className="primary-button',
      'className="secondary-button',
      'className="eyebrow',
      'className="wordmark',
      'className="native-quiet',
    ]) {
      expect(source).not.toContain(retiredClass);
    }
  });

  it("keeps product chrome free of page-local hex colors", async () => {
    for (const file of [
      new URL("../components/native-document.css", import.meta.url),
      new URL("../components/native-workspace.css", import.meta.url),
    ]) {
      const css = await readFile(file, "utf8");
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });

  it("separates PowerPoint editor chrome from the AI accent", async () => {
    const workspace = await readFile(
      new URL("../components/native-workspace.tsx", import.meta.url),
      "utf8",
    );
    expect(workspace).toContain("--color-primary=#d24726");
    expect(workspace).toContain("UIMode=tabbed");
    expect(workspace).toContain("PresentationSidebar=false");
    expect(workspace).not.toContain("UIMode=notebookbar");
  });
});
