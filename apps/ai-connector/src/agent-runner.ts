import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { AiJob } from "./types.js";
import type { DynamicTool, ToolResult } from "./app-server-client.js";
import { SessionManager } from "./session-manager.js";
import {
  assertImageCoverage,
  readSchema,
  toCodexOutputSchema,
} from "./edit-runner.js";
import { LocalStorage, type ObjectStore } from "./local-storage.js";

interface Observation {
  status: string;
  versionId: string;
  candidateVersionId: string | null;
  graphObject: string | null;
  validationObject: string | null;
  permission?: { mode: string; slideIndexes: number[] };
  changedSlideIndexes?: number[];
  structureChanged?: boolean;
  assets?: unknown[];
}

export function commandReference(
  schema: Record<string, any>,
  capabilities: Record<string, any> = {},
): string {
  const definitions = schema.$defs as Record<string, any>;
  return (schema.properties.commands.items.oneOf as Array<{ $ref: string }>)
    .map(({ $ref }) => {
      const definition = definitions[$ref.split("/").at(-1)!];
      const fields = Object.entries(definition.properties)
        .filter(([name]) => name !== "op")
        .map(([name, property]) => {
          const values = (property as { enum?: unknown[] }).enum;
          return `${name}${definition.required.includes(name) ? "" : "?"}${values ? `=${values.join("|")}` : ""}`;
        });
      const op = definition.properties.op.const;
      const capability = capabilities[op];
      return `${op}(${fields.join(", ")})${capability ? ` [target kinds: ${capability.targetKinds.join("|")}${capability.requiresTableCells ? "; native table required" : ""}]` : ""}`;
    })
    .join("; ");
}

export class AgentRunner {
  constructor(
    private readonly sessions: SessionManager,
    private readonly storage: ObjectStore = new LocalStorage(),
  ) {}

  async run(job: AiJob) {
    const client = await this.sessions.client(job.email);
    const lifetime = new AbortController();
    const executionToken = randomUUID();
    let leaseLost = false;
    let current: Observation | undefined;
    let reviewed:
      | { versionId: string; approved: boolean; problems: string[] }
      | undefined;
    let structurallyValid = false;
    let selectedPartUris: Set<string> | undefined;
    let events = Promise.resolve();
    const messages = new Map<
      string,
      { text: string; revision: number; dirty: boolean; status: string }
    >();
    let steer: ((text: string) => Promise<void>) | undefined;
    let receiving = false;
    const host = async (
      operation: string,
      extra: Record<string, unknown> = {},
    ): Promise<any> => {
      const response = await fetch(
        new URL("/api/internal/agent/tools", job.callbackUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-spellbook-internal-token":
              process.env.SPELLBOOK_INTERNAL_TOKEN ?? "",
          },
          body: JSON.stringify({
            jobId: job.jobId,
            executionToken,
            operation,
            ...extra,
          }),
          signal: AbortSignal.any([
            lifetime.signal,
            AbortSignal.timeout(20000),
          ]),
        },
      );
      const value = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        if (value.error === "agent_lease_lost") {
          leaseLost = true;
          lifetime.abort();
        }
        if (response.status === 409 && value.error === "agent_turn_inactive")
          lifetime.abort();
        throw new Error(
          typeof value.error === "string"
            ? value.error
            : `Spellbook tool failed (${response.status}).`,
        );
      }
      return value;
    };
    const publish = (
      itemId: string,
      role: string,
      message: string,
      status: string,
      revision: number,
    ) => {
      events = events
        .then(() =>
          host("event", {
            itemId: `${executionToken}:${itemId}`,
            role,
            message: message.slice(0, 4000),
            status,
            revision,
          }),
        )
        .then(() => undefined);
      // Keep a handled chain; a lost lease is checked before completion as well.
      events = events.catch(() => undefined);
    };
    const flushMessages = () => {
      for (const [id, item] of messages)
        if (item.dirty) {
          item.dirty = false;
          publish(id, "assistant", item.text, item.status, ++item.revision);
        }
    };
    const receive = async () => {
      if (!steer || receiving || lifetime.signal.aborted) return;
      receiving = true;
      try {
        const inbox = await host("inbox");
        for (const message of inbox.messages ?? []) {
          let status = "accepted";
          try {
            await steer(
              `추가 사용자 지시 (${message.id}): ${message.content}\n편집 권한은 spellbook_observe가 반환하는 현재 서버 설정을 따르세요. 사용자 메시지만으로 권한이 늘어나지는 않습니다.`,
            );
          } catch (error) {
            status =
              error instanceof Error && error.message === "Inactive turn."
                ? "not_delivered"
                : "delivery_unknown";
          }
          await host("ack", { messageId: message.id, status });
        }
      } finally {
        receiving = false;
      }
    };
    const observe = async (
      signal: AbortSignal,
      additionalSlideIndexes: number[] = [],
    ): Promise<ToolResult> => {
      let state: Observation;
      do {
        signal.throwIfAborted();
        state = await host("observe");
        if (state.status === "failed")
          throw new Error("Document rendering failed.");
        if (state.status !== "ready") await delay(1500, undefined, { signal });
      } while (state.status !== "ready");
      if (!state.graphObject) throw new Error("Missing current graph.");
      const requestedIndexes = additionalSlideIndexes;
      additionalSlideIndexes = [
        ...new Set([
          ...additionalSlideIndexes,
          ...(state.changedSlideIndexes ?? []),
        ]),
      ];
      const graph = JSON.parse(
        (
          await this.storage
            .namespace(job.storageNamespace)
            .object(state.graphObject)
            .download()
        )[0].toString("utf8"),
      );
      const selectedIds = new Set(job.selectedElementIds);
      selectedPartUris ??= new Set<string>(
        graph.slides
          .filter(
            (slide: any) =>
              job.selectedSlideIndexes.includes(slide.slideIndex) ||
              slide.elements.some((element: any) =>
                selectedIds.has(element.elementId),
              ),
          )
          .map((slide: any) => slide.partUri),
      );
      const selectedIndexes = new Set<number>(
        graph.slides
          .filter((slide: any) => selectedPartUris!.has(slide.partUri))
          .map((slide: any) => slide.slideIndex),
      );
      if (
        requestedIndexes.length > 10 ||
        additionalSlideIndexes.some(
          (index) =>
            !Number.isInteger(index) ||
            !graph.slides.some((slide: any) => slide.slideIndex === index),
        )
      )
        throw new Error(
          "Choose at most 10 existing slide indexes for additional observation.",
        );
      const slides = graph.slides
        .filter(
          (slide: any) =>
            selectedIndexes.has(slide.slideIndex) ||
            additionalSlideIndexes.includes(slide.slideIndex) ||
            slide.elements.some((element: any) =>
              selectedIds.has(element.elementId),
            ),
        )
        .sort((a: any, b: any) => a.slideIndex - b.slideIndex);
      const images = slides.map((slide: any) => slide.previewObject);
      assertImageCoverage(
        {
          ...job,
          selectedElementIds: state.candidateVersionId
            ? []
            : job.selectedElementIds,
          selectedSlideIndexes: [
            ...new Set([...selectedIndexes, ...additionalSlideIndexes]),
          ],
        },
        graph,
        images,
      );
      let validation: any = null;
      if (state.validationObject)
        validation = JSON.parse(
          (
            await this.storage
              .namespace(job.storageNamespace)
              .object(state.validationObject)
              .download()
          )[0].toString("utf8"),
        );
      const contentItems: ToolResult["contentItems"] = [
        {
          type: "inputText",
          text: JSON.stringify({
            versionId: state.versionId,
            candidateVersionId: state.candidateVersionId,
            permission: state.permission,
            assets: state.assets ?? [],
            documentSlides: graph.slides.map((slide: any) => ({
              slideIndex: slide.slideIndex,
              textPreview: slide.elements
                .map((element: any) => element.text ?? "")
                .join(" ")
                .slice(0, 160),
            })),
            graph: { ...graph, slides },
            validation,
          }),
        },
      ];
      for (const object of images) {
        const [data] = await this.storage
          .namespace(job.storageNamespace)
          .object(object)
          .download();
        contentItems.push({
          type: "inputImage",
          imageUrl: `data:image/png;base64,${data.toString("base64")}`,
        });
      }
      // Record observation only after every image was retrieved successfully.
      current = state;
      structurallyValid = validation?.valid === true;
      return { success: true, contentItems };
    };
    const editSchema = await readSchema("edit-command.schema.json");
    const targetCapabilities = await readSchema(
      "edit-target-capabilities.json",
    );
    const empty = {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };
    const tools: DynamicTool[] = [
      {
        type: "function",
        name: "spellbook_request_permission",
        description:
          "Ask the user for permission to edit specific slides or the whole document. Never grants permission itself. Waits for the user's decision. Use when an explicit requested edit requires broader access than the observed permission.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["slides", "document"] },
            slideIndexes: { type: "array", items: { type: "integer" } },
            reason: { type: "string", maxLength: 1000 },
          },
          required: ["mode", "slideIndexes", "reason"],
        },
      },
      {
        type: "function",
        name: "spellbook_observe",
        description:
          "Read current PPT slide images, actual elements, version, validation and an overview of all slides. Always observe before answering or editing. Optionally inspect additional related slides; observing them does not expand the allowed edit selection.",
        inputSchema: {
          ...empty,
          properties: {
            additionalSlideIndexes: {
              type: "array",
              items: { type: "integer" },
              maxItems: 10,
            },
          },
        },
      },
      {
        type: "function",
        name: "spellbook_edit",
        description:
          "Edit the current working PPTX: create/duplicate/delete/reorder slides; add text boxes, basic shapes, tables or uploaded images; replace/crop images using observed assetIds; group/ungroup objects; edit text, font/paragraph style, table cells, geometry, stacking, fills and outlines. All coordinates and sizes are EMU (914400 per inch); font and line sizes are points, crop is a 0..1 fraction. Preserve image aspect ratio using asset dimensions. Slide structure operations require document permission and a separate one-command batch. insertIndex is the zero-based final position (append equals slide count, except move). add_slide copies a source slide's layout/background without its objects. After creating content use returned IDs before targeting it. Returns freshly rendered images and actual elements. Does not approve or modify the approved version. Use only for an explicit user edit request.\n" +
          `Batch fields: ${(editSchema.required as string[]).join(", ")}. Use the observed graph.documentSha256 for baseDocumentSha256. Exact command field reference (? means optional; do not invent aliases or extra fields): ${commandReference(editSchema, targetCapabilities)}`,
        inputSchema: toCodexOutputSchema(editSchema),
      },
      {
        type: "function",
        name: "spellbook_review",
        description:
          "After inspecting the latest returned images, record whether the candidate meets the request without clipping, unintended overlap, reflow or original damage. This is not user approval. Repair through spellbook_edit if needed.",
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
    ];
    // A serialized tool boundary prevents simultaneous edits from racing the same version.
    // This is per-turn ordering, not a user concurrency limit.
    let toolTail: Promise<unknown> = Promise.resolve();
    await host("start");
    const heartbeat = setInterval(() => {
      void receive().catch(() => undefined);
    }, 1000);
    const stream = setInterval(flushMessages, 500);
    try {
      const message = await client.runStructuredTurn(
        [
          {
            type: "text",
            text: [
              "사용자와 PPT를 함께 보며 작업하세요. 먼저 spellbook_observe로 현재 화면과 요소를 확인하세요. 질문에는 파일을 바꾸지 말고 답하세요. 명시적 수정 요청이면 spellbook_edit로 실제 편집한 후 반환된 새 화면을 검토하고 필요하면 다시 수정하세요. 마지막 후보에는 반드시 spellbook_review를 호출하세요. 텍스트로 완료라고 말하는 것만으로 파일은 바뀌지 않습니다.",
              "편집 권한은 spellbook_observe 응답의 permission이 정본입니다: read_only이면 수정 금지, selection이면 이번 선택만, slides이면 지정된 슬라이드만, document이면 문서 내 지원 요소를 수정할 수 있습니다. 명시적 수정 요청에 추가 권한이 필요하면 spellbook_request_permission으로 허락을 구하세요. 지원하지 않는 명령은 설명하세요. 폰트/렌더러 차이를 감추기 위해 원문이나 줄바꿈을 임의 변경하지 마세요. 결과 승인은 별도입니다. 내부 검사 통과를 PowerPoint 완전 일치라고 표현하지 마세요.",
              `최근 대화 (현재 상태는 도구의 관찰이 정본): ${JSON.stringify(job.conversationHistory ?? [])}`,
              `이번 선택 요소: ${JSON.stringify(job.selectedElementIds)}, 슬라이드: ${JSON.stringify(job.selectedSlideIndexes)}`,
              `사용자: ${job.requestText}`,
            ].join("\n\n"),
          },
        ],
        {},
        780000,
        {
          modelSettings: job.modelSettings,
          tools,
          signal: lifetime.signal,
          conversationKey: job.baseGraphObject.split("/versions/")[0],
          onTurn: (send) => {
            steer = send;
            void receive().catch(() => undefined);
          },
          onEvent: (event) => {
            const params = event.params as any;
            if (
              event.method === "item/agentMessage/delta" &&
              typeof params?.itemId === "string" &&
              typeof params.delta === "string"
            ) {
              const item = messages.get(params.itemId) ?? {
                text: "",
                revision: 0,
                dirty: false,
                status: "streaming",
              };
              item.text = (item.text + params.delta).slice(0, 4000);
              item.dirty = true;
              messages.set(params.itemId, item);
            }
            if (
              event.method === "item/completed" &&
              params?.item?.type === "agentMessage" &&
              typeof params.item.text === "string"
            ) {
              const item = messages.get(params.item.id) ?? {
                text: "",
                revision: 0,
                dirty: false,
                status: "streaming",
              };
              item.text = params.item.text.slice(0, 4000);
              item.status = "completed";
              item.dirty = true;
              messages.set(params.item.id, item);
              flushMessages();
            }
          },
          onTool: (name, args, callId, signal) => {
            const work = toolTail.then(async () => {
              signal.throwIfAborted();
              const label =
                name === "spellbook_request_permission"
                  ? "사용자의 편집 권한 허용 대기"
                  : name === "spellbook_observe"
                    ? "현재 슬라이드의 화면과 요소 확인"
                    : name === "spellbook_edit"
                      ? "PPTX 수정 및 새 화면 렌더링"
                      : "변경된 화면 검토";
              publish(`tool:${callId}`, "tool", label, "streaming", 1);
              if (name === "spellbook_request_permission") {
                const request = args as {
                  mode: string;
                  slideIndexes: number[];
                  reason: string;
                };
                const { messageId } = await host("request_permission", {
                  callId,
                  permission: {
                    mode: request.mode,
                    slideIndexes: request.slideIndexes,
                  },
                  message: request.reason,
                });
                let decision;
                do {
                  signal.throwIfAborted();
                  decision = await host("permission_status", { messageId });
                  if (decision.status === "permission_pending")
                    await delay(1000, undefined, { signal });
                } while (decision.status === "permission_pending");
                return {
                  success: true,
                  contentItems: [
                    { type: "inputText", text: JSON.stringify(decision) },
                  ],
                } as ToolResult;
              }
              if (name === "spellbook_observe") {
                const extra = (args as any)?.additionalSlideIndexes ?? [];
                if (!Array.isArray(extra))
                  throw new Error("Invalid slide observation indexes.");
                return observe(signal, extra);
              }
              if (name === "spellbook_edit") {
                if (!current)
                  throw new Error("Observe the current slide first.");
                reviewed = undefined;
                await host("edit", { command: args, callId });
                return observe(signal);
              }
              const review = args as { approved?: boolean; problems?: unknown };
              if (
                !current?.candidateVersionId ||
                !structurallyValid ||
                typeof review?.approved !== "boolean" ||
                !Array.isArray(review.problems) ||
                !review.problems.every(
                  (problem) => typeof problem === "string",
                ) ||
                (review.approved && review.problems.length)
              )
                throw new Error(
                  "Review requires a fully observed, structurally valid latest candidate and consistent findings.",
                );
              reviewed = {
                versionId: current.versionId,
                approved: review.approved,
                problems: review.problems,
              };
              return {
                success: true,
                contentItems: [
                  {
                    type: "inputText",
                    text: "Review recorded. User approval remains separate.",
                  },
                ],
              } as ToolResult;
            });
            const tracked = work.then((result) => {
              publish(
                `tool:${callId}`,
                "tool",
                name === "spellbook_request_permission"
                  ? "권한 요청 응답 확인"
                  : name === "spellbook_observe"
                    ? "화면과 요소 확인 완료"
                    : name === "spellbook_edit"
                      ? "새 작업본 렌더링 완료"
                      : "화면 검토 완료",
                "completed",
                2,
              );
              return result;
            });
            toolTail = tracked.catch(() => undefined);
            return tracked.catch((error: unknown) => {
              publish(
                `tool:${callId}`,
                "tool",
                "작업을 완료하지 못했습니다",
                "failed",
                2,
              );
              return {
                success: false,
                contentItems: [
                  {
                    type: "inputText",
                    text:
                      error instanceof Error ? error.message : "Tool failed.",
                  },
                ],
              };
            });
          },
        },
      );
      steer = undefined;
      flushMessages();
      await events;
      if (leaseLost) throw new Error("agent_lease_lost");
      if (!current)
        throw new Error("Agent answered without observing the current slide.");
      if (
        current.candidateVersionId &&
        reviewed?.versionId !== current.versionId
      )
        throw new Error("Agent did not review the latest candidate images.");
      return {
        executionToken,
        message: message.slice(0, 4000),
        candidateVersionId: current.candidateVersionId,
        approved: reviewed?.approved ?? false,
        problems: reviewed?.problems ?? [],
      };
    } catch (error) {
      if (leaseLost) throw new Error("agent_lease_lost");
      throw error;
    } finally {
      clearInterval(heartbeat);
      clearInterval(stream);
      lifetime.abort();
    }
  }
}
