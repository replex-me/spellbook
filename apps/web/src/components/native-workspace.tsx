"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import { ModelControl } from "./model-control";
import { SpellbookBrand, SpellbookIcon } from "./spellbook-ui";
import type { AvailableModel, ModelSettings } from "@/lib/ai-models";
import { normalizeQuotedStrongMarkdown } from "@/lib/markdown";
import { CHATGPT_SECURITY_URL, useAiAccount } from "@/lib/use-ai-account";
import type { AiConnectorConfig } from "@/lib/ai-connector-config";
import "./native-workspace.css";

export interface NativeLaunch {
  documentId: string;
  fileName: string;
  editorUrl: string;
  accessToken: string;
  expiresAt: number;
  apiBase: string;
  aiConnector: AiConnectorConfig;
}
type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  status: "running" | "done" | "error" | "review";
};

// Product UI, also mounted by the isolated native integration harness. The
// launch capability is document-scoped; no provider credential enters here.
export function NativeWorkspace({ launch }: { launch: NativeLaunch }) {
  const office = useRef<HTMLIFrameElement>(null),
    form = useRef<HTMLFormElement>(null);
  const port = useRef<MessagePort | null>(null),
    submitted = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null),
    bottom = useRef<HTMLDivElement>(null);
  const turnRequested = useRef(false),
    saveRevision = useRef(0),
    downloadAfterRevision = useRef<number | null>(null);
  const dispatchedLocalJobs = useRef(new Set<string>());
  const imagePayloads = useRef(
    new Map<
      string,
      { mediaType: "image/png" | "image/jpeg"; bytes: ArrayBuffer }
    >(),
  );
  const loadingImages = useRef(new Set<string>());
  const [engineReady, setEngineReady] = useState(false),
    [bridgeReady, setBridgeReady] = useState(false);
  const [panel, setPanel] = useState(true),
    [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [saveState, setSaveState] = useState("저장됨");
  const [permission, setPermission] = useState<
    "read_only" | "selection" | "slides" | "document"
  >("selection");
  const [model, setModel] = useState<ModelSettings>();
  const ai = useAiAccount(launch.aiConnector);
  const aiConnected = Boolean(ai.account);
  const origin = new URL(launch.editorUrl).origin;
  const api = useCallback(
    async (path: string, body?: unknown, signal?: AbortSignal) => {
      const response = await fetch(`${launch.apiBase}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${launch.accessToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        signal,
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "연결을 확인하세요.");
      return value;
    },
    [launch.apiBase, launch.accessToken],
  );
  const loadModels = useCallback(
    (signal: AbortSignal): Promise<{ models: AvailableModel[] }> =>
      ai.mode === "local"
        ? ai.localRequest("/v1/models")
        : api("models", undefined, signal),
    [ai.localRequest, ai.mode, api],
  );
  const dispatchLocalJob = useCallback(
    async (job: { jobId?: unknown }) => {
      if (ai.mode !== "local" || typeof job.jobId !== "string")
        throw new Error("invalid_local_native_job");
      if (dispatchedLocalJobs.current.has(job.jobId)) return;
      dispatchedLocalJobs.current.add(job.jobId);
      try {
        await ai.localRequest("/v1/jobs/native", job);
      } catch (error) {
        dispatchedLocalJobs.current.delete(job.jobId);
        throw error;
      }
    },
    [ai.localRequest, ai.mode],
  );
  const sendOffice = useCallback(
    (MessageId: string, Values: unknown = {}) =>
      office.current?.contentWindow?.postMessage(
        JSON.stringify({ MessageId, SendTime: Date.now(), Values }),
        origin,
      ),
    [origin],
  );
  const deliverTask = useCallback(
    (task: {
      id?: string;
      request?: {
        operation?: string;
        assetId?: string;
        slideIndex?: number;
        expectedRevision?: string;
        expectedSlides?: string;
        permission?: {
          mode?: string;
          slideIndexes?: number[];
          elementIds?: string[];
        };
      };
    }) => {
      if (
        task.request?.operation !== "insert_image" ||
        typeof task.id !== "string"
      ) {
        port.current?.postMessage(task);
        return;
      }
      const assetId = task.request.assetId ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(assetId)) {
        void api("result", {
          id: task.id,
          error: "invalid_generated_image_asset",
        }).catch((cause) => setError(cause.message));
        return;
      }
      const deliver = (payload: {
        mediaType: "image/png" | "image/jpeg";
        bytes: ArrayBuffer;
      }) => {
        // Transfer a fresh copy because MessagePort detaches transferred buffers.
        // Task redelivery is safe: the extension caches the result by task id.
        const bytes = payload.bytes.slice(0);
        port.current?.postMessage(
          {
            id: task.id,
            request: {
              operation: "insert_image",
              mediaType: payload.mediaType,
              imageBytes: bytes,
              slideIndex: task.request?.slideIndex,
              expectedRevision: task.request?.expectedRevision,
              expectedSlides: task.request?.expectedSlides,
              permission: task.request?.permission,
            },
          },
          [bytes],
        );
      };
      const cached = imagePayloads.current.get(task.id);
      if (cached) {
        deliver(cached);
        return;
      }
      if (loadingImages.current.has(task.id)) return;
      loadingImages.current.add(task.id);
      const imageUrl = new URL(
        `/api/wopi/files/${launch.documentId}/assets/${assetId}`,
        window.location.origin,
      );
      imageUrl.searchParams.set("access_token", launch.accessToken);
      void fetch(imageUrl, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("generated_image_download_failed");
          const mediaType = response.headers
            .get("content-type")
            ?.split(";", 1)[0];
          if (mediaType !== "image/png" && mediaType !== "image/jpeg")
            throw new Error("invalid_generated_image_type");
          const bytes = await response.arrayBuffer();
          if (!bytes.byteLength || bytes.byteLength > 5_000_000)
            throw new Error("invalid_generated_image_size");
          const signature = new Uint8Array(
            bytes,
            0,
            Math.min(8, bytes.byteLength),
          );
          const png =
            signature.length === 8 &&
            [137, 80, 78, 71, 13, 10, 26, 10].every(
              (value, index) => signature[index] === value,
            );
          const jpeg = signature[0] === 0xff && signature[1] === 0xd8;
          if (
            (mediaType === "image/png" && !png) ||
            (mediaType === "image/jpeg" && !jpeg)
          )
            throw new Error("invalid_generated_image_bytes");
          const payload: {
            mediaType: "image/png" | "image/jpeg";
            bytes: ArrayBuffer;
          } = { mediaType, bytes };
          imagePayloads.current.set(task.id!, payload);
          if (imagePayloads.current.size > 100)
            imagePayloads.current.delete(
              imagePayloads.current.keys().next().value!,
            );
          deliver(payload);
        })
        .catch((cause) =>
          api("result", {
            id: task.id,
            error:
              cause instanceof Error
                ? cause.message
                : "generated_image_download_failed",
          }).catch((error) => setError(error.message)),
        )
        .finally(() => loadingImages.current.delete(task.id!));
    },
    [api, launch.accessToken, launch.documentId],
  );
  useLayoutEffect(() => {
    if (input.current) {
      input.current.style.height = "0px";
      input.current.style.height = `${Math.min(180, Math.max(64, input.current.scrollHeight))}px`;
    }
  }, [text]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (
        event.data?.type === "spellbook.extension-ready" &&
        event.source &&
        !port.current
      ) {
        const channel = new MessageChannel();
        port.current = channel.port1;
        channel.port1.onmessage = (result) => {
          if (result.data?.type === "ready") {
            setBridgeReady(true);
            sendOffice("Hide_Sidebar");
            return;
          }
          if (typeof result.data?.id === "string")
            void api("result", result.data).catch((e) => setError(e.message));
        };
        (event.source as Window).postMessage(
          { type: "spellbook.connect" },
          origin,
          [channel.port2],
        );
        return;
      }
      if (event.source !== office.current?.contentWindow) return;
      let value;
      try {
        value =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (value?.MessageId === "App_LoadingStatus") {
        sendOffice("Host_PostmessageReady");
        if (value.Values?.Status === "Document_Loaded") setEngineReady(true);
      }
      if (value?.MessageId === "Action_Save_Resp")
        setSaveState(value.Values?.success ? "저장 확인 중…" : "저장 실패");
      if (value?.MessageId === "Doc_ModifiedStatus")
        setSaveState((current) =>
          value.Values?.Modified
            ? "변경 사항 있음"
            : /확인|검사/.test(current)
              ? current
              : "저장됨",
        );
    };
    window.addEventListener("message", onMessage);
    if (!submitted.current) {
      submitted.current = true;
      form.current?.submit();
    }
    return () => window.removeEventListener("message", onMessage);
  }, [origin, api, sendOffice]);
  useEffect(() => {
    if (!engineReady || bridgeReady) return;
    const open = () => {
      // CODE can show a first-run release dialog even when welcome.enable is
      // disabled. Close it through the editor's own message contract so the
      // document canvas, not an upstream product tour, is the first frame.
      sendOffice("welcome-close");
      office.current?.contentWindow?.postMessage(
        { type: "spellbook.open-extension" },
        origin,
      );
    };
    open();
    const timer = setInterval(open, 500);
    return () => clearInterval(timer);
  }, [engineReady, bridgeReady, origin]);
  useEffect(() => {
    if (!bridgeReady) return;
    let stopped = false,
      lastEvent = 0,
      timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const poll = async () => {
      try {
        const response = await api(
          `poll?after=${lastEvent}`,
          undefined,
          abort.signal,
        );
        if (stopped) return;
        if (response.localJob && ai.mode === "local" && aiConnected)
          await dispatchLocalJob(response.localJob);
        saveRevision.current =
          response.session?.saveRevision ?? saveRevision.current;
        if (response.session?.status === "validating")
          setSaveState("저장 검사 중…");
        else if (response.session?.status === "active") {
          setSaveState((current) =>
            ["저장 중…", "저장 확인 중…", "저장 검사 중…"].includes(current)
              ? "저장됨"
              : current,
          );
          if (
            downloadAfterRevision.current !== null &&
            saveRevision.current >= downloadAfterRevision.current
          ) {
            downloadAfterRevision.current = null;
            window.location.assign(
              `${launch.apiBase.replace(/\/native$/, "")}/download`,
            );
          }
        } else if (response.session?.status === "failed") {
          setSaveState("저장 실패");
          setError(
            response.session.error ?? "저장 파일을 검증하지 못했습니다.",
          );
        }
        if (response.task) deliverTask(response.task);
        for (const event of response.events) {
          lastEvent = event.id;
          if (event.type === "start")
            setMessages((items) => {
              const pending = items.at(-1);
              const user: Message = {
                id: -event.id,
                role: "user",
                text: event.text,
                tools: [],
                status: "done",
              };
              return [
                ...items,
                ...(pending?.role === "user" && pending.text === event.text
                  ? []
                  : [user]),
                {
                  id: event.id,
                  role: "assistant",
                  text: "",
                  tools: [],
                  status: "running",
                },
              ];
            });
          else if (event.type === "error") {
            turnRequested.current = false;
            setError(event.error);
            setBusy(false);
            setMessages((items) =>
              items.map((m, i) =>
                i === items.length - 1 ? { ...m, status: "error" } : m,
              ),
            );
          } else if (["delta", "tool", "done"].includes(event.type)) {
            if (event.type === "done") {
              setBusy(false);
              if (event.changed && turnRequested.current) {
                setSaveState("저장 중…");
                sendOffice("Action_Save", {
                  Notify: true,
                  DontSaveIfUnmodified: false,
                });
              }
              turnRequested.current = false;
            }
            setMessages((items) =>
              items.map((m, i) =>
                i !== items.length - 1
                  ? m
                  : event.type === "delta"
                    ? { ...m, text: m.text + event.delta }
                    : event.type === "tool"
                      ? { ...m, tools: [...m.tools, event.label] }
                      : {
                          ...m,
                          text: event.text || m.text,
                          status:
                            event.status === "needs_review" ? "review" : "done",
                        },
              ),
            );
          }
        }
      } catch (e) {
        if (!stopped)
          setError(e instanceof Error ? e.message : "연결을 확인하세요.");
      }
      if (!stopped) timer = setTimeout(poll, 250);
    };
    void poll();
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [
    bridgeReady,
    api,
    deliverTask,
    sendOffice,
    launch.apiBase,
    ai.mode,
    aiConnected,
    dispatchLocalJob,
  ]);
  useEffect(() => () => port.current?.close(), []);
  useEffect(() => {
    if (!aiConnected) setModel(undefined);
  }, [aiConnected]);
  async function submit() {
    if (!text.trim() || busy || !bridgeReady || !aiConnected) return;
    const draft = text;
    turnRequested.current = true;
    setText("");
    setError("");
    setBusy(true);
    setMessages((items) => [
      ...items,
      { id: -Date.now(), role: "user", text: draft, tools: [], status: "done" },
    ]);
    try {
      const submitted = await api("chat", {
        text: draft,
        permission,
        modelSettings: model,
        execution: ai.mode,
      });
      if (submitted.localJob) await dispatchLocalJob(submitted.localJob);
    } catch (e) {
      if (ai.mode === "local") await api("cancel", {}).catch(() => undefined);
      turnRequested.current = false;
      setBusy(false);
      setText(draft);
      setError(e instanceof Error ? e.message : "요청을 보내지 못했습니다.");
    }
  }
  // Collabora runs in an iframe, so these bridge values mirror the semantic
  // tokens in design-system.css rather than relying on inherited CSS vars.
  const theme =
    "--color-primary=#d24726;--color-primary-dark=#b43a20;--color-primary-lighter=#fff2ed;--color-main-text=#11181f;--color-main-background=#fbfcfd;--color-canvas=#e8ecef;--color-border=#d7dce1;--color-toolbar-border=#e4e8ec;--orange1-txt-primary-color=210,71,38";
  return (
    <main className={`native-workspace ${panel ? "with-chat" : ""}`}>
      <header className="native-topbar">
        <a className="native-brand" href="/" aria-label="Spellbook 홈">
          <SpellbookBrand compact />
        </a>
        <span className="native-topbar-divider" />
        <div className="native-file">
          <strong title={launch.fileName}>
            {launch.fileName.replace(/\.pptx$/i, "")}
          </strong>
          <span
            className={`native-save-state ${saveState === "저장 실패" ? "is-error" : ""}`}
            role="status"
          >
            <span aria-hidden="true" />
            {engineReady ? saveState : "문서 여는 중…"}
          </span>
        </div>
        <div className="native-topbar-actions">
          <div className="native-action-group" aria-label="편집 이력과 저장">
            <button
              className="ds-icon-button"
              aria-label="실행 취소"
              title="실행 취소"
              disabled={!engineReady}
              onClick={() =>
                sendOffice("Send_UNO_Command", { Command: ".uno:Undo" })
              }
            >
              <SpellbookIcon name="undo" />
            </button>
            <button
              className="ds-icon-button"
              aria-label="다시 실행"
              title="다시 실행"
              disabled={!engineReady}
              onClick={() =>
                sendOffice("Send_UNO_Command", { Command: ".uno:Redo" })
              }
            >
              <SpellbookIcon name="redo" />
            </button>
            <button
              className="ds-icon-button"
              aria-label="저장"
              title="저장"
              disabled={!engineReady}
              onClick={() => {
                setSaveState("저장 중…");
                sendOffice("Action_Save", {
                  Notify: true,
                  DontSaveIfUnmodified: false,
                });
              }}
            >
              <SpellbookIcon name="save" />
            </button>
          </div>
          <button
            className="ds-button is-secondary is-compact native-download"
            disabled={!engineReady || saveState.endsWith("중…")}
            onClick={() => {
              const downloadUrl = `${launch.apiBase.replace(/\/native$/, "")}/download`;
              if (saveState === "저장됨") {
                window.location.assign(downloadUrl);
                return;
              }
              downloadAfterRevision.current = saveRevision.current + 1;
              setSaveState("다운로드 준비 중…");
              sendOffice("Action_Save", {
                Notify: true,
                DontSaveIfUnmodified: false,
              });
            }}
          >
            <SpellbookIcon name="download" size={16} />
            PPTX 다운로드
          </button>
          <button
            className={`ds-button is-compact native-ai-toggle ${panel ? "active" : ""}`}
            aria-label="AI와 편집"
            aria-expanded={panel}
            onClick={() => setPanel(!panel)}
          >
            <SpellbookIcon name="sparkles" size={16} />
            <span className="native-ai-toggle-label">AI와 편집</span>
          </button>
        </div>
      </header>
      <section className="native-canvas" aria-label="프레젠테이션 편집">
        <form
          ref={form}
          target="spellbook-office"
          method="post"
          action={launch.editorUrl}
          hidden
        >
          <input name="access_token" value={launch.accessToken} readOnly />
          <input name="access_token_ttl" value={launch.expiresAt} readOnly />
          <input name="css_variables" value={theme} readOnly />
          <input
            name="ui_defaults"
            value="UIMode=tabbed;PresentationSidebar=false;"
            readOnly
          />
        </form>
        <iframe
          ref={office}
          name="spellbook-office"
          title="PPT 편집기"
          allow="clipboard-read; clipboard-write"
        />
        {!engineReady ? (
          <div className="native-loading">
            <span className="native-spinner" />
            <strong>프레젠테이션을 열고 있습니다</strong>
            <p>편집할 수 있는 상태로 준비 중입니다.</p>
          </div>
        ) : null}
      </section>
      {panel ? (
        <aside className="native-chat" aria-label="AI 편집 대화">
          <header className="native-chat-header">
            <div className="native-chat-title">
              <span className="native-assistant-mark">
                <SpellbookIcon name="sparkles" size={17} />
              </span>
              <div>
                <strong>AI와 편집</strong>
                <span>
                  {!bridgeReady
                    ? "편집기 연결 중"
                    : ai.status === "loading"
                      ? "AI 연결 확인 중"
                      : aiConnected
                        ? `${ai.runtime?.displayName ?? "AI"} 연결됨`
                        : ai.status === "error"
                          ? "AI 연결 상태 확인 필요"
                          : "AI 연결 필요"}
                </span>
              </div>
            </div>
            <button
              className="ds-icon-button"
              aria-label="AI 대화 접기"
              onClick={() => setPanel(false)}
            >
              <SpellbookIcon name="close" size={18} />
            </button>
          </header>
          <div
            className="native-chat-history"
            role="log"
            aria-label="대화 내용"
          >
            {!aiConnected ? (
              <div className="native-ai-gate">
                <span className="native-ai-gate-mark" aria-hidden="true">
                  <SpellbookIcon name="sparkles" size={22} />
                </span>
                {ai.status === "loading" ? (
                  <>
                    <h1>AI 연결을 확인하고 있습니다</h1>
                    <p>프레젠테이션은 기다리지 않고 바로 편집할 수 있습니다.</p>
                    <span className="ds-spinner" role="status" />
                  </>
                ) : ai.status === "error" ? (
                  <>
                    <h1>AI 연결 상태를 확인하지 못했습니다</h1>
                    <p>
                      직접 편집은 계속 사용할 수 있습니다. 네트워크를 확인한 뒤
                      다시 시도해 주세요.
                    </p>
                    <button
                      className="ds-button is-secondary"
                      type="button"
                      onClick={() => void ai.load()}
                    >
                      연결 상태 다시 확인
                    </button>
                  </>
                ) : ai.deviceLogin ? (
                  <>
                    <p className="ds-kicker">마지막 단계</p>
                    <h1>OpenAI에서 연결을 승인하세요</h1>
                    <p>
                      아래 일회용 코드를 입력하면 이 문서를 다시 열지 않아도 AI
                      편집이 활성화됩니다.
                    </p>
                    <div className="native-device-code">
                      <strong>{ai.deviceLogin.userCode}</strong>
                      <button
                        className="ds-button is-secondary is-compact"
                        type="button"
                        onClick={() => void ai.copyCode()}
                      >
                        {ai.codeCopied ? "복사됨" : "코드 복사"}
                      </button>
                    </div>
                    <a
                      className="ds-button is-primary"
                      href={ai.deviceLogin.verificationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      OpenAI 코드 입력 화면 열기
                      <SpellbookIcon name="arrowRight" size={15} />
                    </a>
                    <p className="native-ai-gate-note" role="status">
                      승인 완료를 기다리고 있습니다…
                    </p>
                  </>
                ) : (
                  <>
                    <h1>AI 편집을 사용하려면 연결이 필요합니다</h1>
                    <p>
                      PPT는 지금 바로 직접 편집할 수 있습니다. ChatGPT 구독을
                      연결하면 같은 화면을 보며 수정하고 결과까지 확인합니다.
                    </p>
                    {ai.message ? (
                      <p className="system-alert is-danger" role="alert">
                        {ai.message}
                      </p>
                    ) : null}
                    <button
                      className="ds-button is-primary"
                      type="button"
                      disabled={ai.connecting}
                      onClick={() => void ai.connect()}
                    >
                      {ai.connecting ? "연결 준비 중…" : "ChatGPT 연결"}
                    </button>
                    <a
                      className="native-security-link"
                      href={CHATGPT_SECURITY_URL}
                      target="_blank"
                      rel="noreferrer"
                      hidden={ai.mode === "local"}
                    >
                      장치 코드 인증을 먼저 켜야 하나요?
                      <SpellbookIcon name="arrowRight" size={14} />
                    </a>
                  </>
                )}
              </div>
            ) : !messages.length ? (
              <div className="native-chat-welcome">
                <h1>어느 부분을 고칠까요?</h1>
                <p>
                  슬라이드에서 직접 수정하거나,
                  <br />
                  바꿀 부분을 선택하고 이야기하세요.
                </p>
                <div className="native-suggestions">
                  {[
                    "선택한 문장을 더 간결하게",
                    "선택한 요소의 위치를 설명해줘",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setText(s);
                        input.current?.focus();
                      }}
                    >
                      {s}
                      <SpellbookIcon name="arrowRight" size={15} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {aiConnected
              ? messages.map((m) => (
                  <article
                    key={m.id}
                    className={`native-chat-message ${m.role}`}
                  >
                    {m.role === "assistant" ? (
                      <div className="native-message-label">
                        <SpellbookIcon name="sparkles" size={15} /> Spellbook
                      </div>
                    ) : null}
                    {m.tools.length ? (
                      <details className="native-tool-history">
                        <summary>
                          {m.status === "running" ? (
                            <span className="native-spinner" />
                          ) : (
                            <span>{m.status === "done" ? "✓" : "!"}</span>
                          )}
                          {m.tools.at(-1)}
                        </summary>
                        <ol>
                          {m.tools.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                    <ReactMarkdown>
                      {normalizeQuotedStrongMarkdown(m.text)}
                    </ReactMarkdown>
                    {m.status === "running" && !m.text && !m.tools.length ? (
                      <span className="native-thinking">
                        슬라이드를 확인하고 있습니다…
                      </span>
                    ) : null}
                    {m.status === "review" ? (
                      <p className="native-warning">
                        변경은 반영됐지만 화면 검증은 완료되지 않았습니다.
                      </p>
                    ) : null}
                  </article>
                ))
              : null}
            <div ref={bottom} />
          </div>
          {aiConnected ? (
            <footer className="native-composer-area">
              {error ? (
                <div className="native-chat-error" role="alert">
                  {error}
                  <button
                    className="ds-icon-button"
                    aria-label="알림 닫기"
                    onClick={() => setError("")}
                  >
                    <SpellbookIcon name="close" size={15} />
                  </button>
                </div>
              ) : null}
              <div className="native-composer">
                <textarea
                  ref={input}
                  aria-label="AI에게 요청"
                  placeholder="이 슬라이드에서 바꿀 내용을 알려주세요"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                />
                <div className="native-composer-controls">
                  <ModelControl
                    value={model}
                    onChange={setModel}
                    disabled={busy}
                    loadModels={loadModels}
                  />
                  {busy ? (
                    <button
                      className="native-send"
                      aria-label="AI 작업 중지"
                      onClick={() =>
                        void api("cancel", {}).catch((e) => setError(e.message))
                      }
                    >
                      <SpellbookIcon name="stop" size={16} />
                    </button>
                  ) : (
                    <button
                      className="native-send"
                      aria-label="메시지 보내기"
                      disabled={!bridgeReady || !text.trim()}
                      onClick={() => void submit()}
                    >
                      <SpellbookIcon name="arrowRight" size={17} />
                    </button>
                  )}
                </div>
              </div>
              <div className="native-context-controls">
                <label className="native-permission">
                  <span>
                    <SpellbookIcon name="shield" size={14} /> AI 편집 범위
                  </span>
                  <select
                    aria-label="AI 편집 범위"
                    value={permission}
                    disabled={busy}
                    onChange={(e) =>
                      setPermission(e.target.value as typeof permission)
                    }
                  >
                    <option value="selection">선택한 요소</option>
                    <option value="slides">현재 슬라이드</option>
                    <option value="read_only">읽기 전용</option>
                    <option value="document">프레젠테이션 전체</option>
                  </select>
                </label>
              </div>
              <p className="native-composer-hint">
                AI의 변경도 편집기에서 되돌릴 수 있습니다.
              </p>
            </footer>
          ) : (
            <footer className="native-connect-footer">
              <SpellbookIcon name="file" size={15} />
              <span>
                AI 연결 전에도 리본과 캔버스의 모든 직접 편집은 가능합니다.
              </span>
            </footer>
          )}
        </aside>
      ) : null}
    </main>
  );
}
