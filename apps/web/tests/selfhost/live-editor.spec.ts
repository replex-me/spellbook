import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const documentId = process.env.SPELLBOOK_SELFHOST_DOCUMENT_ID;
const cookieFile = path.resolve(
  process.cwd(),
  process.env.SPELLBOOK_SELFHOST_COOKIE_FILE ??
    "../../.tmp-runtime/cookies.txt",
);
const evidenceDir = path.resolve(process.cwd(), "../../.tmp-runtime/evidence");

test.beforeEach(async ({ context }) => {
  const lines = (await fs.readFile(cookieFile, "utf8")).split("\n");
  const line = lines.find(
    (candidate) =>
      candidate.includes("\tspellbook_session\t") &&
      candidate.split("\t").length >= 7,
  );
  if (!line) throw new Error(`No spellbook_session cookie in ${cookieFile}`);
  const [rawDomain, , cookiePath, secure, expires, name, value] =
    line.split("\t");
  await context.addCookies([
    {
      name,
      value,
      domain: rawDomain.replace(/^#HttpOnly_/, ""),
      path: cookiePath,
      httpOnly: rawDomain.startsWith("#HttpOnly_"),
      secure: secure === "TRUE",
      expires: Number(expires),
      sameSite: "Lax",
    },
  ]);
});

test("a PPTX reaches the live canvas, edits, saves and downloads", async ({
  page,
}) => {
  test.skip(!documentId, "SPELLBOOK_SELFHOST_DOCUMENT_ID is required");

  await page.goto(`/documents/${documentId}`);
  await expect(page).toHaveURL(new RegExp(`/documents/${documentId}$`));
  await expect(page.getByTitle("PPT 편집기")).toBeVisible();
  await expect(page.locator(".native-save-state")).toContainText("저장됨", {
    timeout: 60_000,
  });
  await expect(page.locator(".native-chat-title span").last()).toHaveText(
    "AI 연결 필요",
  );

  const editor = page.frameLocator('iframe[title="PPT 편집기"]');
  await expect(editor.locator("body")).toBeVisible();
  await expect(editor.getByText("Explore The New")).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "AI 편집 대화" }),
  ).toBeVisible();
  await expect(
    page.getByText("AI 편집을 사용하려면 연결이 필요합니다"),
  ).toBeVisible();
  await expect(
    page.getByText("PPT는 지금 바로 직접 편집할 수 있습니다."),
  ).toBeVisible();

  await expect
    .poll(() =>
      page
        .frames()
        .find((frame) =>
          frame.url().includes("/extensions/org.spellbook.editor/index.html"),
        ),
    )
    .not.toBeUndefined();
  const editorBridge = page
    .frames()
    .find((frame) =>
      frame.url().includes("/extensions/org.spellbook.editor/index.html"),
    );
  expect(editorBridge).toBeDefined();

  const replacement = "Spellbook round trip verified";
  const changed = await editorBridge!.evaluate(async (nextText) => {
    const native = (
      window as typeof window & {
        presentNative: {
          observe(): Promise<any>;
          edit(request: unknown): Promise<any>;
        };
      }
    ).presentNative;
    const before = await native.observe();
    const target = before.slides[0].elements.find(
      (element: { text?: string }) =>
        element.text === "Typical Presentation" || element.text === nextText,
    );
    if (!target) throw new Error("first_slide_title_not_found");
    const after = await native.edit({
      operation: "edit",
      expectedSlides: JSON.stringify(before.slides),
      permission: { mode: "document" },
      command: {
        op: "replace_text",
        elementId: target.elementId,
        text: nextText,
      },
    });
    return after.slides[0].elements.some(
      (element: { text?: string }) => element.text === nextText,
    );
  }, replacement);
  expect(changed).toBe(true);

  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator(".native-save-state")).toContainText("저장", {
    timeout: 5_000,
  });
  await expect(page.locator(".native-save-state")).toHaveText("저장됨", {
    timeout: 60_000,
  });

  const downloadEvent = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "PPTX 다운로드" }).click();
  const download = await downloadEvent;

  await fs.mkdir(evidenceDir, { recursive: true });
  const downloadedFile = path.join(evidenceDir, "round-trip.pptx");
  await download.saveAs(downloadedFile);
  const archiveCheck = spawnSync("unzip", ["-t", downloadedFile], {
    encoding: "utf8",
  });
  expect(archiveCheck.status, archiveCheck.stderr).toBe(0);
  const slide = spawnSync(
    "unzip",
    ["-p", downloadedFile, "ppt/slides/slide1.xml"],
    { encoding: "utf8" },
  );
  expect(slide.status, slide.stderr).toBe(0);
  expect(slide.stdout).toContain(replacement);
  await page.screenshot({
    path: path.join(evidenceDir, "live-pptx-editor.png"),
    fullPage: true,
  });
});
