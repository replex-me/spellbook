"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import { normalizeQuotedStrongMarkdown } from "@/lib/markdown";
import { ChatIcon } from "./chat-icon";

function CopyMessage({ content }: { content: string }) {
  const [status, setStatus] = useState("답변 복사");
  useEffect(() => {
    if (status === "답변 복사") return;
    const timer = setTimeout(() => setStatus("답변 복사"), 2500);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <button
      type="button"
      className="message-copy"
      aria-label={status}
      title={status}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content);
          setStatus("복사됨");
        } catch {
          setStatus("복사 실패 · 텍스트를 선택해 복사하세요");
        }
      }}
    >
      <ChatIcon name={status === "복사됨" ? "check" : "copy"} />
      <span role="status">{status === "답변 복사" ? "" : status}</span>
    </button>
  );
}

interface Message {
  id: string;
  editRequestId: string;
  role: string;
  content: string;
  status: string;
  metadata?: { permission?: { mode: string; slideIndexes: number[] } };
}
interface Turn {
  id: string;
  requestText: string;
  assistantMessage?: string | null;
  resultSummary: string | null;
  status: string;
}

export function ConversationTimeline({
  documentId,
  busy,
  busyLabel = "Codex가 작업 중입니다",
  history,
  children,
  onRecover,
  resultEditId,
  onPermission,
  changingPermission,
}: {
  documentId: string;
  busy: boolean;
  busyLabel?: string;
  history: Turn[];
  children: ReactNode;
  onRecover: (text: string) => void;
  resultEditId?: string;
  onPermission: (input: {
    messageId: string;
    decision: string;
  }) => Promise<void>;
  changingPermission: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [offline, setOffline] = useState(false);
  const [aboveLatest, setAboveLatest] = useState(false);
  const pane = useRef<HTMLElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const element = pane.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/documents/${documentId}/conversation`,
          { cache: "no-store", signal: abort.signal },
        );
        if (!response.ok) throw new Error("conversation_unavailable");
        const body = await response.json();
        if (!Array.isArray(body.messages))
          throw new Error("invalid_conversation");
        setMessages(body.messages);
        setOffline(false);
      } catch {
        if (!abort.signal.aborted) setOffline(true);
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(load, busy ? 800 : 4000);
      }
    };
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [documentId, busy, history.length]);
  useEffect(() => {
    if (follow.current && pane.current)
      pane.current.scrollTop = pane.current.scrollHeight;
  }, [messages, history, children]);
  const represented = new Set(messages.map((message) => message.editRequestId));
  const legacy = [...history]
    .reverse()
    .filter((turn) => !represented.has(turn.id));
  const resultIndex = messages.reduce(
    (last, message, index) =>
      message.editRequestId === resultEditId ? index : last,
    -1,
  );
  return (
    <div className="conversation-scroll-shell">
      <section
        ref={pane}
        className="conversation-history"
        aria-label="대화 이력"
        onScroll={() => {
          const element = pane.current;
          if (element) {
            follow.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              70;
            setAboveLatest(!follow.current);
          }
        }}
      >
        {offline && (
          <p className="conversation-connection" role="status">
            대화 연결 재시도 중 · 마지막 기록을 표시합니다.
          </p>
        )}
        {!messages.length && !history.length && (
          <div className="conversation-empty">
            <h2>PPT를 함께 보며 이야기하세요</h2>
            <p>
              내용을 물어보거나 원하는 수정을 말해주세요. 특정 부분을 선택하면
              그 부분을 함께 봅니다.
            </p>
            <div className="conversation-starters">
              {[
                "이 슬라이드의 핵심 내용을 설명해줘",
                "제목을 더 간결하게 다듬어줘",
              ].map((text) => (
                <button
                  type="button"
                  key={text}
                  onClick={() => onRecover(text)}
                >
                  {text}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {legacy.map((turn) => (
          <div key={turn.id} className="conversation-turn">
            <article className="chat-message user">
              <small>나</small>
              <p>{turn.requestText}</p>
            </article>
            {(turn.resultSummary || turn.assistantMessage) && (
              <article className="chat-message assistant">
                <small>Codex</small>
                <Markdown
                  skipHtml
                  components={{
                    img: () => null,
                    a: ({ children }) => <span>{children}</span>,
                  }}
                >
                  {normalizeQuotedStrongMarkdown(
                    turn.resultSummary ?? turn.assistantMessage ?? "",
                  )}
                </Markdown>
                <CopyMessage
                  content={turn.resultSummary ?? turn.assistantMessage ?? ""}
                />
              </article>
            )}
            {turn.id === resultEditId ? children : null}
          </div>
        ))}
        {messages.map((message, index) => {
          // Collapse only successful tool records, never permission requests or failures.
          const completedTool = (item: Message | undefined) =>
            item?.role === "tool" &&
            item.status === "completed" &&
            item.editRequestId === message.editRequestId;
          if (completedTool(message)) {
            if (completedTool(messages[index - 1])) return null;
            let end = index + 1;
            while (completedTool(messages[end])) end++;
            return (
              <Fragment key={message.id}>
                <details className="tool-activity">
                  <summary>
                    <ChatIcon name="check" />
                    작업 기록 {end - index}개
                    <span className="activity-chevron" aria-hidden="true">
                      ⌄
                    </span>
                  </summary>
                  <div>
                    {messages.slice(index, end).map((item) => (
                      <p key={item.id}>{item.content}</p>
                    ))}
                  </div>
                </details>
                {resultIndex >= index && resultIndex < end ? children : null}
              </Fragment>
            );
          }
          return (
            <Fragment key={message.id}>
              <article
                key={message.id}
                className={`chat-message ${message.role}`}
                data-status={message.status}
              >
                {message.role === "tool" ? (
                  <p>
                    <span aria-hidden="true">
                      {message.status === "streaming"
                        ? "◌"
                        : message.status === "completed"
                          ? "✓"
                          : "!"}
                    </span>{" "}
                    {message.content}
                  </p>
                ) : (
                  <>
                    <small>{message.role === "user" ? "나" : "Codex"}</small>
                    {message.role === "assistant" ? (
                      <Markdown
                        skipHtml
                        components={{
                          img: () => null,
                          a: ({ children }) => <span>{children}</span>,
                        }}
                      >
                        {normalizeQuotedStrongMarkdown(message.content)}
                      </Markdown>
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </>
                )}
                {message.status === "queued" && (
                  <small>추가 지시 전달 대기</small>
                )}
                {message.status === "delivering" && (
                  <small>추가 지시 전달 중</small>
                )}
                {message.status === "accepted" && (
                  <small>진행 중인 작업에 전달됨</small>
                )}
                {["not_delivered", "delivery_unknown"].includes(
                  message.status,
                ) && (
                  <div className="message-recovery">
                    <small>
                      {message.status === "delivery_unknown"
                        ? "작업이 끝나 전달 여부를 확인하지 못했습니다."
                        : "작업이 끝나 이 지시는 전달되지 않았습니다."}
                    </small>
                    <button
                      type="button"
                      onClick={() => onRecover(message.content)}
                    >
                      입력창으로 가져오기
                    </button>
                  </div>
                )}
                {message.status === "interrupted" && <small>중단됨</small>}
                {message.status === "permission_pending" && (
                  <div className="permission-request">
                    <strong>편집 권한 요청</strong>
                    <p>
                      {message.metadata?.permission?.mode === "document"
                        ? "문서 전체"
                        : `${message.metadata?.permission?.slideIndexes.map((index) => index + 1).join(", ")}번 슬라이드`}{" "}
                      편집 허용
                    </p>
                    <button
                      type="button"
                      disabled={changingPermission}
                      onClick={() =>
                        void onPermission({
                          messageId: message.id,
                          decision: "grant",
                        })
                      }
                    >
                      이 범위 편집 허용
                    </button>
                    <button
                      type="button"
                      disabled={changingPermission}
                      onClick={() =>
                        void onPermission({
                          messageId: message.id,
                          decision: "deny",
                        })
                      }
                    >
                      허용하지 않기
                    </button>
                  </div>
                )}
                {message.status === "permission_granted" && (
                  <small>사용자가 편집 권한을 허용했습니다.</small>
                )}
                {message.status === "permission_denied" && (
                  <small>사용자가 편집 권한을 허용하지 않았습니다.</small>
                )}
                {message.status === "permission_cancelled" && (
                  <small>작업이 중단되어 권한 요청이 취소됐습니다.</small>
                )}
                {message.role === "assistant" &&
                  message.status === "completed" &&
                  message.content && <CopyMessage content={message.content} />}
              </article>
              {index === resultIndex ? children : null}
            </Fragment>
          );
        })}
        {busy && (
          <p className="agent-working" role="status">
            <span className="working-dot" />
            {busyLabel}
          </p>
        )}
        {resultIndex < 0 && !legacy.some((turn) => turn.id === resultEditId)
          ? children
          : null}
      </section>
      {aboveLatest && (
        <button
          type="button"
          className="jump-to-latest"
          onClick={() => {
            follow.current = true;
            if (pane.current)
              pane.current.scrollTop = pane.current.scrollHeight;
            setAboveLatest(false);
          }}
        >
          <ChatIcon name="down" />
          최신 메시지
        </button>
      )}
    </div>
  );
}
