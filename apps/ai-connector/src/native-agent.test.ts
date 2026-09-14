import { describe, expect, it, vi } from "vitest";
import type { AgentTurnOptions, AppServerClient } from "./app-server-client.js";
import {
  runNativeTurn,
  type NativeObservation,
  type NativePermission,
} from "./native-agent.js";
import { nativeEditContract } from "./native-edit-contract.js";

const state: NativeObservation = {
  unit: "1/100mm",
  revision: "v2-test",
  activeSlide: 0,
  selectedElementIds: ["0/0"],
  slides: [
    {
      slideIndex: 0,
      elements: [
        { elementId: "0/0", text: "Before" },
        { elementId: "0/1", text: "Other" },
      ],
    },
  ],
  images: [{ slideIndex: 0, pngBytes: [137, 80, 78, 71, 13, 10, 26, 10] }],
  changedSlideIndexes: [],
  visualEvidenceComplete: true,
};
const changedState: NativeObservation = {
  ...structuredClone(state),
  revision: "v2-after",
  changedSlideIndexes: [0],
  visualEvidenceComplete: true,
};
const permission: NativePermission = {
  mode: "document",
  elementIds: [],
  slideIndexes: [],
};
function fixture(
  work: (options: AgentTurnOptions) => Promise<void>,
  scope = permission,
  mutationState: NativeObservation = changedState,
) {
  let current = structuredClone(state);
  const call = vi.fn(
    async (request: Record<string, unknown>, _signal: AbortSignal) => {
      if (request.operation !== "observe" && !request.dryRun)
        current = structuredClone(mutationState);
      return structuredClone(current);
    },
  );
  const signal = new AbortController().signal;
  const client = {
    runStructuredTurn: async (
      _a: unknown,
      _b: unknown,
      _c: unknown,
      options: AgentTurnOptions,
    ) => {
      await work(options);
      return "result";
    },
  } as unknown as AppServerClient;
  return {
    call,
    run: () =>
      runNativeTurn(client, {
        requestText: "Change title",
        host: { call },
        signal,
        permission: scope,
        onText: vi.fn(),
        onTool: vi.fn(),
      }),
    signal,
  };
}
describe("shared open document agent", () => {
  it("uses explicit durable history without a connector-local conversation thread", async () => {
    let prompt = "";
    const client = {
      runStructuredTurn: async (
        messages: Array<{ type: string; text: string }>,
        _schema: unknown,
        _timeout: unknown,
        options: AgentTurnOptions,
      ) => {
        prompt = messages[0]?.text ?? "";
        expect(options.conversationKey).toBeUndefined();
        return "현재 상태를 다시 확인하겠습니다.";
      },
    } as unknown as AppServerClient;
    await runNativeTurn(client, {
      requestText: "아까 요청을 다시 해줘",
      conversationHistory: [
        {
          request: "제목을 바꿔줘",
          response: "수정했습니다.",
          status: "completed",
        },
      ],
      host: { call: vi.fn() },
      signal: new AbortController().signal,
      permission,
      onText: vi.fn(),
      onTool: vi.fn(),
    });
    expect(prompt).toContain('"request":"제목을 바꿔줘"');
    expect(prompt).toContain(
      "live observation and revision are the only authority",
    );
    expect(prompt).toContain("User request: 아까 요청을 다시 해줘");
  });

  it("publishes every verified native operation from the shared contract", async () => {
    const f = fixture(async (o) => {
      const schema = o.tools.find((tool) => tool.name === "native_edit")
        ?.inputSchema as {
        properties: {
          op: { enum: string[] };
          row: { type: string[] };
          column: { type: string[] };
        };
      };
      expect(schema.properties.op.enum).toEqual(
        nativeEditContract.toolInputSchema.properties.op.enum,
      );
      expect(schema.properties.op.enum).toEqual(
        expect.arrayContaining([
          "add_table",
          "align",
          "distribute",
          "group",
          "ungroup",
          "rotate",
          "flip",
          "z_order",
          "set_speaker_notes",
          "set_chart_data",
          "set_chart_type",
        ]),
      );
      expect(schema.properties.op.enum).not.toContain("set_background");
      expect(schema.properties.op.enum).not.toContain("set_table_cell");
      expect(schema.properties.op.enum).not.toContain("set_slide_layout");
      expect(schema.properties.op.enum).not.toContain("text_shadow");
      expect(schema.properties.op.enum).not.toContain("set_printable");
      expect(schema.properties.row.type).toContain("number");
      expect(schema.properties.column.type).toContain("number");
      expect(
        o.tools.find((tool) => tool.name === "native_edit")?.description,
      ).toContain("rowDescriptions (category labels)");
      expect(
        o.tools.find((tool) => tool.name === "native_edit")?.description,
      ).toContain("column/line/area/pie/scatter/radar");
    });
    await f.run();
  });

  it("observes paragraph ranges on a requested slide without changing the active slide", async () => {
    const f = fixture(async (o) => {
      const schema = o.tools.find((tool) => tool.name === "native_observe")
        ?.inputSchema as {
        required: string[];
        properties: { detailSlideIndex: { type: string[] } };
      };
      expect(schema.required).toEqual(["detailSlideIndex"]);
      expect(schema.properties.detailSlideIndex.type).toEqual([
        "number",
        "null",
      ]);
      expect(
        (
          await o.onTool(
            "native_observe",
            { detailSlideIndex: 4 },
            "1",
            f.signal,
          )
        ).success,
      ).toBe(true);
    });
    await f.run();
    expect(f.call).toHaveBeenCalledWith(
      { operation: "observe", detailSlideIndex: 4 },
      f.signal,
    );
  });

  it("publishes atomic batch editing and forwards dry-run without marking the turn changed", async () => {
    const f = fixture(async (o) => {
      expect(o.tools.map((tool) => tool.name)).toContain("native_batch_edit");
      await o.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "1",
        f.signal,
      );
      expect(
        (
          await o.onTool(
            "native_batch_edit",
            {
              commands: [
                { op: "move", elementId: "0/0", x: 100, y: 200 },
                { op: "resize", elementId: "0/0", width: 300, height: 400 },
              ],
              dryRun: true,
            },
            "2",
            f.signal,
          )
        ).success,
      ).toBe(true);
    });
    expect(await f.run()).toMatchObject({
      changed: false,
      status: "completed",
    });
    expect(f.call.mock.calls[1]?.[0]).toMatchObject({
      operation: "edit_batch",
      expectedRevision: "v2-test",
      dryRun: true,
      commands: [
        { op: "move", elementId: "0/0", x: 100, y: 200 },
        { op: "resize", elementId: "0/0", width: 300, height: 400 },
      ],
    });
  });

  it("marks an applied batch changed and rejects the whole batch before dispatch when one target is outside permission", async () => {
    const applied = fixture(async (o) => {
      await o.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "1",
        applied.signal,
      );
      expect(
        (
          await o.onTool(
            "native_batch_edit",
            {
              commands: [
                { op: "move", elementId: "0/0", x: 100, y: 200 },
                { op: "resize", elementId: "0/0", width: 300, height: 400 },
              ],
              dryRun: false,
            },
            "2",
            applied.signal,
          )
        ).success,
      ).toBe(true);
    });
    expect(await applied.run()).toMatchObject({
      changed: true,
      status: "needs_review",
    });

    const restricted = fixture(
      async (o) => {
        await o.onTool(
          "native_observe",
          { detailSlideIndex: null },
          "1",
          restricted.signal,
        );
        expect(
          (
            await o.onTool(
              "native_batch_edit",
              {
                commands: [
                  { op: "move", elementId: "0/0", x: 100, y: 200 },
                  { op: "move", elementId: "0/1", x: 300, y: 400 },
                ],
                dryRun: false,
              },
              "2",
              restricted.signal,
            )
          ).success,
        ).toBe(false);
      },
      { mode: "selection", elementIds: ["0/0"], slideIndexes: [] },
    );
    await restricted.run();
    expect(restricted.call).toHaveBeenCalledTimes(1);
  });

  it("rejects an identity-replacing chart edit before a later batch command can target the deleted native object", async () => {
    const f = fixture(async (o) => {
      await o.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "1",
        f.signal,
      );
      expect(
        (
          await o.onTool(
            "native_batch_edit",
            {
              commands: [
                {
                  op: "set_chart_data",
                  elementId: "0/0",
                  data: [[5.3]],
                },
                { op: "move", elementId: "0/0", x: 100, y: 200 },
              ],
              dryRun: false,
            },
            "2",
            f.signal,
          )
        ).success,
      ).toBe(false);
    });
    await f.run();
    expect(f.call).toHaveBeenCalledTimes(1);
  });

  it("requires observation and rejects executable or unknown tools", async () => {
    const f = fixture(async (o) => {
      expect(
        (await o.onTool("native_edit", { elementId: "0/0" }, "1", f.signal))
          .success,
      ).toBe(false);
      expect(
        (await o.onTool("eval", { code: "arbitrary()" }, "2", f.signal))
          .success,
      ).toBe(false);
    });
    await f.run();
    expect(f.call).not.toHaveBeenCalled();
  });
  it.each<NativePermission>([
    { mode: "read_only", elementIds: [], slideIndexes: [] },
    { mode: "selection", elementIds: ["0/1"], slideIndexes: [] },
    { mode: "slides", elementIds: [], slideIndexes: [1] },
  ])("enforces $mode before dispatch", async (scope) => {
    const f = fixture(async (o) => {
      await o.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "1",
        f.signal,
      );
      expect(
        (
          await o.onTool(
            "native_edit",
            { op: "replace_text", elementId: "0/0", text: "After" },
            "2",
            f.signal,
          )
        ).success,
      ).toBe(false);
    }, scope);
    await f.run();
    expect(f.call).toHaveBeenCalledTimes(1);
  });
  it("sends the exact observed revision and fresh image, and requires review", async () => {
    const f = fixture(async (o) => {
      const observed = await o.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "1",
        f.signal,
      );
      expect(observed.contentItems[1]).toMatchObject({ type: "inputImage" });
      await o.onTool(
        "native_edit",
        { op: "replace_text", elementId: "0/0", text: "After" },
        "2",
        f.signal,
      );
    });
    expect(await f.run()).toMatchObject({
      changed: true,
      reviewed: false,
      status: "needs_review",
    });
    expect(f.call.mock.calls[1]?.[0]).toMatchObject({
      operation: "edit",
      expectedSlides: JSON.stringify(state.slides),
      permission,
    });
  });
  it("allows creation in an authorized slide and multi-object edits in an authorized selection", async () => {
    const scope: NativePermission = {
      mode: "selection",
      elementIds: ["0/0", "0/1"],
      slideIndexes: [],
    };
    const f = fixture(async (o) => {
      await o.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "1",
        f.signal,
      );
      expect(
        (
          await o.onTool(
            "native_edit",
            {
              op: "align",
              elementIds: ["0/0", "0/1"],
              alignment: "left",
            },
            "2",
            f.signal,
          )
        ).success,
      ).toBe(true);
    }, scope);
    await f.run();
    expect(f.call).toHaveBeenCalledTimes(2);

    const slideScope: NativePermission = {
      mode: "slides",
      elementIds: [],
      slideIndexes: [0],
    };
    const create = fixture(async (o) => {
      await o.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "1",
        create.signal,
      );
      expect(
        (
          await o.onTool(
            "native_edit",
            {
              op: "add_table",
              slideIndex: 0,
              x: 100,
              y: 100,
              width: 1000,
              height: 500,
              cells: [
                ["항목", "값"],
                ["A", "1"],
              ],
            },
            "2",
            create.signal,
          )
        ).success,
      ).toBe(true);
    }, slideScope);
    await create.run();
    expect(create.call).toHaveBeenCalledTimes(2);
  });
  it("invalidates review after another edit", async () => {
    const f = fixture(async (o) => {
      await o.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "1",
        f.signal,
      );
      await o.onTool(
        "native_edit",
        { op: "replace_text", elementId: "0/0", text: "After" },
        "2",
        f.signal,
      );
      await o.onTool(
        "native_review",
        { approved: true, problems: [], reviewedSlideIndexes: [0] },
        "3",
        f.signal,
      );
      await o.onTool(
        "native_edit",
        { op: "move", elementId: "0/0", x: 100, y: 100 },
        "4",
        f.signal,
      );
    });
    expect(await f.run()).toMatchObject({
      reviewed: false,
      status: "needs_review",
    });
  });
  it("requires explicit review coverage for every changed slide", async () => {
    const f = fixture(async (o) => {
      await o.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "1",
        f.signal,
      );
      await o.onTool(
        "native_edit",
        { op: "replace_text", elementId: "0/0", text: "After" },
        "2",
        f.signal,
      );
      expect(
        (
          await o.onTool(
            "native_review",
            { approved: true, problems: [], reviewedSlideIndexes: [] },
            "3",
            f.signal,
          )
        ).success,
      ).toBe(false);
      expect(
        (
          await o.onTool(
            "native_review",
            { approved: true, problems: [], reviewedSlideIndexes: [0] },
            "4",
            f.signal,
          )
        ).success,
      ).toBe(true);
    });

    expect(await f.run()).toMatchObject({
      changed: true,
      reviewed: true,
      status: "completed",
    });
  });
  it("cannot approve a mutation with a newly introduced layout issue", async () => {
    const issueState: NativeObservation = {
      ...structuredClone(changedState),
      layoutAudit: {
        issueCount: 1,
        issues: [{ code: "overlap", slideIndex: 0 }],
        introducedIssueCount: 1,
        introducedIssues: [{ code: "overlap", slideIndex: 0 }],
      },
    };
    const f = fixture(
      async (o) => {
        await o.onTool(
          "native_observe",
          { detailSlideIndex: null },
          "1",
          f.signal,
        );
        await o.onTool(
          "native_edit",
          { op: "move", elementId: "0/0", x: 100, y: 100 },
          "2",
          f.signal,
        );
        expect(
          (
            await o.onTool(
              "native_review",
              { approved: true, problems: [], reviewedSlideIndexes: [0] },
              "3",
              f.signal,
            )
          ).success,
        ).toBe(false);
      },
      permission,
      issueState,
    );

    expect(await f.run()).toMatchObject({
      changed: true,
      reviewed: false,
      status: "needs_review",
    });
  });
  it("does not accept a mutation result without complete fresh screenshots", async () => {
    const incompleteState: NativeObservation = {
      ...structuredClone(changedState),
      images: [],
      visualEvidenceComplete: false,
    };
    const f = fixture(
      async (o) => {
        await o.onTool(
          "native_observe",
          { detailSlideIndex: null },
          "1",
          f.signal,
        );
        expect(
          (
            await o.onTool(
              "native_edit",
              { op: "move", elementId: "0/0", x: 100, y: 100 },
              "2",
              f.signal,
            )
          ).success,
        ).toBe(false);
      },
      permission,
      incompleteState,
    );

    expect(await f.run()).toMatchObject({ changed: false, reviewed: false });
  });
  it("does not claim success when the live engine rejects stale state", async () => {
    const f = fixture(async (o) => {
      await o.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "1",
        f.signal,
      );
      f.call.mockRejectedValueOnce(new Error("document_changed_observe_again"));
      expect(
        (
          await o.onTool(
            "native_edit",
            { op: "move", elementId: "0/0", x: 100, y: 100 },
            "2",
            f.signal,
          )
        ).success,
      ).toBe(false);
      const retry = await o.onTool(
        "native_edit",
        { op: "move", elementId: "0/0", x: 100, y: 100 },
        "3",
        f.signal,
      );
      expect(retry.success).toBe(false);
      expect(f.call).toHaveBeenCalledTimes(2);
    });
    expect(await f.run()).toMatchObject({ changed: false, reviewed: false });
  });

  it("stores a generated image, inserts it as a native object, then starts a visual review turn", async () => {
    const inserted: NativeObservation = {
      ...structuredClone(state),
      slides: [
        {
          ...structuredClone(state.slides[0]),
          elements: [
            ...structuredClone(state.slides[0].elements),
            {
              elementId: "0/2",
              kind: "com.sun.star.drawing.GraphicObjectShape",
            },
          ],
        },
      ],
      revision: "v2-image",
      changedSlideIndexes: [0],
      visualEvidenceComplete: true,
    };
    let imageInserted = false;
    const call = vi.fn(
      async (request: Record<string, unknown>, _signal: AbortSignal) => {
        if (request.operation === "insert_image") imageInserted = true;
        return structuredClone(imageInserted ? inserted : state);
      },
    );
    const createImage = vi.fn(async () => ({
      assetId: "38c76733-fbed-40cc-98b0-5237aaec6387",
    }));
    let invocation = 0;
    const client = {
      runStructuredTurn: async (
        _a: unknown,
        _b: unknown,
        _c: unknown,
        options: AgentTurnOptions,
      ) => {
        invocation += 1;
        if (invocation === 1) {
          expect(options.allowImageGeneration).toBe(true);
          await options.onTool(
            "native_observe",
            { detailSlideIndex: null },
            "observe",
            signal,
          );
          await options.onGeneratedImage?.({
            bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            mediaType: "image/png",
          });
          return "이미지를 생성했습니다.";
        }
        expect(options.allowImageGeneration).toBe(false);
        await options.onTool(
          "native_observe",
          { detailSlideIndex: null },
          "review-observe",
          signal,
        );
        await options.onTool(
          "native_review",
          { approved: true, problems: [], reviewedSlideIndexes: [0] },
          "review",
          signal,
        );
        return "삽입된 이미지를 확인했습니다.";
      },
    } as unknown as AppServerClient;
    const signal = new AbortController().signal;
    const result = await runNativeTurn(client, {
      requestText: "이 슬라이드에 추상 이미지를 만들어 넣어줘",
      host: { call, createImage },
      signal,
      permission,
      onText: vi.fn(),
      onTool: vi.fn(),
    });

    expect(result).toMatchObject({
      text: "삽입된 이미지를 확인했습니다.",
      changed: true,
      reviewed: true,
      status: "completed",
    });
    expect(createImage).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      {
        operation: "insert_image",
        assetId: "38c76733-fbed-40cc-98b0-5237aaec6387",
        slideIndex: 0,
        expectedRevision: "v2-test",
        expectedSlides: JSON.stringify(state.slides),
        permission,
      },
      signal,
    );
  });

  it("does not insert a generated image outside the granted slide", async () => {
    const createImage = vi.fn(async () => ({ assetId: "unused" }));
    const restricted: NativePermission = {
      mode: "slides",
      elementIds: [],
      slideIndexes: [1],
    };
    const f = fixture(async (options) => {
      await options.onTool(
        "native_observe",
        { detailSlideIndex: null },
        "observe",
        f.signal,
      );
      await expect(
        options.onGeneratedImage?.({
          bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          mediaType: "image/png",
        }),
      ).rejects.toThrow("허용된 슬라이드 밖입니다");
    }, restricted);
    await runNativeTurn(
      {
        runStructuredTurn: async (
          _a: unknown,
          _b: unknown,
          _c: unknown,
          options: AgentTurnOptions,
        ) => {
          await options.onTool(
            "native_observe",
            { detailSlideIndex: null },
            "observe",
            f.signal,
          );
          await expect(
            options.onGeneratedImage?.({
              bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
              mediaType: "image/png",
            }),
          ).rejects.toThrow("허용된 슬라이드 밖입니다");
          return "삽입하지 않았습니다.";
        },
      } as unknown as AppServerClient,
      {
        requestText: "이미지를 넣어줘",
        host: { call: f.call, createImage },
        signal: f.signal,
        permission: restricted,
        onText: vi.fn(),
        onTool: vi.fn(),
      },
    );
    expect(createImage).not.toHaveBeenCalled();
    expect(f.call).toHaveBeenCalledTimes(1);
  });
});
