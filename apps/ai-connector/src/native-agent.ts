import type {
  AppServerClient,
  GeneratedImage,
  ToolResult,
} from "./app-server-client.js";
import type { ModelSettings } from "../../../contracts/ai-models.js";
import {
  nativeCreateOperations,
  nativeEditContract,
  nativeElementOperations,
  nativeMultiElementOperations,
  nativeSlideOperations,
} from "./native-edit-contract.js";

export interface NativeObservation {
  unit: string;
  slides: Array<{
    slideIndex: number;
    elements: Array<{ elementId: string; [key: string]: unknown }>;
    [key: string]: unknown;
  }>;
  activeSlide: number;
  selectedElementIds: string[];
  images: Array<{ slideIndex: number; pngBytes: number[] }>;
}
export interface NativePermission {
  mode: "read_only" | "selection" | "slides" | "document";
  slideIndexes: number[];
  elementIds: string[];
}
export interface NativeHost {
  call(
    request: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<NativeObservation>;
  createImage?(
    image: GeneratedImage,
    signal: AbortSignal,
  ): Promise<{ assetId: string }>;
}

// The same subscription client used by the current product; only the document
// tool transport changes from offline PPTX patch jobs to the open editor session.
export async function runNativeTurn(
  client: AppServerClient,
  input: {
    requestText: string;
    modelSettings?: ModelSettings;
    permission: NativePermission;
    conversationKey?: string;
    host: NativeHost;
    signal: AbortSignal;
    onText: (delta: string) => void;
    onTool: (label: string) => void;
  },
) {
  let observed: NativeObservation | undefined;
  let changed = false,
    reviewed = false;
  let toolTail: Promise<unknown> = Promise.resolve();
  const empty = {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  };
  const content = (state: NativeObservation): ToolResult => ({
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          ...state,
          images: undefined,
          permission: input.permission,
        }),
      },
      ...state.images.map((image) => ({
        type: "inputImage" as const,
        imageUrl: `data:image/png;base64,${Buffer.from(image.pngBytes.map((x) => x & 255)).toString("base64")}`,
      })),
    ],
  });
  let generatedImageInserted = false;
  const turn = (
    prompt: string,
    allowImageGeneration: boolean,
    timeout = 240000,
  ) =>
    client.runStructuredTurn(
      [
        {
          type: "text",
          text: [
            "You are editing the SAME open PowerPoint document as the user. Always observe first. Human edits may happen between calls: a stale-state error requires observing again, never replaying an edit blindly.",
            "Observe returns live element structure and slide screenshots. Use native_edit only for explicit edit requests and only within returned permission. It applies through the editor native undo stack, visible to the user. Inspect the fresh screenshot after edits and call native_review. Do not claim an edit happened without a successful tool result. Unsupported operations must be stated honestly.",
            "Coordinates are 1/100 mm. IDs refer to the last observed snapshot. Do not change original text or geometry merely to hide font/rendering differences. Answer in Korean.",
            prompt,
          ].join("\n"),
        },
      ],
      {},
      timeout,
      {
        modelSettings: input.modelSettings,
        signal: input.signal,
        conversationKey: input.conversationKey,
        tools: [
          {
            type: "function",
            name: "native_observe",
            description:
              "Read the open document and its current slide image, including unsaved human edits.",
            inputSchema: empty,
          },
          {
            type: "function",
            name: "native_edit",
            description:
              "Change an observed object or slide in the SAME open editor with native undo. Supports text and paragraph formatting, geometry, line/fill, rotation/flip/stacking, align/distribute/group, object duplication/deletion, new text boxes/basic shapes/tables, and slide insertion/duplication/deletion. New tables accept their initial cell matrix. Existing table-cell text and slide background are intentionally excluded because this editor engine does not record those API changes in native undo. Observe after stale state. Do not send executable code.",
            inputSchema: nativeEditContract.toolInputSchema,
          },
          {
            type: "function",
            name: "native_review",
            description:
              "Record a visual review of the latest changed slide. This is not user approval.",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                approved: { type: "boolean" },
                problems: { type: "array", items: { type: "string" } },
              },
              required: ["approved", "problems"],
            },
          },
        ],
        onEvent: (event) => {
          const value = event.params as { delta?: string } | undefined;
          if (
            event.method === "item/agentMessage/delta" &&
            typeof value?.delta === "string"
          )
            input.onText(value.delta);
        },
        allowImageGeneration,
        onGeneratedImage: allowImageGeneration
          ? async (image) => {
              const work = toolTail.then(async () => {
                if (
                  !["slides", "document"].includes(input.permission.mode) ||
                  !input.host.createImage
                )
                  throw new Error(
                    "이미지 생성에는 현재 슬라이드 또는 프레젠테이션 전체 권한이 필요합니다.",
                  );
                if (!observed)
                  throw new Error(
                    "이미지를 만들기 전에 슬라이드를 확인해야 합니다.",
                  );
                if (generatedImageInserted)
                  throw new Error(
                    "한 요청에서는 생성 이미지 한 장만 삽입할 수 있습니다.",
                  );
                input.onTool("이미지 생성 결과 저장");
                const asset = await input.host.createImage(image, input.signal);
                const beforeCount = observed.slides.reduce(
                  (total, slide) => total + slide.elements.length,
                  0,
                );
                input.onTool("생성 이미지 삽입");
                observed = await input.host.call(
                  { operation: "insert_image", assetId: asset.assetId },
                  input.signal,
                );
                const afterCount = observed.slides.reduce(
                  (total, slide) => total + slide.elements.length,
                  0,
                );
                if (afterCount <= beforeCount)
                  throw new Error("generated_image_was_not_inserted");
                generatedImageInserted = true;
                changed = true;
                reviewed = false;
              });
              toolTail = work.catch(() => undefined);
              await work;
            }
          : undefined,
        onTool: (name, args, _id, signal) => {
          const work = toolTail.then(async (): Promise<ToolResult> => {
            if (name === "native_observe") {
              input.onTool("현재 슬라이드 확인");
              observed = await input.host.call(
                { operation: "observe" },
                signal,
              );
              return content(observed);
            }
            if (name === "native_edit") {
              if (!observed) throw new Error("Observe before editing.");
              if (input.permission.mode === "read_only")
                throw new Error("읽기 전용 권한입니다.");
              const command = args as {
                elementId?: string | null;
                elementIds?: string[] | null;
                slideIndex?: number | null;
                op?: string;
              };
              const operation = command.op ?? "";
              if (
                !nativeSlideOperations.has(operation) &&
                !nativeCreateOperations.has(operation) &&
                !nativeMultiElementOperations.has(operation) &&
                !nativeElementOperations.has(operation)
              )
                throw new Error("Unsupported native edit operation.");
              const slideOperation = nativeSlideOperations.has(operation);
              const createOperation = nativeCreateOperations.has(operation);
              const multiElementOperation =
                nativeMultiElementOperations.has(operation);
              let slideIndex: number;
              if (slideOperation) {
                if (
                  !Number.isInteger(command.slideIndex) ||
                  !observed.slides.some(
                    (slide) => slide.slideIndex === command.slideIndex,
                  )
                )
                  throw new Error("Slide target not present in observation.");
                slideIndex = command.slideIndex as number;
                if (
                  input.permission.mode === "selection" ||
                  (command.op === "insert_slide" &&
                    input.permission.mode !== "document") ||
                  (input.permission.mode === "slides" &&
                    !input.permission.slideIndexes.includes(slideIndex))
                )
                  throw new Error("허용된 슬라이드 범위 밖입니다.");
              } else if (createOperation) {
                if (
                  !Number.isInteger(command.slideIndex) ||
                  !observed.slides.some(
                    (slide) => slide.slideIndex === command.slideIndex,
                  )
                )
                  throw new Error("Slide target not present in observation.");
                slideIndex = command.slideIndex as number;
                if (
                  input.permission.mode === "selection" ||
                  (input.permission.mode === "slides" &&
                    !input.permission.slideIndexes.includes(slideIndex))
                )
                  throw new Error("허용된 슬라이드 범위 밖입니다.");
              } else if (multiElementOperation) {
                if (
                  !Array.isArray(command.elementIds) ||
                  command.elementIds.length < 2
                )
                  throw new Error(
                    "Element targets not present in observation.",
                  );
                const targets = command.elementIds.map((elementId) => {
                  const slide = observed?.slides.find((candidate) =>
                    candidate.elements.some(
                      (element) => element.elementId === elementId,
                    ),
                  );
                  return slide
                    ? { elementId, slideIndex: slide.slideIndex }
                    : null;
                });
                if (
                  targets.some((target) => !target) ||
                  new Set(targets.map((target) => target?.slideIndex)).size !==
                    1
                )
                  throw new Error("Element targets not present in one slide.");
                slideIndex = targets[0]!.slideIndex;
                if (
                  input.permission.mode === "selection" &&
                  command.elementIds.some(
                    (elementId) =>
                      !input.permission.elementIds.includes(elementId),
                  )
                )
                  throw new Error("선택 범위 밖입니다.");
                if (
                  input.permission.mode === "slides" &&
                  !input.permission.slideIndexes.includes(slideIndex)
                )
                  throw new Error("허용된 슬라이드 밖입니다.");
              } else {
                if (
                  !command.elementId ||
                  !observed.slides.some((slide) =>
                    slide.elements.some(
                      (element) => element.elementId === command.elementId,
                    ),
                  )
                )
                  throw new Error("Target not present in observation.");
                slideIndex = Number(command.elementId.split("/")[0]);
                if (
                  input.permission.mode === "selection" &&
                  !input.permission.elementIds.includes(command.elementId)
                )
                  throw new Error("선택 범위 밖입니다.");
                if (
                  input.permission.mode === "slides" &&
                  !input.permission.slideIndexes.includes(slideIndex)
                )
                  throw new Error("허용된 슬라이드 밖입니다.");
              }
              input.onTool("슬라이드 수정");
              const expectedSlides = JSON.stringify(observed.slides);
              // A failed/expired response may conceal a concurrent or already-applied
              // edit. Require another observation instead of replaying stale targets.
              observed = undefined;
              observed = await input.host.call(
                {
                  operation: "edit",
                  expectedSlides,
                  command,
                  permission: input.permission,
                },
                signal,
              );
              changed = true;
              reviewed = false;
              return content(observed);
            }
            if (name === "native_review") {
              if (!changed || !observed)
                throw new Error("No changed slide to review.");
              const result = args as {
                approved?: boolean;
                problems?: unknown[];
              };
              if (
                typeof result.approved !== "boolean" ||
                !Array.isArray(result.problems) ||
                result.problems.some((p) => typeof p !== "string")
              )
                throw new Error("Invalid review.");
              reviewed = result.approved && result.problems.length === 0;
              input.onTool(
                reviewed ? "수정 화면 확인 완료" : "수정 화면 재검토 필요",
              );
              return {
                success: true,
                contentItems: [
                  { type: "inputText", text: JSON.stringify(result) },
                ],
              };
            }
            throw new Error("Unknown tool.");
          });
          toolTail = work.catch(() => undefined);
          return work.catch((error) => ({
            success: false,
            contentItems: [
              {
                type: "inputText",
                text:
                  error instanceof Error
                    ? error.message
                    : "Document operation failed.",
              },
            ],
          }));
        },
      },
    );
  let text = await turn(
    `User request: ${input.requestText}`,
    ["slides", "document"].includes(input.permission.mode),
  );
  if (generatedImageInserted && !reviewed) {
    const review = await turn(
      "The requested generated image is now an editable picture object in the open presentation. Observe the fresh slide, correct its position or size if needed, then call native_review. Do not generate another image.",
      false,
      180000,
    );
    if (review.trim()) text = review;
  }
  return {
    text,
    changed,
    reviewed,
    status: changed && !reviewed ? "needs_review" : "completed",
  };
}
