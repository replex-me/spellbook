"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiConnectorConfig } from "@/lib/ai-connector-config";
import { userFacingError } from "@/lib/user-errors";
import { CHATGPT_SECURITY_URL, useAiAccount } from "@/lib/use-ai-account";
import { SpellbookBrand, SpellbookIcon, StatusBadge } from "./spellbook-ui";

interface DocumentRow {
  id: string;
  fileName: string;
  status: string;
  lastError: string | null;
  createdAt: string;
}

export default function Dashboard({
  email,
  aiConnector,
}: {
  email: string;
  aiConnector: AiConnectorConfig;
}) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const {
    account: connectedAi,
    codeCopied,
    connect: connectAccount,
    connecting,
    copyCode: copyDeviceCode,
    deviceLogin,
    disconnect: disconnectAccount,
    message: connectionMessage,
    mode: aiMode,
  } = useAiAccount(aiConnector);

  const loadDocuments = useCallback(async () => {
    const response = await fetch("/api/documents", { cache: "no-store" });
    if (response.ok) {
      const value = (await response.json()) as { documents: DocumentRow[] };
      setDocuments(value.documents);
    }
    setLoading(false);
  }, []);

  const wakeOfficeEditor = useCallback(() => {
    void fetch("/api/office/warm", {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      // Opening a document retains its existing retry path if prewarming fails.
    });
  }, []);

  useEffect(() => {
    void loadDocuments();
    wakeOfficeEditor();
  }, [loadDocuments, wakeOfficeEditor]);

  async function upload(file: File) {
    setDragging(false);
    if (!file.name.toLowerCase().endsWith(".pptx")) {
      setUploadMessage("PowerPoint PPTX 파일을 선택해 주세요.");
      return;
    }
    setUploading(true);
    setUploadMessage("");
    wakeOfficeEditor();
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/documents", {
      method: "POST",
      body: form,
    });
    const body = (await response.json()) as { id?: string; error?: string };
    setUploading(false);
    if (!response.ok || !body.id) {
      setUploadMessage(userFacingError(body.error, "업로드하지 못했습니다."));
      return;
    }
    window.location.href = `/documents/${body.id}`;
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-appbar">
        <Link href="/" aria-label="Spellbook 홈">
          <SpellbookBrand />
        </Link>
        <nav className="dashboard-account" aria-label="계정">
          <span>{email}</span>
          <a className="ds-button is-quiet is-compact" href="/auth/logout">
            <SpellbookIcon name="logout" size={16} />
            로그아웃
          </a>
        </nav>
      </header>

      <div className="dashboard-content">
        <header className="dashboard-heading">
          <div>
            <p className="ds-kicker">WORKSPACE</p>
            <h1>보이는 그대로 열고, 필요한 것만 고칩니다.</h1>
            <p>
              원본 PPTX를 실제 편집 화면에서 열고, 직접 또는 AI와 함께
              수정합니다.
            </p>
          </div>
          <button
            className="ds-button is-primary dashboard-upload-button"
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            <SpellbookIcon name="upload" />
            {uploading ? "업로드 중…" : "PPTX 업로드"}
          </button>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </header>

        <section className="dashboard-start-grid" aria-label="새 작업 시작">
          <button
            type="button"
            className={`upload-dropzone ds-card ${dragging ? "is-dragging" : ""}`}
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) void upload(file);
            }}
          >
            <span className="upload-dropzone-icon">
              <SpellbookIcon name="upload" size={22} />
            </span>
            <span className="upload-dropzone-copy">
              <strong>기존 PowerPoint를 그대로 엽니다</strong>
              <span>여기에 PPTX를 놓거나 눌러서 선택하세요 · 최대 50MB</span>
            </span>
            <span className="upload-dropzone-action">파일 선택</span>
          </button>

          <aside className="ai-account-card ds-card">
            <header>
              <span className="ai-account-icon">
                <SpellbookIcon name="sparkles" />
              </span>
              <div>
                <strong>내 AI 연결</strong>
                <p>Codex 또는 Claude Code 구독을 사용합니다.</p>
              </div>
              <StatusBadge tone={connectedAi ? "success" : "neutral"}>
                {connectedAi ? "연결됨" : "연결 안 됨"}
              </StatusBadge>
            </header>

            {connectedAi ? (
              <div className="ai-account-connected">
                <div>
                  <strong>
                    {connectedAi.email ??
                      (connectedAi.type === "claude"
                        ? "Claude 계정"
                        : "ChatGPT 계정")}
                  </strong>
                  <span>플랜: {connectedAi.planType ?? "확인 불가"}</span>
                </div>
                <button
                  className="ds-button is-quiet is-danger is-compact"
                  type="button"
                  onClick={() => void disconnectAccount()}
                >
                  연결 해제
                </button>
              </div>
            ) : deviceLogin ? (
              <div className="device-connect-panel">
                <div>
                  <p className="ds-kicker">마지막 단계</p>
                  <h2>OpenAI에서 연결을 승인하세요</h2>
                  <p>아래 일회용 코드를 OpenAI 인증 화면에 입력하세요.</p>
                </div>
                <div className="device-code-row">
                  <strong>{deviceLogin.userCode}</strong>
                  <button
                    className="ds-button is-secondary is-compact"
                    type="button"
                    onClick={() => void copyDeviceCode()}
                  >
                    {codeCopied ? (
                      <SpellbookIcon name="check" size={16} />
                    ) : null}
                    {codeCopied ? "복사됨" : "코드 복사"}
                  </button>
                </div>
                <div className="device-connect-actions">
                  <a
                    className="ds-button is-primary"
                    href={deviceLogin.verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    코드 입력 화면 열기
                    <SpellbookIcon name="arrowRight" />
                  </a>
                  <button
                    className="ds-button is-quiet"
                    type="button"
                    onClick={() => void connectAccount()}
                    disabled={connecting}
                  >
                    새 코드 받기
                  </button>
                </div>
                <small>
                  로그인은 OpenAI 화면에서 진행됩니다. Spellbook는 비밀번호를
                  받지 않습니다.
                </small>
              </div>
            ) : (
              <div className="ai-account-setup">
                <ol>
                  <li>
                    <span>1</span>
                    <div>
                      <strong>
                        {aiMode === "local"
                          ? "이 컴퓨터에서 안전하게 연결합니다"
                          : "처음 한 번만 연결을 허용하세요"}
                      </strong>
                      {aiMode === "local" ? (
                        <p>
                          로그인과 문서 편집 도구는 이 컴퓨터의 연결 앱에서
                          실행됩니다.
                        </p>
                      ) : (
                        <>
                          <p>
                            OpenAI 보안 설정에서 ‘Codex용 장치 코드 인증’을
                            켭니다.
                          </p>
                          <a
                            href={CHATGPT_SECURITY_URL}
                            target="_blank"
                            rel="noreferrer"
                          >
                            OpenAI 보안 설정 열기
                            <SpellbookIcon name="arrowRight" size={14} />
                          </a>
                        </>
                      )}
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>
                        {aiMode === "local"
                          ? "별도 창에서 연결을 허용하세요"
                          : "Spellbook로 돌아와 연결하세요"}
                      </strong>
                      <p>
                        {aiMode === "local"
                          ? "허용 후 Codex 또는 이 컴퓨터에 로그인된 Claude Code를 선택할 수 있습니다. 비밀번호와 구독 토큰은 Spellbook 서버로 전송되지 않습니다."
                          : "일회용 코드를 받아 OpenAI 화면에서 승인합니다."}
                      </p>
                    </div>
                  </li>
                </ol>
                {connectionMessage ? (
                  <p className="system-alert is-danger" role="alert">
                    {connectionMessage}
                  </p>
                ) : null}
                <button
                  className="ds-button is-secondary"
                  type="button"
                  onClick={() => void connectAccount()}
                  disabled={connecting}
                >
                  {connecting
                      ? "연결 준비 중…"
                      : aiMode === "local"
                      ? "내 AI 구독 연결"
                      : "설정을 켰어요 · 연결 계속"}
                </button>
              </div>
            )}
          </aside>
        </section>

        {uploadMessage ? (
          <p className="system-alert is-danger dashboard-alert" role="alert">
            {uploadMessage}
          </p>
        ) : null}

        <section className="document-library ds-card">
          <header>
            <div>
              <h2>최근 프레젠테이션</h2>
              <p>마지막으로 업로드한 순서입니다.</p>
            </div>
            <span>{documents.length}개</span>
          </header>
          {loading ? (
            <div className="library-empty" role="status">
              <span className="ds-spinner" />
              파일을 불러오는 중입니다
            </div>
          ) : documents.length === 0 ? (
            <div className="library-empty">
              <span className="library-empty-icon">
                <SpellbookIcon name="file" size={22} />
              </span>
              <strong>아직 프레젠테이션이 없습니다</strong>
              <p>첫 PPTX를 올리면 원본 검사 후 실제 편집 화면으로 엽니다.</p>
            </div>
          ) : (
            <div className="document-list" role="list">
              {documents.map((document) => (
                <Link
                  className="document-row"
                  key={document.id}
                  href={`/documents/${document.id}`}
                  role="listitem"
                >
                  <span className="powerpoint-file-icon" aria-hidden="true">
                    P
                  </span>
                  <span className="document-details">
                    <strong>{document.fileName}</strong>
                    <span>
                      {new Date(document.createdAt).toLocaleString("ko-KR")}
                    </span>
                    {document.lastError ? (
                      <em>
                        {userFacingError(
                          document.lastError,
                          "문서를 준비하지 못했습니다.",
                        )}
                      </em>
                    ) : null}
                  </span>
                  <StatusBadge tone={statusTone(document.status)}>
                    {statusLabel(document.status)}
                  </StatusBadge>
                  <SpellbookIcon name="arrowRight" size={17} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <details className="support-disclosure ds-card">
          <summary>
            <span>
              <SpellbookIcon name="shield" />
              <strong>현재 안전하게 편집하는 범위</strong>
            </span>
            <SpellbookIcon name="chevronDown" />
          </summary>
          <div className="support-grid">
            <div>
              <strong>슬라이드와 기본 요소</strong>
              <p>
                슬라이드 추가·복제·삭제·순서 변경, 텍스트·도형 생성과 서식·배치
                수정
              </p>
            </div>
            <div>
              <strong>그림·표·그룹</strong>
              <p>
                이미지 첨부·교체·자르기, 표 생성·셀 수정, 그룹화·해제와
                자리표시자 편집
              </p>
            </div>
            <div>
              <strong>보존 우선 항목</strong>
              <p>
                차트·SmartArt·OLE 내부 데이터와 복잡한 효과는 안전하게 보존할 수
                없는 변경을 차단합니다.
              </p>
            </div>
          </div>
        </details>
      </div>
    </main>
  );
}

function statusLabel(status: string) {
  return (
    (
      {
        processing: "렌더링 중",
        ready: "준비됨",
        editing: "AI 수정 중",
        candidate_ready: "검토 대기",
        failed: "처리 실패",
      } as Record<string, string>
    )[status] ?? status
  );
}

function statusTone(
  status: string,
): "neutral" | "success" | "progress" | "warning" | "danger" {
  if (status === "ready") return "success";
  if (status === "failed") return "danger";
  if (status === "candidate_ready") return "warning";
  if (status === "processing" || status === "editing") return "progress";
  return "neutral";
}
