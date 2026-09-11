import { describe, expect, it, vi } from "vitest";
import type { AgentTurnOptions, AppServerClient } from "./app-server-client.js";
import {
  runNativeTurn,
  type NativeObservation,
  type NativePermission,
} from "./native-agent.js";

const state: NativeObservation = {
  unit: "1/100mm",
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
  images: [{ slideIndex: 0, pngBytes: [137, 80, 78, 71] }],
};
const permission: NativePermission = {
  mode: "document",
  elementIds: [],
  slideIndexes: [],
};
function fixture(
  work: (options: AgentTurnOptions) => Promise<void>,
  scope = permission,
) {
  const call = vi.fn(
    async (_request: Record<string, unknown>, _signal: AbortSignal) =>
      structuredClone(state),
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
  it("publishes every verified native operation from the shared contract", async () => {
    const f = fixture(async (o) => {
      const schema = o.tools.find((tool) => tool.name === "native_edit")
        ?.inputSchema as {
        properties: { op: { enum: string[] } };
      };
      expect(schema.properties.op.enum).toHaveLength(28);
      expect(schema.properties.op.enum).toEqual(
        expect.arrayContaining([
          "add_text_box",
          "add_shape",
          "add_table",
          "align",
          "distribute",
          "group",
          "ungroup",
          "rotate",
          "flip",
          "z_order",
        ]),
      );
      expect(schema.properties.op.enum).not.toContain("set_background");
      expect(schema.properties.op.enum).not.toContain("set_table_cell");
    });
    await f.run();
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
      await o.onTool("native_observe", {}, "1", f.signal);
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
      const observed = await o.onTool("native_observe", {}, "1", f.signal);
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
      await o.onTool("native_observe", {}, "1", f.signal);
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
      await o.onTool("native_observe", {}, "1", create.signal);
      expect(
        (
          await o.onTool(
            "native_edit",
            {
              op: "add_text_box",
              slideIndex: 0,
              text: "새 상자",
              x: 100,
              y: 100,
              width: 1000,
              height: 500,
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
      await o.onTool("native_observe", {}, "1", f.signal);
      await o.onTool(
        "native_edit",
        { op: "replace_text", elementId: "0/0", text: "After" },
        "2",
        f.signal,
      );
      await o.onTool(
        "native_review",
        { approved: true, problems: [] },
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
  it("does not claim success when the live engine rejects stale state", async () => {
    const f = fixture(async (o) => {
      await o.onTool("native_observe", {}, "1", f.signal);
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
    };
    const call = vi.fn(
      async (request: Record<string, unknown>, _signal: AbortSignal) =>
        request.operation === "insert_image"
          ? structuredClone(inserted)
          : structuredClone(state),
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
          await options.onTool("native_observe", {}, "observe", signal);
          await options.onGeneratedImage?.({
            bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            mediaType: "image/png",
          });
          return "이미지를 생성했습니다.";
        }
        expect(options.allowImageGeneration).toBe(false);
        await options.onTool("native_observe", {}, "review-observe", signal);
        await options.onTool(
          "native_review",
          { approved: true, problems: [] },
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
      },
      signal,
    );
  });
});
