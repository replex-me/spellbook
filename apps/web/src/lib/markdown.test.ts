import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";

import { normalizeQuotedStrongMarkdown } from "./markdown";

describe("Markdown display normalization", () => {
  it("renders quoted emphasis followed by a Korean particle without literal markers", () => {
    const html = renderToStaticMarkup(
      createElement(
        ReactMarkdown,
        null,
        normalizeQuotedStrongMarkdown(
          "첫 슬라이드의 제목은 **“운영 AI 수정 완료”**입니다.",
        ),
      ),
    );

    expect(html).toContain("“<strong>운영 AI 수정 완료</strong>”입니다.");
    expect(html).not.toContain("**");
  });

  it("does not change ordinary emphasis or unmatched quotes", () => {
    expect(normalizeQuotedStrongMarkdown("**중요**합니다")).toBe(
      "**중요**합니다",
    );
    expect(normalizeQuotedStrongMarkdown('**"열린 인용**입니다')).toBe(
      '**"열린 인용**입니다',
    );
  });
});
