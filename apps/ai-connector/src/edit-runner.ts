import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import type { AiJob } from "./types.js";
import { SessionManager } from "./session-manager.js";
import { AgentRunner } from "./agent-runner.js";
import { LocalStorage, type ObjectStore } from "./local-storage.js";

const contractsDirectory =
  process.env.SPELLBOOK_CONTRACTS_DIR ??
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../contracts",
  );
const Ajv2020Constructor = Ajv2020 as unknown as typeof import("ajv").default;

export class EditRunner {
  constructor(
    private readonly sessions: SessionManager,
    private readonly storage: ObjectStore = new LocalStorage(),
  ) {}

  async run(job: AiJob): Promise<unknown> {
    if (job.execution === "agent")
      return new AgentRunner(this.sessions, this.storage).run(job);
    const workspace = await fs.mkdtemp(
      path.join(os.tmpdir(), `spellbook-ai-job-${safeSegment(job.jobId)}-`),
    );
    try {
      const baseGraphPath = await this.download(
        job.storageNamespace,
        job.baseGraphObject,
        workspace,
        "base-graph.json",
      );
      const baseGraph = JSON.parse(
        await fs.readFile(baseGraphPath, "utf8"),
      ) as Record<string, unknown>;
      assertImageCoverage(job, baseGraph, job.basePreviewObjects);
      const baseImages = await this.downloadImages(
        job.storageNamespace,
        job.basePreviewObjects,
        workspace,
        "before",
      );
      if (baseImages.length === 0) {
        throw new Error("Visual editing requires at least one source preview.");
      }
      const client = await this.sessions.client(job.email, job.modelSettings);
      if (job.mode === "plan") {
        const schema = job.conversational
          ? await conversationPlanSchema()
          : await readSchema("edit-command.schema.json");
        const input = [
          { type: "text", text: buildPlanPrompt(job, baseGraph) },
          ...baseImages.map((imagePath) => ({
            type: "localImage",
            path: imagePath,
          })),
        ];
        const raw = await client.runStructuredTurn(
          input,
          toCodexOutputSchema(schema),
        );
        return parseAndValidate(raw, schema);
      }

      if (!job.candidateGraphObject || !job.validationObject) {
        throw new Error(
          "Review job is missing candidate graph or validation report.",
        );
      }
      const candidateGraphPath = await this.download(
        job.storageNamespace,
        job.candidateGraphObject,
        workspace,
        "candidate-graph.json",
      );
      const validationPath = await this.download(
        job.storageNamespace,
        job.validationObject,
        workspace,
        "validation.json",
      );
      const candidateGraph = JSON.parse(
        await fs.readFile(candidateGraphPath, "utf8"),
      ) as Record<string, unknown>;
      assertImageCoverage(
        job,
        candidateGraph,
        job.candidatePreviewObjects ?? [],
      );
      const validation = JSON.parse(
        await fs.readFile(validationPath, "utf8"),
      ) as Record<string, unknown>;
      const candidateImages = await this.downloadImages(
        job.storageNamespace,
        job.candidatePreviewObjects ?? [],
        workspace,
        "after",
      );
      assertReviewEvidence(
        validation,
        baseImages.length,
        candidateImages.length,
      );
      const reviewSchema = await combinedReviewSchema();
      const input = [
        {
          type: "text",
          text: buildReviewPrompt(job, baseGraph, candidateGraph, validation),
        },
        ...interleaveImages(baseImages, candidateImages).map((imagePath) => ({
          type: "localImage",
          path: imagePath,
        })),
      ];
      const raw = await client.runStructuredTurn(
        input,
        toCodexOutputSchema(reviewSchema),
      );
      const review = parseAndValidate(raw, reviewSchema) as Record<
        string,
        unknown
      >;
      assertConsistentReview(review);
      return review;
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }

  private async download(
    storageNamespace: string,
    objectName: string,
    workspace: string,
    fileName: string,
  ): Promise<string> {
    const destination = path.join(workspace, fileName);
    await this.storage
      .namespace(storageNamespace)
      .object(objectName)
      .download({ destination });
    return destination;
  }

  private async downloadImages(
    storageNamespace: string,
    objects: string[],
    workspace: string,
    prefix: string,
  ): Promise<string[]> {
    const images: string[] = [];
    for (let index = 0; index < objects.length; index++) {
      images.push(
        await this.download(
          storageNamespace,
          objects[index]!,
          workspace,
          `${prefix}-${index + 1}.png`,
        ),
      );
    }
    return images;
  }
}

export function assertReviewEvidence(
  validation: Record<string, unknown>,
  beforeCount: number,
  afterCount: number,
): void {
  if (validation.valid !== true)
    throw new Error(
      "Visual review cannot approve an invalid or unverified document.",
    );
  if (beforeCount < 1 || beforeCount !== afterCount)
    throw new Error(
      "Visual review requires a complete before/after image pair for every selected slide.",
    );
}

export function assertImageCoverage(
  job: AiJob,
  graph: Record<string, unknown>,
  objects: string[],
): void {
  const slides = (Array.isArray(graph.slides) ? graph.slides : []) as Array<{
    slideIndex: number;
    previewObject?: string;
    elements?: Array<{ elementId: string }>;
  }>;
  const required = new Set(job.selectedSlideIndexes);
  const remaining = new Set(job.selectedElementIds);
  for (const slide of slides)
    for (const element of slide.elements ?? [])
      if (remaining.delete(element.elementId)) required.add(slide.slideIndex);
  const ordered = [...required].sort((a, b) => a - b);
  if (
    remaining.size ||
    ordered.length === 0 ||
    objects.length !== ordered.length
  )
    throw new Error("Visual evidence does not cover every selected slide.");
  for (let index = 0; index < ordered.length; index++) {
    const matches = slides.filter(
      (slide) => slide.slideIndex === ordered[index],
    );
    if (
      matches.length !== 1 ||
      !matches[0]!.previewObject ||
      matches[0]!.previewObject !== objects[index]
    )
      throw new Error(
        "Visual evidence slide identity or order does not match the graph.",
      );
  }
}

export function assertConsistentReview(review: Record<string, unknown>): void {
  if (
    review.approved === true &&
    (!Array.isArray(review.problems) ||
      review.problems.length > 0 ||
      review.revisedCommand != null)
  ) {
    throw new Error(
      "Visual review cannot approve a candidate while reporting problems or requesting another edit.",
    );
  }
}

export function buildPlanPrompt(
  job: AiJob,
  graph: Record<string, unknown>,
): string {
  return [
    ...(job.conversational
      ? [
          "사용자와 현재 슬라이드를 함께 보며 대화하세요. 질문·설명·검토 요청에는 message로 답하고 edit=null로 반환하세요. 명시적인 수정 요청만 edit에 편집 명령을 반환하세요. 범위가 불명확하거나 지원하지 않는 수정이면 질문하거나 한계를 설명하고 edit=null로 두세요. message에는 아직 실행하지 않은 수정을 완료했다고 말하지 마세요.",
          "다음 대화 이력은 맥락일 뿐입니다. 과거의 작업은 실패·폐기·되돌리기 되었을 수 있습니다. 현재 첨부 화면과 그래프가 유일한 현재 파일 상태이고, 이번 선택 범위만 수정 권한입니다.",
          `최근 대화 이력 (오래된 순): ${JSON.stringify(job.conversationHistory ?? [])}`,
        ]
      : []),
    "당신은 PowerPoint 파일을 직접 쓰지 않고, 허용된 구조화 편집 명령만 제안하는 슬라이드 편집자입니다.",
    "첨부 이미지는 현재 슬라이드 화면입니다. JSON은 요소의 실제 좌표와 편집 가능 여부입니다.",
    "editable=false 요소는 절대 수정하지 마세요. 수정은 선택 요소 ID 또는 명시적으로 선택된 슬라이드 안의 요소에만 허용됩니다. 주변 요소는 참고 정보이며 수정 권한이 아닙니다. 요청에 더 넓은 범위가 필요해도 임의로 확대하지 마세요.",
    "좌표 단위는 EMU입니다. 겹침, 슬라이드 밖 배치, 불필요한 원본 변경을 피하세요.",
    "replace_text의 text는 요소 전체 텍스트입니다. 문단 구분은 \\n, 수동 줄바꿈은 \\u000b입니다. 요청에 필요하지 않으면 구분을 유지하세요. 한 줄에서 변경 구간 앞뒤의 같은 문구는 기존 서식이 보존되고, 변경 구간은 시작 위치의 서식을 따릅니다. 문단 구조를 바꾸면 변경된 문단은 시작 문단의 서식을 따릅니다. 동적 필드 덮어쓰기는 지원하지 않습니다.",
    `사용자 요청: ${job.requestText}`,
    `선택 요소 ID: ${job.selectedElementIds.length ? job.selectedElementIds.join(", ") : "없음"}`,
    `선택 슬라이드: ${job.selectedSlideIndexes.join(", ")}`,
    `요소 그래프: ${JSON.stringify(relevantGraph(graph, job.selectedElementIds, job.selectedSlideIndexes))}`,
    "반드시 출력 스키마에 맞는 JSON만 최종 응답으로 반환하세요.",
  ].join("\n\n");
}

export async function conversationPlanSchema(): Promise<Record<string, any>> {
  const edit = stripSchemaMetadata(
    await readSchema("edit-command.schema.json"),
  );
  const definitions = edit.$defs;
  delete edit.$defs;
  return {
    type: "object",
    additionalProperties: false,
    required: ["message", "edit"],
    $defs: definitions,
    properties: {
      message: { type: "string", minLength: 1, maxLength: 4000 },
      edit: { anyOf: [{ type: "null" }, edit] },
    },
  };
}

export function buildReviewPrompt(
  job: AiJob,
  baseGraph: Record<string, unknown>,
  candidateGraph: Record<string, unknown>,
  validation: Record<string, unknown>,
): string {
  return [
    "당신은 수정된 PowerPoint 결과를 배포 전에 검사하는 시각 품질 검수자입니다.",
    "이미지는 각 슬라이드의 수정 전, 수정 후 순서로 첨부됩니다.",
    `요청 해석을 위한 최근 대화 (현재 파일 상태는 첨부 그래프와 화면을 기준으로 판단): ${JSON.stringify(job.conversationHistory ?? [])}`,
    "사용자 요청이 충족됐는지, 텍스트 잘림·요소 겹침·정렬 붕괴·슬라이드 밖 배치·원본의 불필요한 훼손이 없는지 확인하세요.",
    "구조 검증이 실패했다면 시각적으로 괜찮아 보여도 승인하지 마세요.",
    "수정 가능한 문제라면 revisedCommand에 원본 문서 기준의 전체 대체 명령을 제안하세요. editable=false 요소는 수정할 수 없습니다. 허용된 명령으로 원인을 고칠 수 없거나 문제가 없으면 revisedCommand는 null입니다.",
    "렌더러의 글꼴 선택이나 조판 차이를 감추려고 원문의 문구·글꼴·명시적 줄바꿈을 바꾸지 마세요. 사용자가 보존을 요청했는데 원본 그래프가 같은 상태에서 화면만 달라졌다면, 원본을 변형하는 대체 명령 대신 차이를 보고하고 반려하세요.",
    `사용자 요청: ${job.requestText}`,
    `원본 그래프: ${JSON.stringify(relevantGraph(baseGraph, job.selectedElementIds, job.selectedSlideIndexes))}`,
    `후보 그래프: ${JSON.stringify(relevantGraph(candidateGraph, job.selectedElementIds, job.selectedSlideIndexes))}`,
    `구조 검증: ${JSON.stringify(validation)}`,
    "반드시 출력 스키마에 맞는 JSON만 최종 응답으로 반환하세요.",
  ].join("\n\n");
}

function relevantGraph(
  graph: Record<string, unknown>,
  selectedIds: string[],
  selectedSlideIndexes: number[],
): Record<string, unknown> {
  if (selectedIds.length === 0 && selectedSlideIndexes.length === 0)
    return graph;
  const selected = new Set(selectedIds);
  const slides = Array.isArray(graph.slides) ? graph.slides : [];
  const selectedSlides = new Set<number>(selectedSlideIndexes);
  for (const slide of slides) {
    if (typeof slide !== "object" || slide === null) continue;
    const record = slide as Record<string, unknown>;
    const elements = Array.isArray(record.elements) ? record.elements : [];
    if (
      elements.some(
        (element) =>
          typeof element === "object" &&
          element !== null &&
          selected.has(String((element as Record<string, unknown>).elementId)),
      )
    ) {
      selectedSlides.add(Number(record.slideIndex));
    }
  }
  return {
    contractVersion: graph.contractVersion,
    documentSha256: graph.documentSha256,
    slideWidthEmu: graph.slideWidthEmu,
    slideHeightEmu: graph.slideHeightEmu,
    slides: slides.filter(
      (slide) =>
        typeof slide === "object" &&
        slide !== null &&
        selectedSlides.has(
          Number((slide as Record<string, unknown>).slideIndex),
        ),
    ),
  };
}

export async function readSchema(
  fileName: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await fs.readFile(path.join(contractsDirectory, fileName), "utf8"),
  ) as Record<string, unknown>;
}

export async function combinedReviewSchema(): Promise<Record<string, unknown>> {
  const review = structuredClone(await readSchema("visual-review.schema.json"));
  const edit = stripSchemaMetadata(
    await readSchema("edit-command.schema.json"),
  );
  review.$defs = edit.$defs;
  delete edit.$defs;
  const properties = review.properties as Record<string, unknown>;
  properties.revisedCommand = { anyOf: [{ type: "null" }, edit] };
  (review.required as string[]).push("revisedCommand");
  return review;
}

function stripSchemaMetadata(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const copy = structuredClone(schema);
  delete copy.$schema;
  delete copy.$id;
  delete copy.title;
  return copy;
}

export function toCodexOutputSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return replaceOneOfWithAnyOf(stripSchemaMetadata(schema)) as Record<
    string,
    unknown
  >;
}

function replaceOneOfWithAnyOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(replaceOneOfWithAnyOf);
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key === "oneOf" ? "anyOf" : key] = replaceOneOfWithAnyOf(child);
  }
  return result;
}

function parseAndValidate(
  raw: string,
  schema: Record<string, unknown>,
): unknown {
  const value = JSON.parse(raw) as unknown;
  const ajv = new Ajv2020Constructor({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    throw new Error(
      `Codex returned an invalid edit result: ${ajv.errorsText(validate.errors)}`,
    );
  }
  return value;
}

function interleaveImages(before: string[], after: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    if (before[index]) result.push(before[index]);
    if (after[index]) result.push(after[index]);
  }
  return result;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "job";
}
