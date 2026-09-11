"use client";
import { useEffect, useState } from "react";
import type { AiPermission } from "@/lib/ai-permissions";

const labels = {
  read_only: "보기·대화만",
  selection: "선택 범위 편집",
  slides: "지정 슬라이드 편집",
  document: "문서 전체 편집",
};
export function PermissionControl({
  permission,
  activeSlide,
  disabled,
  onChange,
}: {
  permission: AiPermission;
  activeSlide: number;
  disabled: boolean;
  onChange: (input: { permission: AiPermission }) => Promise<void>;
}) {
  const [mode, setMode] = useState(permission.mode);
  const [pages, setPages] = useState("");
  useEffect(() => {
    setMode(permission.mode);
    setPages(
      (permission.slideIndexes.length ? permission.slideIndexes : [activeSlide])
        .map((index) => index + 1)
        .join(", "),
    );
  }, [permission.mode, permission.slideIndexes.join(","), activeSlide]);
  return (
    <details className="permission-control">
      <summary>
        AI 권한 · {labels[permission.mode]}
        {permission.mode === "slides"
          ? permission.slideIndexes.length
            ? ` (${permission.slideIndexes.map((index) => index + 1).join(", ")}번)`
            : " (허용된 슬라이드 없음)"
          : ""}
      </summary>
      <label>
        허용 범위
        <select
          aria-label="AI 편집 권한"
          value={mode}
          onChange={(event) =>
            setMode(event.target.value as AiPermission["mode"])
          }
          disabled={disabled}
        >
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {mode === "slides" && (
        <label>
          슬라이드 번호
          <input
            aria-label="편집 허용 슬라이드 번호"
            value={pages}
            onChange={(event) => setPages(event.target.value)}
            placeholder="예: 1, 3, 5"
          />
        </label>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          void onChange({
            permission: {
              mode,
              slideIndexes:
                mode === "slides"
                  ? pages.split(",").map((page) => Number(page.trim()) - 1)
                  : [],
            },
          })
        }
      >
        권한 적용
      </button>
      <p>
        이후 편집 요청부터 적용됩니다. 이미 실행 중인 수정은 중단 버튼으로
        멈추세요. 원본과 승인본은 유지됩니다.
      </p>
    </details>
  );
}
