import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const screenshotDir = path.resolve(
  process.cwd(),
  "../../.tmp-runtime-validation",
);

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/documents") {
      return route.fulfill({
        json: {
          documents: [
            {
              id: "quarterly-review",
              fileName: "2026_3분기_경영회의.pptx",
              status: "ready",
              lastError: null,
              createdAt: "2026-09-10T08:30:00.000Z",
            },
            {
              id: "product-proposal",
              fileName: "신제품_런칭_제안서.pptx",
              status: "candidate_ready",
              lastError: null,
              createdAt: "2026-09-09T04:10:00.000Z",
            },
          ],
        },
      });
    }
    if (pathname === "/api/ai/account/status") {
      return route.fulfill({
        json: {
          account: {
            account: {
              type: "chatgpt",
              email: "spellbook@example.com",
              planType: "Plus",
            },
          },
        },
      });
    }
    if (pathname === "/api/office/warm") {
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await fs.mkdir(screenshotDir, { recursive: true });
});

test("작업 시작 화면은 데스크톱부터 모바일까지 같은 위계로 재배치된다", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "보이는 그대로 열고, 필요한 것만 고칩니다.",
    }),
  ).toBeVisible();
  await expect(page.getByText("2026_3분기_경영회의.pptx")).toBeVisible();
  await expect(page.getByText("연결됨", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDir, "design-system-dashboard-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 820, height: 1000 });
  await expect(page.locator(".dashboard-start-grid")).toHaveCSS(
    "grid-template-columns",
    "772px",
  );
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDir, "design-system-dashboard-tablet.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "PPTX 업로드" })).toBeVisible();
  await expect(page.getByText("spellbook@example.com")).toBeVisible();
  await expect(page.getByText("준비됨")).not.toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDir, "design-system-dashboard-mobile.png"),
    fullPage: true,
  });
});

test("PowerPoint 작업대와 AI 패널은 좁은 화면에서도 같은 도구 체계를 유지한다", async ({
  page,
}) => {
  await page.route("**/mock-office", async (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body></body></html>",
    }),
  );
  await page.route("**/api/documents/design-workspace/native/launch", (route) =>
    route.fulfill({
      json: {
        documentId: "design-workspace",
        fileName: "2026_3분기_경영회의.pptx",
        editorUrl: "http://localhost:3112/mock-office",
        accessToken: "design-system-test-token",
        expiresAt: Date.now() + 60_000,
        apiBase: "http://localhost:3112/api/documents/design-workspace/native",
      },
    }),
  );

  await page.goto("/documents/design-workspace");
  await expect(
    page.getByText("AI와 편집", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("편집기 연결 중")).toBeVisible();
  await expect(page.getByText("프레젠테이션을 열고 있습니다")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDir, "design-system-workspace-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".native-chat")).toHaveCSS("width", "390px");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDir, "design-system-workspace-mobile.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "AI 대화 접기" }).click();
  await expect(page.locator(".native-chat")).toBeHidden();
  await expect(page.getByTitle("PPT 편집기")).toBeVisible();
  await page.getByRole("button", { name: "AI와 편집" }).click();
  await expect(page.locator(".native-chat")).toBeVisible();
});

test("AI가 연결되지 않아도 PPT 편집은 열리고 대화 패널에서 바로 연결한다", async ({
  page,
}) => {
  await page.route("**/api/ai/account/status", (route) =>
    route.fulfill({ json: { account: { account: null } } }),
  );
  await page.route("**/api/ai/account/login", (route) =>
    route.fulfill({
      json: {
        loginId: "login-1",
        verificationUrl: "https://auth.openai.com/device",
        userCode: "PRES-ENT1",
      },
    }),
  );
  await page.route("**/mock-office", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body>편집기 캔버스</body></html>",
    }),
  );
  await page.route("**/api/documents/disconnected/native/launch", (route) =>
    route.fulfill({
      json: {
        documentId: "disconnected",
        fileName: "AI_연결전에도_편집.pptx",
        editorUrl: "http://localhost:3112/mock-office",
        accessToken: "disconnected-test-token",
        expiresAt: Date.now() + 60_000,
        apiBase: "http://localhost:3112/api/documents/disconnected/native",
      },
    }),
  );

  await page.goto("/documents/disconnected");
  await expect(page.getByTitle("PPT 편집기")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "AI 편집을 사용하려면 연결이 필요합니다",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("AI에게 요청")).toHaveCount(0);
  await expect(
    page.getByText(
      "AI 연결 전에도 리본과 캔버스의 모든 직접 편집은 가능합니다.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "내 AI 구독 연결" }).click();
  await expect(
    page.getByRole("heading", { name: "OpenAI에서 연결을 승인하세요" }),
  ).toBeVisible();
  await expect(page.getByText("PRES-ENT1")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "OpenAI 코드 입력 화면 열기" }),
  ).toHaveAttribute("href", "https://auth.openai.com/device");
});

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}
