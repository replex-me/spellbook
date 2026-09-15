"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { NativeWorkspace, type NativeLaunch } from "./native-workspace";
import { SpellbookBrand, SpellbookIcon } from "./spellbook-ui";
import "./native-document.css";

type LaunchPhase = "checking" | "starting" | "slow" | "failed";

const launchErrors: Record<string, string> = {
  document_not_found:
    "파일을 찾을 수 없습니다. 파일 목록에서 다시 열어 주세요.",
  document_processing_failed:
    "이 PPTX를 편집 가능한 상태로 만들지 못했습니다. 파일 목록에서 오류를 확인하거나 다시 업로드해 주세요.",
  browser_office_not_configured:
    "브라우저 편집기 배포 설정이 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.",
};

export default function NativeDocument({
  documentId,
  launchMode,
}: {
  documentId: string;
  launchMode: "wopi" | "browser";
}) {
  const [launch, setLaunch] = useState<NativeLaunch | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<LaunchPhase>("checking");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const response = await fetch(
        `/api/documents/${documentId}/${launchMode === "browser" ? "browser" : "native"}/launch`,
        {
          method: launchMode === "browser" ? "POST" : "GET",
          cache: "no-store",
          signal,
        },
      );
      const value = (await response.json()) as NativeLaunch & {
        error?: string;
      };
      if (response.ok) {
        setLaunch(value);
        setError("");
        return "ready" as const;
      }
      if (
        response.status === 409 &&
        ["document_processing", "document_not_ready"].includes(
          value.error ?? "",
        )
      ) {
        setPhase("checking");
        return "retry" as const;
      }
      if (response.status === 503 && value.error === "office_editor_starting") {
        setPhase("starting");
        return "retry" as const;
      }
      setPhase("failed");
      setError(
        launchErrors[value.error ?? ""] ??
          "편집 화면에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
      return "failed" as const;
    },
    [documentId, launchMode],
  );
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        if (
          (await load(controller.signal)) === "retry" &&
          !controller.signal.aborted
        )
          timer = setTimeout(check, 2_000);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setPhase("failed");
          setError(
            caught instanceof TypeError
              ? "네트워크 연결을 확인한 뒤 다시 시도해 주세요."
              : "편집 화면에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          );
        }
      }
    };
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load, attempt]);
  useEffect(() => {
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
    return () => clearInterval(timer);
  }, [attempt]);
  if (launch) return <NativeWorkspace launch={launch} />;
  const isSlow = !error && elapsedSeconds >= 70;
  const displayPhase: LaunchPhase = error
    ? "failed"
    : isSlow
      ? "slow"
      : phase === "starting" || elapsedSeconds >= 8
        ? "starting"
        : "checking";
  const copy = {
    checking: {
      title: "편집기를 준비하고 있습니다",
      description: "PPTX 원본과 편집 가능 여부를 확인하고 있습니다.",
    },
    starting: {
      title: "웹 편집기를 시작하고 있습니다",
      description:
        phase === "starting"
          ? "파일 준비는 끝났습니다. 처음 여는 경우 편집기 서버가 깨어나는 데 최대 1분 정도 걸릴 수 있습니다."
          : "PPTX 확인을 마치는 대로 웹 편집기를 엽니다. 처음 여는 경우 전체 준비에 최대 1분 정도 걸릴 수 있습니다.",
    },
    slow: {
      title: "편집기 연결이 평소보다 오래 걸리고 있습니다",
      description:
        "파일은 그대로 보존되어 있으며 연결을 계속 시도하고 있습니다. 원하면 지금 다시 시도할 수 있습니다.",
    },
    failed: {
      title: "프레젠테이션을 열지 못했습니다",
      description: error,
    },
  }[displayPhase];
  const retry = () => {
    setError("");
    setPhase("checking");
    setAttempt((value) => value + 1);
  };
  return (
    <main className="native-document-state">
      <header>
        <Link href="/" aria-label="Spellbook 홈">
          <SpellbookBrand compact />
        </Link>
        <span className="native-state-file">프레젠테이션 여는 중</span>
      </header>
      <section>
        <div className="native-state-card ds-card">
          <span
            className={`native-state-symbol ${displayPhase === "failed" ? "is-error" : ""}`}
            aria-hidden="true"
          >
            {displayPhase === "failed" ? (
              "!"
            ) : (
              <span className="native-state-spinner" />
            )}
          </span>
          <p className="ds-kicker">POWERPOINT WORKSPACE</p>
          <h1 aria-live="polite" aria-atomic="true">
            {copy.title}
          </h1>
          <p>{copy.description}</p>
          {!error ? (
            <ol className="native-state-progress" aria-label="편집기 준비 상태">
              <li className="is-active">
                <span>
                  <SpellbookIcon name="check" size={13} />
                </span>
                원본 확인
              </li>
              <li className={displayPhase !== "checking" ? "is-active" : ""}>
                <span>2</span>
                편집기 시작
              </li>
              <li>
                <span>3</span>
                편집 화면 열기
              </li>
            </ol>
          ) : null}
          {elapsedSeconds >= 10 && !error ? (
            <small>준비한 지 {elapsedSeconds}초</small>
          ) : null}
          {error || isSlow ? (
            <div className="native-state-actions">
              <button className="ds-button is-primary" onClick={retry}>
                다시 시도
              </button>
              <Link className="ds-button is-secondary" href="/">
                파일 목록
              </Link>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
