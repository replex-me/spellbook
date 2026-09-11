import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRunner, commandReference } from "./agent-runner.js";
import { readSchema } from "./edit-runner.js";
import type { AgentTurnOptions } from "./app-server-client.js";
import type { AiJob } from "./types.js";

afterEach(() => vi.unstubAllGlobals());
it("derives every command's exact field guide from the authoritative schema", async () => {
  const schema = await readSchema("edit-command.schema.json");
  const reference = commandReference(schema);
  expect(reference.split("; ")).toHaveLength(27);
  expect(reference).toContain("add_slide(templateSlideIndex, insertIndex)");
  expect(reference).toContain("fontSize?");
  expect(reference).toContain(
    "add_table(slideIndex, x, y, width, height, rows)",
  );
  expect(reference).not.toContain("sourceSlideIndex");
  expect(
    commandReference(schema, await readSchema("edit-target-capabilities.json")),
  ).toContain("rgb?) [target kinds: shape]");
});
const job: AiJob = {
  jobId: "job",
  mode: "plan",
  execution: "agent",
  email: "test@example.test",
  storageNamespace: "test",
  callbackUrl: "https://spellbook.example/api/internal/jobs/callback",
  requestText: "제목 변경",
  selectedElementIds: [],
  selectedSlideIndexes: [0],
  baseGraphObject: "accounts/a/documents/d/versions/v0/graph",
  basePreviewObjects: ["v0.png"],
};

function fixture(
  work: (options: AgentTurnOptions) => Promise<string>,
  missingImage = false,
  inbox: Array<{ id: string; content: string }> = [],
) {
  let version = "v0";
  const operations: string[] = [];
  const bodies: Record<string, any>[] = [];
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    operations.push(body.operation);
    if (body.operation === "edit") version = "v1";
    if (body.operation === "inbox")
      return Response.json({ messages: inbox.splice(0) });
    return Response.json({
      status: "ready",
      versionId: version,
      candidateVersionId: version === "v0" ? null : version,
      graphObject: `${version}.json`,
      validationObject: version === "v0" ? null : "validation",
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const sessions = {
    client: async () => ({
      runStructuredTurn: async (
        _input: unknown,
        _schema: unknown,
        _timeout: unknown,
        options: AgentTurnOptions,
      ) => work(options),
    }),
  };
  const storage = {
    namespace: () => ({
      object: (name: string) => ({
        download: async () => {
          if (name.endsWith(".png")) {
            if (missingImage) throw new Error("missing image");
            return [Buffer.from("image")];
          }
          if (name === "validation")
            return [Buffer.from(JSON.stringify({ valid: true }))];
          return [
            Buffer.from(
              JSON.stringify({
                slides: [
                  {
                    slideIndex: 0,
                    previewObject: name.replace(".json", ".png"),
                    elements: [],
                  },
                ],
              }),
            ),
          ];
        },
      }),
    }),
  };
  return {
    runner: new AgentRunner(sessions as any, storage as any),
    operations,
    bodies,
  };
}
const signal = () => new AbortController().signal;
describe("agent-driven PPT tool loop", () => {
  it("persists partial assistant output before completion and acknowledges steered input", async () => {
    const send = vi.fn(async () => undefined);
    const f = fixture(
      async (options) => {
        options.onTurn?.(send);
        await vi.waitFor(() =>
          expect(
            f.bodies.some(
              (body) => body.operation === "ack" && body.status === "accepted",
            ),
          ).toBe(true),
        );
        expect(send).toHaveBeenCalledWith(expect.stringContaining("색을 유지"));
        options.onEvent?.({
          method: "item/agentMessage/delta",
          params: { itemId: "reply", delta: "현재 화면" },
        });
        await vi.waitFor(() =>
          expect(
            f.bodies.some(
              (body) =>
                body.role === "assistant" &&
                body.status === "streaming" &&
                body.message === "현재 화면",
            ),
          ).toBe(true),
        );
        options.onEvent?.({
          method: "item/completed",
          params: {
            item: {
              id: "reply",
              type: "agentMessage",
              text: "현재 화면을 확인했습니다",
            },
          },
        });
        await options.onTool("spellbook_observe", {}, "observe", signal());
        return "현재 화면을 확인했습니다";
      },
      false,
      [{ id: "42", content: "색을 유지" }],
    );
    await f.runner.run(job);
    const replies = f.bodies.filter((body) => body.role === "assistant");
    expect(replies.at(-1)).toMatchObject({
      status: "completed",
      message: "현재 화면을 확인했습니다",
    });
    expect(replies.at(-1)!.revision).toBeGreaterThan(replies[0]!.revision);
  });
  it("rejects invalid extra slide observation without expanding edit scope", async () => {
    const f = fixture(async (options) => {
      expect(
        (
          await options.onTool(
            "spellbook_observe",
            { additionalSlideIndexes: [999] },
            "extra",
            signal(),
          )
        ).success,
      ).toBe(false);
      await options.onTool("spellbook_observe", {}, "normal", signal());
      return "현재 슬라이드";
    });
    await f.runner.run(job);
    expect(job.selectedSlideIndexes).toEqual([0]);
    expect(f.operations).not.toContain("edit");
  });
  it("answers from current images without editing", async () => {
    const f = fixture(async (options) => {
      const observed = await options.onTool(
        "spellbook_observe",
        {},
        "observe",
        signal(),
      );
      expect(
        observed.contentItems.some((item) => item.type === "inputImage"),
      ).toBe(true);
      return "현재 화면 설명";
    });
    expect(await f.runner.run(job)).toMatchObject({
      candidateVersionId: null,
      approved: false,
    });
    expect(f.operations).not.toContain("edit");
  });
  it("edits through the host and sees fresh images before review", async () => {
    const f = fixture(async (options) => {
      await options.onTool("spellbook_observe", {}, "observe", signal());
      const changed = await options.onTool(
        "spellbook_edit",
        {},
        "edit",
        signal(),
      );
      expect(changed.contentItems[0]).toMatchObject({
        type: "inputText",
        text: expect.stringContaining('"versionId":"v1"'),
      });
      const reviewed = await options.onTool(
        "spellbook_review",
        { approved: true, problems: [] },
        "review",
        signal(),
      );
      expect(reviewed.success).toBe(true);
      return "새 화면을 확인했습니다.";
    });
    expect(await f.runner.run(job)).toMatchObject({
      candidateVersionId: "v1",
      approved: true,
    });
    expect(f.operations.filter((operation) => operation !== "event")).toEqual([
      "start",
      "observe",
      "edit",
      "observe",
    ]);
  });
  it("does not accept a final success message without candidate review", async () => {
    const f = fixture(async (options) => {
      await options.onTool("spellbook_observe", {}, "observe", signal());
      await options.onTool("spellbook_edit", {}, "edit", signal());
      return "모두 완료";
    });
    await expect(f.runner.run(job)).rejects.toThrow("did not review");
  });
  it("does not mark an incomplete image download as observed", async () => {
    const f = fixture(async (options) => {
      expect(
        (await options.onTool("spellbook_observe", {}, "observe", signal()))
          .success,
      ).toBe(false);
      return "설명";
    }, true);
    await expect(f.runner.run(job)).rejects.toThrow("without observing");
  });
});
