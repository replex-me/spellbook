import { describe, expect, it } from "vitest";

import {
  buildPlanPrompt,
  buildReviewPrompt,
  combinedReviewSchema,
  conversationPlanSchema,
  toCodexOutputSchema,
  assertReviewEvidence,
  assertConsistentReview,
  assertImageCoverage,
} from "./edit-runner.js";
import type { AiJob } from "./types.js";

const job: AiJob = {
  jobId: "job-1",
  callbackUrl: "https://callback.example.test",
  mode: "plan",
  email: "owner@example.test",
  storageNamespace: "test-storageNamespace",
  requestText: "제목을 짧게 바꿔줘",
  selectedElementIds: ["/ppt/slides/slide1.xml#2"],
  selectedSlideIndexes: [0],
  baseGraphObject: "graph.json",
  basePreviewObjects: ["slide-1.png"],
};

const graph = {
  contractVersion: "1.0",
  documentSha256: "a".repeat(64),
  slideWidthEmu: 12_192_000,
  slideHeightEmu: 6_858_000,
  slides: [
    {
      slideIndex: 0,
      elements: [{ elementId: "/ppt/slides/slide1.xml#2", editable: true }],
    },
    {
      slideIndex: 1,
      elements: [{ elementId: "/ppt/slides/slide2.xml#3", editable: true }],
    },
  ],
};

describe("AI edit prompts", () => {
  it("keeps conversation context subordinate to the current image and scope", async () => {
    const prompt = buildPlanPrompt(
      {
        ...job,
        conversational: true,
        conversationHistory: [
          {
            request: "이전 질문",
            response: "이전 답변",
            status: "answered",
            inputVersionId: "old",
          },
        ],
      },
      graph,
    );
    expect(prompt).toContain("이전 답변");
    expect(prompt).toContain("edit=null");
    expect(prompt).toContain("유일한 현재 파일 상태");
    const schema = await conversationPlanSchema();
    expect(schema.required).toEqual(["message", "edit"]);
    expect(schema.properties.edit.anyOf[0]).toEqual({ type: "null" });
    expect(schema.$defs).toBeDefined();
    expect(schema.properties.edit.anyOf[1].$defs).toBeUndefined();
  });
  it("matches every evidence image to its selected slide, not just matching before/after counts", () => {
    const source = {
      slides: [0, 1, 2, 3].map((slideIndex) => ({
        slideIndex,
        previewObject: `image-${slideIndex}`,
        elements: [],
      })),
    };
    const multi = {
      ...job,
      selectedElementIds: [],
      selectedSlideIndexes: [0, 1, 2, 3],
    };
    expect(() =>
      assertImageCoverage(multi, source, [
        "image-0",
        "image-1",
        "image-2",
        "image-3",
      ]),
    ).not.toThrow();
    expect(() =>
      assertImageCoverage(multi, source, ["image-0", "image-1", "image-2"]),
    ).toThrow(/every selected/);
    expect(() =>
      assertImageCoverage(multi, source, [
        "image-3",
        "image-1",
        "image-2",
        "image-0",
      ]),
    ).toThrow(/identity/);
  });
  it("refuses visual review without complete images and valid structural evidence", () => {
    expect(() => assertReviewEvidence({ valid: true }, 2, 2)).not.toThrow();
    for (const [before, after] of [
      [0, 0],
      [2, 1],
      [1, 2],
    ])
      expect(() =>
        assertReviewEvidence({ valid: true }, before!, after!),
      ).toThrow();
    expect(() => assertReviewEvidence({ valid: false }, 1, 1)).toThrow();
    expect(() => assertReviewEvidence({}, 1, 1)).toThrow();
  });

  it("refuses an approval that contradicts the review's own findings", () => {
    expect(() =>
      assertConsistentReview({
        approved: true,
        problems: [],
        revisedCommand: null,
      }),
    ).not.toThrow();
    expect(() =>
      assertConsistentReview({
        approved: true,
        problems: ["overflow"],
        revisedCommand: null,
      }),
    ).toThrow();
    expect(() =>
      assertConsistentReview({
        approved: true,
        problems: [],
        revisedCommand: {},
      }),
    ).toThrow();
    expect(() =>
      assertConsistentReview({
        approved: false,
        problems: ["overflow"],
        revisedCommand: {},
      }),
    ).not.toThrow();
  });
  it("limits the planning context to the selected slide and preserves the request", () => {
    const prompt = buildPlanPrompt(job, graph);
    expect(prompt).toContain(job.requestText);
    expect(prompt).toContain("slide1.xml#2");
    expect(prompt).not.toContain("slide2.xml#3");
    expect(prompt).toContain("editable=false 요소는 절대 수정하지 마세요");
  });

  it("requires before/after and structural validation during review", () => {
    const prompt = buildReviewPrompt({ ...job, mode: "review" }, graph, graph, {
      valid: true,
    });
    expect(prompt).toContain("수정 전, 수정 후");
    expect(prompt).toContain("구조 검증");
    expect(prompt).toContain("전체 대체 명령");
    expect(prompt).toContain("editable=false 요소는 수정할 수 없습니다");
    expect(prompt).toContain("원본을 변형하는 대체 명령 대신");
  });

  it("converts strict command unions to the Codex structured-output subset", () => {
    const schema = toCodexOutputSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "test",
      title: "test",
      type: "object",
      properties: {
        command: { oneOf: [{ type: "string" }, { type: "null" }] },
      },
    });

    expect(schema).not.toHaveProperty("$schema");
    expect(schema).not.toHaveProperty("$id");
    expect(schema).not.toHaveProperty("title");
    expect(schema).toEqual({
      type: "object",
      properties: {
        command: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    });
  });

  it("lifts embedded edit definitions to the review schema root", async () => {
    const schema = await combinedReviewSchema();
    const revised = (
      schema.properties as Record<string, Record<string, unknown>>
    ).revisedCommand;
    const edit = (revised.anyOf as Array<Record<string, unknown>>)[1]!;

    expect(schema.$defs).toBeDefined();
    expect(edit.$defs).toBeUndefined();
  });
});
