"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ElementGraph, ElementNode, SlideGraph } from "@/lib/models";
import { ConversationTimeline } from "./conversation-timeline";
import { PermissionControl } from "./permission-control";
import { ChatIcon } from "./chat-icon";
import { DirectEditTools } from "./direct-edit-tools";
import { ModelControl } from "./model-control";
import type { ModelSettings } from "@/lib/ai-models";
import { uploadImageAsset } from "@/lib/upload-image";
import type { AiPermission } from "@/lib/ai-permissions";

interface EditState {
  execution?: string;
  modelSettings?: ModelSettings | null;
  id: string;
  requestText: string;
  status: string;
  candidateVersionId: string | null;
  aiAttempts: number;
  resultSummary: string | null;
  assistantMessage?: string | null;
  lastError: string | null;
  selectedElementIds?: string[];
  selectedSlideIndexes?: number[];
}

interface DocumentState {
  aiPermission?: AiPermission;
  id: string;
  fileName: string;
  status: string;
  lastError: string | null;
  currentVersionId: string;
  graph: ElementGraph | null;
  candidateGraph: ElementGraph | null;
  latestEdit: EditState | null;
  history: EditState[];
  versions: Array<{ id: string; parentVersionId: string | null; kind: string }>;
}

interface DragBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function DocumentEditor({ documentId }: { documentId: string }) {
  const [document, setDocument] = useState<DocumentState | null>(null);
  const [modelSettings, setModelSettings] = useState<ModelSettings>();
  const [activeSlide, setActiveSlide] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [wholeSlide, setWholeSlide] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [changingPermission, setChangingPermission] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [refining, setRefining] = useState(true);
  const [message, setMessage] = useState("");
  const [drag, setDrag] = useState<DragBox | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const revision = useRef("");
  const pendingInput = useRef<{ text: string; requestId: string } | null>(null);
  const pendingManual = useRef<{
    fingerprint: string;
    requestId: string;
  } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "0px";
    input.current.style.height = `${Math.min(180, Math.max(60, input.current.scrollHeight))}px`;
  }, [requestText, document?.id]);
  function recoverInput(text: string) {
    setRequestText(text);
    input.current?.focus();
  }

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        cache: "no-store",
        headers: revision.current ? { "if-none-match": revision.current } : {},
      });
      if (response.status === 304) return;
      if (!response.ok) throw new Error("document_load_failed");
      setDocument((await response.json()) as DocumentState);
      revision.current = response.headers.get("etag") ?? "";
    } catch {
      setMessage(
        "문서를 불러오지 못했습니다. 연결을 확인하고 다시 불러오세요.",
      );
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!document || !["processing", "editing"].includes(document.status))
      return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [document, load]);

  const workingGraph = document?.candidateGraph ?? document?.graph;
  const graph = useMemo(() => {
    if (refining || !document?.candidateGraph || !document.graph)
      return workingGraph;
    const candidateParts = new Set(
      document.candidateGraph.slides.map((slide) => slide.partUri),
    );
    return {
      ...document.candidateGraph,
      slides: [
        ...document.candidateGraph.slides,
        ...document.graph.slides.filter(
          (slide) => !candidateParts.has(slide.partUri),
        ),
      ].map((slide, index) => ({ ...slide, slideIndex: index })),
    };
  }, [refining, document, workingGraph]);
  const safeSlideIndex = Math.min(
    activeSlide,
    Math.max(0, (graph?.slides.length ?? 1) - 1),
  );
  const slide = graph?.slides[safeSlideIndex];
  const candidateSlide = document?.candidateGraph?.slides.find(
    (item) => item.partUri === slide?.partUri,
  );
  const beforeSlide = document?.graph?.slides.find(
    (item) => item.partUri === slide?.partUri,
  );
  useEffect(() => {
    const existing = new Set(
      workingGraph?.slides.flatMap((slide) =>
        slide.elements.map((element) => element.elementId),
      ) ?? [],
    );
    setSelectedIds((ids) => {
      const next = ids.filter((id) => existing.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [workingGraph]);
  useEffect(() => {
    if (activeSlide !== safeSlideIndex) {
      setActiveSlide(safeSlideIndex);
      setSelectedIds([]);
    }
  }, [activeSlide, safeSlideIndex]);
  const selectedElements = useMemo(
    () =>
      slide?.elements.filter((element) =>
        selectedIds.includes(element.elementId),
      ) ?? [],
    [selectedIds, slide],
  );

  function toggleElement(element: ElementNode) {
    if (!element.editable) {
      setMessage(element.unsupportedReason ?? "이 요소는 보기 전용입니다.");
      return;
    }
    setWholeSlide(false);
    setSelectedIds((current) =>
      current.includes(element.elementId)
        ? current.filter((id) => id !== element.elementId)
        : [...current, element.elementId],
    );
  }

  function pointerPosition(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = viewer.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    const position = pointerPosition(event);
    if (!position) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = position;
    setDrag({ ...position, width: 0, height: 0 });
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const position = pointerPosition(event);
    if (!position) return;
    setDrag({
      x: Math.min(dragStart.current.x, position.x),
      y: Math.min(dragStart.current.y, position.y),
      width: Math.abs(position.x - dragStart.current.x),
      height: Math.abs(position.y - dragStart.current.y),
    });
  }

  function finishDrag() {
    if (drag && graph && slide && drag.width > 0.01 && drag.height > 0.01) {
      const hits = slide.elements
        .filter((element) => {
          if (!element.editable) return false;
          const centerX = (element.x + element.width / 2) / graph.slideWidthEmu;
          const centerY =
            (element.y + element.height / 2) / graph.slideHeightEmu;
          return (
            centerX >= drag.x &&
            centerX <= drag.x + drag.width &&
            centerY >= drag.y &&
            centerY <= drag.y + drag.height
          );
        })
        .map((element) => element.elementId);
      setSelectedIds(hits);
      setWholeSlide(false);
    }
    dragStart.current = null;
    setDrag(null);
  }

  async function submitEdit() {
    if (submitting) return;
    const workingSlide = workingGraph?.slides.find(
      (item) => item.partUri === slide?.partUri,
    );
    if (document?.status !== "editing" && !workingSlide) {
      setMessage(
        "이 슬라이드는 작업본에서 삭제되었습니다. 작업 화면에서 남아 있는 슬라이드를 선택해 주세요.",
      );
      return;
    }
    const currentIds = selectedIds.filter((id) =>
      workingSlide?.elements.some((element) => element.elementId === id),
    );
    const submittedText = requestText;
    setSubmitting(true);
    setMessage("");
    try {
      const steering = document?.status === "editing";
      if (pendingInput.current?.text !== requestText)
        pendingInput.current = {
          text: requestText,
          requestId: crypto.randomUUID(),
        };
      const response = await fetch(
        `/api/documents/${documentId}/${steering ? "conversation" : "edits"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            steering
              ? pendingInput.current
              : {
                  requestText,
                  modelSettings,
                  selectedElementIds: wholeSlide ? [] : currentIds,
                  selectedSlideIndexes:
                    wholeSlide || currentIds.length === 0
                      ? [workingSlide!.slideIndex]
                      : [],
                  baseCandidateEditId:
                    document?.status === "candidate_ready"
                      ? document.latestEdit?.id
                      : undefined,
                },
          ),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "수정을 시작하지 못했습니다.");
        return;
      }
      setRequestText((current) => (current === submittedText ? "" : current));
      pendingInput.current = null;
      setRefining(true);
      await load();
    } catch {
      setMessage(
        "요청 결과를 확인하지 못했습니다. 입력은 유지했습니다. 문서를 다시 불러와 작업 상태를 먼저 확인하세요.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function applyManual(
    summary: string,
    commands: Record<string, unknown>[],
  ) {
    if (submitting || document?.status !== "ready" || !workingGraph) return;
    const command = {
      contractVersion: "1.0",
      baseDocumentSha256: workingGraph.documentSha256,
      summary,
      commands,
    };
    const fingerprint = JSON.stringify([document.currentVersionId, command]);
    if (pendingManual.current?.fingerprint !== fingerprint)
      pendingManual.current = { fingerprint, requestId: crypto.randomUUID() };
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/documents/${documentId}/manual-edits`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId: pendingManual.current.requestId,
            baseVersionId: document.currentVersionId,
            command,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "직접 편집을 저장하지 못했습니다.");
      pendingManual.current = null;
      await load();
    } catch (error) {
      await load();
      throw new Error(
        error instanceof Error && error.message !== "Failed to fetch"
          ? error.message
          : "저장 결과를 확인하지 못했습니다. 현재 문서를 확인한 뒤 다시 시도하세요.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function action(path: string) {
    if (submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(path, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setMessage(body.error ?? "작업을 완료하지 못했습니다.");
      }
      await load();
    } catch {
      setMessage(
        "작업 결과를 확인하지 못했습니다. 다시 불러와 현재 버전을 확인하세요.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function changePermission(input: {
    permission?: AiPermission;
    messageId?: string;
    decision?: string;
  }) {
    if (changingPermission) return;
    setChangingPermission(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/permission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok)
        throw new Error(
          "권한을 변경하지 못했습니다. 슬라이드 번호와 현재 작업 상태를 확인하세요.",
        );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "권한 변경 실패");
    } finally {
      setChangingPermission(false);
    }
  }

  if (!document || !graph || !slide) {
    return (
      <main className="editor-loading">
        {!message && document?.status !== "failed" ? (
          <div className="spinner" />
        ) : null}
        <h1>{document?.fileName ?? "PPTX를 여는 중"}</h1>
        <p>
          {message ||
            document?.lastError ||
            "파일 구조를 검사하고 슬라이드를 렌더링하고 있습니다."}
        </p>
        {message ? (
          <button
            type="button"
            onClick={() => {
              setMessage("");
              void load();
            }}
          >
            다시 불러오기
          </button>
        ) : null}
        <Link href="/">← 작업공간으로</Link>
        {document ? (
          <a href={`/api/documents/${documentId}/download?source=original`}>
            업로드한 원본 다운로드
          </a>
        ) : null}
      </main>
    );
  }

  const compare =
    !refining &&
    document.status === "candidate_ready" &&
    document.candidateGraph;
  const canEdit =
    ["ready", "candidate_ready", "editing"].includes(document.status) &&
    !(
      document.status === "editing" &&
      document.latestEdit?.execution === "manual"
    );
  const manualSaving =
    document.status === "editing" &&
    document.latestEdit?.execution === "manual";
  return (
    <main className="editor-shell">
      <header className="editor-topbar">
        <div className="editor-title">
          <Link href="/">←</Link>
          <div>
            <strong>{document.fileName}</strong>
            <span>{statusLabel(document.status)}</span>
          </div>
        </div>
        <div className="editor-actions">
          <a
            className="text-button"
            href={`/api/documents/${documentId}/download?source=original`}
          >
            원본
          </a>
          <button
            className="text-button"
            type="button"
            disabled={
              submitting ||
              !["ready", "candidate_ready"].includes(document.status) ||
              !document.versions.some(
                (version) =>
                  version.id === document.currentVersionId &&
                  version.parentVersionId,
              )
            }
            onClick={() => void action(`/api/documents/${documentId}/undo`)}
          >
            되돌리기
          </button>
          <a
            className="secondary-button small"
            href={`/api/documents/${documentId}/download`}
          >
            PPTX 다운로드
          </a>
        </div>
      </header>
      <div className="editor-layout">
        <aside className="slide-rail">
          <p className="rail-label">SLIDES</p>
          {graph.slides.map((item) => (
            <button
              className={`slide-thumb ${item.slideIndex === activeSlide ? "active" : ""}`}
              key={item.slideIndex}
              onClick={() => {
                setActiveSlide(item.slideIndex);
                setSelectedIds([]);
                setWholeSlide(false);
              }}
            >
              <span>{item.slideIndex + 1}</span>
              {item.previewObject ? (
                <img
                  src={assetUrl(item.previewObject)}
                  alt={`${item.slideIndex + 1}번 슬라이드`}
                  loading="lazy"
                />
              ) : null}
              <em>{item.supportGrade}</em>
            </button>
          ))}
        </aside>

        <section className={`canvas-area ${compare ? "compare" : ""}`}>
          <DirectEditTools
            documentId={documentId}
            graph={graph}
            slide={slide}
            selected={selectedElements}
            disabled={submitting || document.status !== "ready" || !!compare}
            reason={
              manualSaving
                ? "변경 저장 및 화면 갱신 중…"
                : document.status === "candidate_ready"
                  ? "AI 수정본을 승인하거나 폐기한 뒤 직접 편집할 수 있습니다."
                  : "진행 중인 작업이 끝나면 편집할 수 있습니다."
            }
            onSelect={toggleElement}
            onApply={applyManual}
          />
          {compare ? (
            <p className="compare-label">
              <span>수정 전</span>
              <span>자체 검증 통과 후</span>
            </p>
          ) : null}
          <div className="canvas-grid">
            {compare && !beforeSlide ? (
              <div className="empty-slide-comparison">
                새로 추가된 슬라이드입니다.
              </div>
            ) : (
              <SlideCanvas
                graph={graph}
                slide={compare ? beforeSlide! : slide}
                selectedIds={selectedIds}
                drag={drag}
                viewerRef={viewer}
                onToggle={toggleElement}
                onPointerDown={beginDrag}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
              />
            )}
            {compare && document.candidateGraph && candidateSlide ? (
              <SlideCanvas
                graph={document.candidateGraph}
                slide={candidateSlide}
                selectedIds={[]}
                onToggle={() => undefined}
                readOnly
              />
            ) : compare ? (
              <div className="empty-slide-comparison">
                이 슬라이드는 삭제되었습니다.
              </div>
            ) : null}
          </div>
          <div className="canvas-caption">
            <span>
              슬라이드 {activeSlide + 1} · 지원 등급 {slide.supportGrade}
            </span>
            <span>요소를 클릭하거나 빈 곳에서 드래그해 영역을 선택하세요.</span>
          </div>
        </section>

        <aside className="edit-panel">
          <header className="conversation-header">
            <div className="conversation-identity">
              <span className="agent-avatar" aria-hidden="true">
                C
              </span>
              <div>
                <strong>Codex</strong>
                <p>PPT 편집 대화</p>
              </div>
            </div>
            <span>
              {manualSaving
                ? "직접 편집 저장 중"
                : document.status === "editing"
                  ? "작업 중"
                  : document.status === "candidate_ready"
                    ? "검토 대기"
                    : ""}
            </span>
          </header>
          <ConversationTimeline
            busyLabel={
              manualSaving
                ? "직접 편집을 저장하고 화면을 갱신 중입니다"
                : undefined
            }
            documentId={documentId}
            busy={document.status === "editing"}
            history={document.history}
            resultEditId={document.latestEdit?.id}
            onPermission={changePermission}
            changingPermission={changingPermission}
            onRecover={recoverInput}
          >
            {document.status === "candidate_ready" && document.latestEdit ? (
              <div
                className="approval-panel"
                data-edit-id={document.latestEdit.id}
              >
                <div className="result-card-heading">
                  <ChatIcon name="slide" />
                  <strong>수정본이 준비됐어요</strong>
                </div>
                <p className="fine-print">
                  전후를 비교하거나, 이어서 수정을 요청하세요.
                </p>
                <div className="approval-actions">
                  <a
                    className="text-button candidate-download"
                    href={`/api/documents/${documentId}/download?source=candidate`}
                  >
                    미승인 후보 다운로드
                  </a>
                  <button
                    className="text-button review-changes"
                    type="button"
                    onClick={() => setRefining((value) => !value)}
                  >
                    {compare ? "작업 화면으로" : "수정 전후 비교"}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      void action(
                        `/api/documents/${documentId}/edits/${document.latestEdit!.id}/approve`,
                      )
                    }
                  >
                    이 결과 승인
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      void action(
                        `/api/documents/${documentId}/edits/${document.latestEdit!.id}/reject`,
                      )
                    }
                  >
                    폐기
                  </button>
                </div>
              </div>
            ) : null}
            {document.latestEdit?.status === "failed" && (
              <div className="error-banner compact">
                {document.latestEdit.lastError ?? "작업을 완료하지 못했습니다."}
              </div>
            )}
          </ConversationTimeline>
          {
            <div className="conversation-composer">
              <div className="selection-heading">
                <div>
                  <h2>
                    <ChatIcon name="slide" />
                    {manualSaving
                      ? "직접 편집 저장 중"
                      : document.status === "editing"
                        ? "진행 중인 작업에 추가 지시"
                        : `${activeSlide + 1}번 슬라이드`}
                  </h2>
                </div>
                <button
                  className={`slide-select ${wholeSlide ? "active" : ""}`}
                  type="button"
                  disabled={document.status === "editing"}
                  onClick={() => {
                    setWholeSlide((value) => !value);
                    setSelectedIds([]);
                  }}
                >
                  슬라이드 전체
                </button>
              </div>
              {manualSaving ? (
                <p className="selection-empty">
                  저장이 끝나면 새 화면을 보고 대화를 이어갈 수 있습니다.
                </p>
              ) : document.status === "editing" ? (
                <p className="selection-empty">
                  작업을 멈추지 않고 방향을 알려주세요.
                </p>
              ) : wholeSlide ? (
                <p className="selection-empty">슬라이드 전체 선택됨</p>
              ) : selectedElements.length ? (
                <div className="selected-list">
                  {selectedElements.map((element) => (
                    <div className="selection-card" key={element.elementId}>
                      <strong>{element.name}</strong>
                      <span>{element.text || element.kind}</span>
                      <button
                        type="button"
                        aria-label={`${element.name} 선택 해제`}
                        onClick={() => toggleElement(element)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <label className="request-box">
                <span className="sr-only">질문하거나 수정을 요청하세요</span>
                <textarea
                  ref={input}
                  value={requestText}
                  onChange={(event) => setRequestText(event.target.value)}
                  placeholder={
                    document.status === "editing"
                      ? "추가로 알려줄 내용이 있나요?"
                      : "질문하거나, 원하는 수정을 말해주세요"
                  }
                  rows={2}
                  disabled={!canEdit}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing &&
                      event.keyCode !== 229
                    ) {
                      event.preventDefault();
                      if (
                        canEdit &&
                        !submitting &&
                        !uploadingImage &&
                        requestText.trim()
                      )
                        void submitEdit();
                    }
                  }}
                />
              </label>
              <div className="composer-actions">
                <label className="attachment-button" title="이미지 첨부">
                  <ChatIcon name="plus" />
                  <span>{uploadingImage ? "업로드 중…" : "이미지 첨부"}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    disabled={uploadingImage}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      setUploadingImage(true);
                      try {
                        const result = await uploadImageAsset(documentId, file);
                        setRequestText(
                          (text) =>
                            `${text}${text ? "\n" : ""}방금 첨부한 ${result.fileName} 이미지를 `,
                        );
                      } catch {
                        setMessage(
                          "이미지를 첨부하지 못했습니다. PNG/JPEG, 5MB·1,600만 픽셀 이하인지 확인하세요.",
                        );
                      } finally {
                        setUploadingImage(false);
                      }
                    }}
                  />
                </label>
                <ModelControl
                  value={modelSettings}
                  disabled={submitting || document.status === "editing"}
                  onChange={setModelSettings}
                />
                <button
                  className="chat-send"
                  type="button"
                  aria-label={
                    submitting
                      ? "전달 중…"
                      : document.status === "editing"
                        ? "추가 지시 보내기"
                        : "보내기"
                  }
                  title={
                    document.status === "editing"
                      ? "추가 지시 보내기"
                      : "보내기"
                  }
                  disabled={
                    !canEdit ||
                    submitting ||
                    uploadingImage ||
                    !requestText.trim()
                  }
                  onClick={() => void submitEdit()}
                >
                  <ChatIcon name="send" />
                </button>
                {document.status === "editing" ? (
                  <button
                    className="chat-stop"
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      void action(`/api/documents/${documentId}/cancel`)
                    }
                  >
                    <ChatIcon name="stop" />
                    {manualSaving ? "저장 취소" : "작업 중단"}
                  </button>
                ) : null}
              </div>
            </div>
          }
          <div className="composer-footer">
            <PermissionControl
              permission={
                document.aiPermission ?? { mode: "selection", slideIndexes: [] }
              }
              activeSlide={activeSlide}
              disabled={changingPermission}
              onChange={changePermission}
            />
            <span title="Enter 보내기 · Shift+Enter 줄바꿈">
              현재 화면 자동 전달
            </span>
          </div>
          {message ? (
            <div className="error-banner compact">{message}</div>
          ) : null}
          {document.lastError ? (
            <div className="error-banner compact" role="alert">
              {document.lastError}
            </div>
          ) : null}
          <details className="document-diagnostics">
            <summary>
              파일 정보 및 작업 이력
              {graph.missingFonts?.length ? " · 글꼴 확인 필요" : ""}
            </summary>
            <details className="history-panel">
              <summary>작업 이력</summary>
              {document.history.length ? (
                document.history.slice(0, 6).map((edit) => (
                  <div key={edit.id}>
                    <span className={`history-dot ${edit.status}`} />
                    <p>
                      <strong>{edit.requestText}</strong>
                      <small>
                        {statusLabel(edit.status)} ·{" "}
                        {edit.execution === "manual"
                          ? "직접 편집 · AI 검증 없음"
                          : `${edit.modelSettings?.model ?? "서버 기본 모델"}${edit.modelSettings ? ` · ${edit.modelSettings.effort}` : ""} · 시도 ${edit.aiAttempts || 1}회`}
                      </small>
                    </p>
                  </div>
                ))
              ) : (
                <span className="muted">수정 이력이 없습니다.</span>
              )}
            </details>
            {graph.rendererName && graph.rendererVersion ? (
              <p className="muted">
                렌더러: {graph.rendererName} · {graph.rendererVersion}
              </p>
            ) : null}
            {graph.fontInventoryAvailable === false ? (
              <div className="warning-banner compact">
                서버 글꼴 환경을 확인하지 못해 원본 렌더링 충실도를 보장할 수
                없습니다.
              </div>
            ) : null}
            {(graph.missingFonts?.length ?? 0) > 0 ? (
              <div className="warning-banner compact">
                서버에 없는 글꼴: {graph.missingFonts!.slice(0, 6).join(", ")}
                {graph.missingFonts!.length > 6
                  ? ` 외 ${graph.missingFonts!.length - 6}개`
                  : ""}
                . 화면이 원본과 다를 수 있습니다.
              </div>
            ) : null}
            {(graph.fontSubstitutions?.length ?? 0) > 0 ? (
              <div className="warning-banner compact">
                실제 대체:{" "}
                {graph
                  .fontSubstitutions!.slice(0, 4)
                  .map((font) => `${font.original}→${font.substituted}`)
                  .join(", ")}
                {graph.fontSubstitutions!.length > 4
                  ? ` 외 ${graph.fontSubstitutions!.length - 4}개`
                  : ""}
              </div>
            ) : null}
          </details>
        </aside>
      </div>
    </main>
  );
}

function SlideCanvas({
  graph,
  slide,
  selectedIds,
  drag,
  viewerRef,
  onToggle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  readOnly = false,
}: {
  graph: ElementGraph;
  slide: SlideGraph;
  selectedIds: string[];
  drag?: DragBox | null;
  viewerRef?: React.RefObject<HTMLDivElement | null>;
  onToggle: (element: ElementNode) => void;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: () => void;
  readOnly?: boolean;
}) {
  return (
    <div
      ref={viewerRef}
      className={`slide-canvas ${readOnly ? "readonly" : ""}`}
      style={{
        aspectRatio: `${graph.slideWidthEmu} / ${graph.slideHeightEmu}`,
        maxWidth: `calc(max(240px, 100dvh - 200px) * ${graph.slideWidthEmu / graph.slideHeightEmu})`,
        marginInline: "auto",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {slide.previewObject ? (
        <img
          src={assetUrl(slide.previewObject)}
          alt={`${slide.slideIndex + 1}번 슬라이드`}
          draggable={false}
        />
      ) : null}
      {!readOnly
        ? slide.elements.map((element) => (
            <button
              key={element.elementId}
              type="button"
              className={`element-hit ${element.editable ? "editable" : "readonly"} ${selectedIds.includes(element.elementId) ? "selected" : ""}`}
              style={{
                left: `${(element.x / graph.slideWidthEmu) * 100}%`,
                top: `${(element.y / graph.slideHeightEmu) * 100}%`,
                width: `${(element.width / graph.slideWidthEmu) * 100}%`,
                height: `${(element.height / graph.slideHeightEmu) * 100}%`,
                transform: element.rotation
                  ? `rotate(${element.rotation}deg)`
                  : undefined,
                zIndex: element.zIndex + 2,
              }}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(element);
              }}
              title={
                element.editable
                  ? element.name
                  : (element.unsupportedReason ?? element.name)
              }
              aria-label={element.name}
              aria-pressed={selectedIds.includes(element.elementId)}
            />
          ))
        : null}
      {drag ? (
        <div
          className="drag-box"
          style={{
            left: `${drag.x * 100}%`,
            top: `${drag.y * 100}%`,
            width: `${drag.width * 100}%`,
            height: `${drag.height * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}

function assetUrl(objectName: string) {
  return `/api/assets?object=${encodeURIComponent(objectName)}`;
}

function statusLabel(status: string) {
  return (
    (
      {
        processing: "렌더링 중",
        ready: "준비됨",
        editing: "AI 수정 중",
        planning: "AI 분석 중",
        patching: "파일 수정 중",
        reviewing: "결과 검증 중",
        candidate_ready: "승인 대기",
        approved: "승인됨",
        rejected: "폐기됨",
        failed: "실패",
        answered: "답변 완료 · 파일 변경 없음",
      } as Record<string, string>
    )[status] ?? status
  );
}

function conversationStatus(status: string) {
  if (status === "candidate_ready")
    return "검증된 후보 · 아직 승인본에는 반영되지 않음";
  return statusLabel(status);
}
