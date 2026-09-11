"use client";

import { useState } from "react";
import type { ElementGraph, ElementNode, SlideGraph } from "@/lib/models";
import { cmToEmu, emuToCm, supportsManualOperation } from "@/lib/manual-tools";
import { uploadImageAsset } from "@/lib/upload-image";

type Command = Record<string, unknown>;
export function DirectEditTools({
  documentId,
  graph,
  slide,
  selected,
  disabled,
  reason,
  onSelect,
  onApply,
}: {
  documentId: string;
  graph: ElementGraph;
  slide: SlideGraph;
  selected: ElementNode[];
  disabled: boolean;
  reason: string;
  onSelect: (element: ElementNode) => void;
  onApply: (summary: string, commands: Command[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const targets = selected.map((element) => target(slide, element));
  const baseBox = {
    slideIndex: slide.slideIndex,
    x: Math.round(graph.slideWidthEmu * 0.1),
    y: Math.round(graph.slideHeightEmu * 0.1),
    width: Math.round(graph.slideWidthEmu * 0.4),
    height: Math.round(graph.slideHeightEmu * 0.2),
  };
  async function apply(summary: string, commands: Command[]) {
    setError("");
    try {
      if (
        commands.some(
          (command) =>
            Array.isArray(command.targets) && command.targets.length > 12,
        )
      )
        throw new Error("함께 편집할 요소는 최대 12개까지 선택하세요.");
      await onApply(summary, commands);
    } catch (error) {
      setError(error instanceof Error ? error.message : "저장하지 못했습니다.");
    }
  }
  return (
    <div className="direct-tools">
      <div className="canvas-toolbar" role="toolbar" aria-label="PPT 직접 편집">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "편집 도구 닫기" : "직접 편집"}
          {selected.length ? ` · ${selected.length}개 선택` : ""}
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void apply("텍스트 상자 추가", [
              { op: "add_text_box", ...baseBox, text: "텍스트를 입력하세요" },
            ])
          }
        >
          ＋ 텍스트
        </button>
        <details>
          <summary>삽입 ⌄</summary>
          <div className="toolbar-menu">
            <ImageAction
              label="이미지 삽입"
              documentId={documentId}
              disabled={disabled}
              onImage={async (asset) => {
                const width = baseBox.width;
                const height = Math.round((width * asset.height) / asset.width);
                const scale = Math.min(
                  1,
                  (graph.slideHeightEmu * 0.7) / height,
                );
                await apply("이미지 삽입", [
                  {
                    op: "add_image",
                    ...baseBox,
                    width: Math.round(width * scale),
                    height: Math.round(height * scale),
                    assetId: asset.assetId,
                  },
                ]);
              }}
            />
            <strong>도형</strong>
            <div className="tool-grid">
              {[
                ["rect", "사각형"],
                ["roundRect", "둥근 사각형"],
                ["ellipse", "원"],
                ["triangle", "삼각형"],
                ["diamond", "마름모"],
                ["chevron", "갈매기형"],
                ["rightArrow", "화살표"],
                ["line", "선"],
              ].map(([geometry, label]) => (
                <button
                  type="button"
                  key={geometry}
                  disabled={disabled}
                  onClick={() =>
                    void apply(`${label} 추가`, [
                      { op: "add_shape", ...baseBox, geometry, rgb: "64748B" },
                    ])
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void apply("표 추가", [
                  {
                    op: "add_table",
                    ...baseBox,
                    rows: [
                      ["제목", "내용"],
                      ["항목", "값"],
                    ],
                  },
                ])
              }
            >
              2 × 2 표
            </button>
          </div>
        </details>
        <details>
          <summary>슬라이드 ⌄</summary>
          <div className="toolbar-menu">
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void apply("슬라이드 추가", [
                  {
                    op: "add_slide",
                    templateSlideIndex: slide.slideIndex,
                    insertIndex: slide.slideIndex + 1,
                  },
                ])
              }
            >
              현재 레이아웃으로 새 슬라이드
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void apply("슬라이드 복제", [
                  {
                    op: "duplicate_slide",
                    slideIndex: slide.slideIndex,
                    insertIndex: slide.slideIndex + 1,
                  },
                ])
              }
            >
              슬라이드 복제
            </button>
            <button
              type="button"
              disabled={disabled || slide.slideIndex === 0}
              onClick={() =>
                void apply("슬라이드 앞으로 이동", [
                  {
                    op: "move_slide",
                    slideIndex: slide.slideIndex,
                    insertIndex: slide.slideIndex - 1,
                  },
                ])
              }
            >
              앞으로 이동
            </button>
            <button
              type="button"
              disabled={
                disabled || slide.slideIndex === graph.slides.length - 1
              }
              onClick={() =>
                void apply("슬라이드 뒤로 이동", [
                  {
                    op: "move_slide",
                    slideIndex: slide.slideIndex,
                    insertIndex: slide.slideIndex + 1,
                  },
                ])
              }
            >
              뒤로 이동
            </button>
            <button
              type="button"
              disabled={disabled || graph.slides.length === 1}
              onClick={() => {
                if (
                  window.confirm(
                    `${slide.slideIndex + 1}번 슬라이드를 삭제할까요? 저장 후 되돌릴 수 있습니다.`,
                  )
                )
                  void apply("슬라이드 삭제", [
                    { op: "delete_slide", slideIndex: slide.slideIndex },
                  ]);
              }}
            >
              슬라이드 삭제
            </button>
            <ColorAction
              label="배경 색"
              disabled={disabled}
              onApply={(rgb) =>
                apply("배경 색 변경", [
                  { op: "set_background", slideIndex: slide.slideIndex, rgb },
                ])
              }
            />
          </div>
        </details>
        <span className="toolbar-hint">
          {disabled ? reason : "직접 수정 · 자동 저장"}
        </span>
      </div>
      {open ? (
        <section className="object-inspector" aria-label="선택 요소 편집">
          <div className="object-list">
            <strong>이 슬라이드의 요소</strong>
            {slide.elements.length ? (
              [...slide.elements]
                .sort((a, b) => b.zIndex - a.zIndex)
                .map((element) => (
                  <button
                    key={element.elementId}
                    type="button"
                    aria-pressed={selected.some(
                      (item) => item.elementId === element.elementId,
                    )}
                    onClick={() => onSelect(element)}
                    title={element.unsupportedReason ?? element.name}
                  >
                    {element.name || element.kind}
                    <small>
                      {element.editable ? element.kind : "보기 전용"}
                    </small>
                  </button>
                ))
            ) : (
              <p>텍스트나 도형을 추가해 시작하세요.</p>
            )}
          </div>
          <div className="object-properties">
            {selected.length === 1 ? (
              <ObjectProperties
                documentId={documentId}
                key={`${selected[0].elementId}:${selected[0].sourceHash}`}
                element={selected[0]}
                slide={slide}
                disabled={disabled}
                onApply={apply}
              />
            ) : selected.length > 1 ? (
              <>
                <strong>{selected.length}개 요소 함께 편집</strong>
                <div className="tool-grid">
                  {[
                    ["left", "왼쪽 정렬"],
                    ["center", "가로 가운데"],
                    ["right", "오른쪽 정렬"],
                    ["top", "위쪽 정렬"],
                    ["middle", "세로 가운데"],
                    ["bottom", "아래쪽 정렬"],
                  ].map(([alignment, label]) => (
                    <button
                      type="button"
                      key={alignment}
                      disabled={disabled}
                      onClick={() =>
                        void apply(label, [
                          { op: "align_shapes", targets, alignment },
                        ])
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="tool-grid">
                  <button
                    type="button"
                    disabled={disabled || selected.length < 3}
                    onClick={() =>
                      void apply("가로 간격 분배", [
                        {
                          op: "distribute_shapes",
                          targets,
                          axis: "horizontal",
                        },
                      ])
                    }
                  >
                    가로 간격 동일하게
                  </button>
                  <button
                    type="button"
                    disabled={disabled || selected.length < 3}
                    onClick={() =>
                      void apply("세로 간격 분배", [
                        { op: "distribute_shapes", targets, axis: "vertical" },
                      ])
                    }
                  >
                    세로 간격 동일하게
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      void apply("요소 그룹화", [
                        { op: "group_shapes", targets },
                      ])
                    }
                  >
                    그룹화
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">
                화면이나 요소 목록에서 선택하세요. 겹쳐 있는 요소도 목록에서
                고를 수 있습니다.
              </p>
            )}
          </div>
        </section>
      ) : null}
      {error ? (
        <p className="error-banner compact" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function target(slide: SlideGraph, element: ElementNode) {
  return {
    slideIndex: slide.slideIndex,
    elementId: element.elementId,
    sourceHash: element.sourceHash,
  };
}
function ColorAction({
  label,
  disabled,
  onApply,
}: {
  label: string;
  disabled: boolean;
  onApply: (rgb: string) => Promise<void>;
}) {
  const [color, setColor] = useState("#64748b");
  return (
    <div className="color-action">
      <label>
        {label}
        <input
          type="color"
          value={color}
          disabled={disabled}
          onChange={(event) => setColor(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void onApply(color.slice(1))}
      >
        적용
      </button>
    </div>
  );
}
function ObjectProperties({
  documentId,
  element,
  slide,
  disabled,
  onApply,
}: {
  documentId: string;
  element: ElementNode;
  slide: SlideGraph;
  disabled: boolean;
  onApply: (summary: string, commands: Command[]) => Promise<void>;
}) {
  const [text, setText] = useState(element.text ?? "");
  const [position, setPosition] = useState({
    x: emuToCm(element.x),
    y: emuToCm(element.y),
    width: emuToCm(element.width),
    height: emuToCm(element.height),
  });
  const [fontSize, setFontSize] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [rotation, setRotation] = useState(String(element.rotation));
  const [cells, setCells] = useState(element.tableCells ?? []);
  const [error, setError] = useState("");
  const [lineWidth, setLineWidth] = useState("1");
  const [crop, setCrop] = useState({
    left: "0",
    top: "0",
    right: "0",
    bottom: "0",
  });
  const t = target(slide, element);
  const apply = (summary: string, command: Command) =>
    onApply(summary, [{ ...command, target: t }]);
  return (
    <>
      <strong>{element.name}</strong>
      {supportsManualOperation(element, "replace_text") ? (
        <div className="tool-section">
          <label>
            텍스트
            <textarea
              aria-label="요소 텍스트"
              rows={3}
              value={text}
              disabled={disabled}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={disabled || text === (element.text ?? "")}
            onClick={() =>
              void apply("텍스트 변경", { op: "replace_text", text })
            }
          >
            텍스트 저장
          </button>
          <p className="fine-print">
            상자 전체의 텍스트를 바꿉니다. 부분별 서식은 유지되지 않을 수
            있습니다.
          </p>
          <div className="tool-grid">
            <label>
              글꼴
              <input
                aria-label="적용할 글꼴"
                placeholder="변경할 글꼴명"
                value={fontFamily}
                onChange={(event) => setFontFamily(event.target.value)}
                disabled={disabled}
              />
            </label>
            <label>
              크기 (pt)
              <input
                aria-label="적용할 글자 크기"
                type="number"
                min="1"
                max="400"
                step="0.5"
                value={fontSize}
                onChange={(event) => setFontSize(event.target.value)}
                disabled={disabled}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={
              disabled ||
              (!fontFamily.trim() && !fontSize) ||
              (!!fontSize && (+fontSize < 1 || +fontSize > 400))
            }
            onClick={() =>
              void apply("글꼴 서식 변경", {
                op: "set_text_style",
                ...(fontFamily.trim() ? { fontFamily: fontFamily.trim() } : {}),
                ...(fontSize ? { fontSize: +fontSize } : {}),
              })
            }
          >
            글꼴 적용
          </button>
          <div className="tool-grid">
            {[
              [true, "굵게"],
              [false, "굵게 해제"],
            ].map(([bold, label]) => (
              <button
                type="button"
                key={String(label)}
                disabled={disabled}
                onClick={() =>
                  void apply(String(label), { op: "set_text_style", bold })
                }
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void apply("기울임", { op: "set_text_style", italic: true })
              }
            >
              기울임
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void apply("기울임 해제", {
                  op: "set_text_style",
                  italic: false,
                })
              }
            >
              기울임 해제
            </button>
          </div>
          <ColorAction
            label="글자 색"
            disabled={disabled}
            onApply={(rgb) =>
              apply("글자 색 변경", { op: "set_text_style", rgb })
            }
          />
          <label>
            문단 정렬
            <select
              aria-label="문단 정렬 적용"
              disabled={disabled}
              value=""
              onChange={(event) =>
                void apply("문단 정렬", {
                  op: "set_paragraph_style",
                  alignment: event.target.value,
                })
              }
            >
              <option value="" disabled>
                정렬 선택
              </option>
              {[
                ["left", "왼쪽"],
                ["center", "가운데"],
                ["right", "오른쪽"],
                ["justify", "양쪽"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            목록
            <select
              aria-label="글머리 기호 적용"
              disabled={disabled}
              value=""
              onChange={(event) =>
                void apply("목록 서식", {
                  op: "set_paragraph_style",
                  bullet: event.target.value,
                })
              }
            >
              <option value="" disabled>
                목록 선택
              </option>
              <option value="none">없음</option>
              <option value="bullet">글머리 기호</option>
              <option value="number">번호</option>
            </select>
          </label>
        </div>
      ) : null}
      {element.tableCells ? (
        <div className="tool-section">
          <strong>표 내용</strong>
          {cells.map((row, r) => (
            <div key={r} className="table-cell-row">
              {row.map((cell, c) => (
                <label key={c}>
                  {r + 1}행 {c + 1}열
                  <input
                    aria-label={`${r + 1}행 ${c + 1}열`}
                    disabled={disabled}
                    value={cell}
                    onChange={(event) =>
                      setCells((current) =>
                        current.map((row, ri) =>
                          ri === r
                            ? row.map((text, ci) =>
                                ci === c ? event.target.value : text,
                              )
                            : row,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    disabled={disabled || cell === element.tableCells?.[r]?.[c]}
                    onClick={() =>
                      void apply("표 셀 변경", {
                        op: "set_table_cell",
                        row: r,
                        column: c,
                        text: cell,
                      })
                    }
                  >
                    셀 저장
                  </button>
                </label>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <details className="tool-section">
        <summary>위치·크기·회전</summary>
        <div className="tool-grid">
          {(
            [
              ["x", "가로 위치"],
              ["y", "세로 위치"],
              ["width", "너비"],
              ["height", "높이"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label} (cm)
              <input
                aria-label={label}
                type="number"
                step="0.01"
                disabled={disabled}
                value={position[key]}
                onChange={(event) =>
                  setPosition((value) => ({
                    ...value,
                    [key]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            try {
              setError("");
              const x = cmToEmu(position.x, element.x),
                y = cmToEmu(position.y, element.y),
                width = cmToEmu(position.width, element.width),
                height = cmToEmu(position.height, element.height);
              if (width <= 0 || height <= 0)
                throw new Error("너비와 높이는 0보다 커야 합니다.");
              void onApply("위치와 크기 변경", [
                { op: "move_shape", target: t, x, y },
                { op: "resize_shape", target: t, width, height },
              ]);
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        >
          위치·크기 저장
        </button>
        <label>
          회전 (°)
          <input
            aria-label="회전 각도"
            type="number"
            min="-360"
            max="360"
            value={rotation}
            onChange={(event) => setRotation(event.target.value)}
            disabled={disabled}
          />
        </label>
        <button
          type="button"
          disabled={
            disabled || !rotation || +rotation < -360 || +rotation > 360
          }
          onClick={() =>
            void apply("회전", { op: "rotate_shape", degrees: +rotation })
          }
        >
          회전 적용
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </details>
      {element.kind === "picture" ? (
        <details className="tool-section">
          <summary>이미지 교체·자르기</summary>
          <ImageAction
            documentId={documentId}
            label="이미지 교체"
            disabled={disabled}
            onImage={(asset) =>
              apply("이미지 교체", {
                op: "replace_image",
                assetId: asset.assetId,
              })
            }
          />
          <p className="fine-print">
            각 가장자리에서 잘라낼 비율을 입력하세요. 기존 자르기 값을 읽은
            표시가 아니라 새로 적용할 값입니다.
          </p>
          <div className="tool-grid">
            {(
              [
                ["left", "왼쪽"],
                ["top", "위쪽"],
                ["right", "오른쪽"],
                ["bottom", "아래쪽"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label} (%)
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={crop[key]}
                  disabled={disabled}
                  onChange={(event) =>
                    setCrop((value) => ({
                      ...value,
                      [key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={
              disabled ||
              Object.values(crop).some(
                (value) => !value || +value < 0 || +value >= 100,
              ) ||
              +crop.left + +crop.right >= 100 ||
              +crop.top + +crop.bottom >= 100
            }
            onClick={() =>
              void apply("이미지 자르기", {
                op: "crop_image",
                left: +crop.left / 100,
                top: +crop.top / 100,
                right: +crop.right / 100,
                bottom: +crop.bottom / 100,
              })
            }
          >
            자르기 적용
          </button>
        </details>
      ) : null}
      {supportsManualOperation(element, "set_line") ? (
        <details className="tool-section">
          <summary>테두리</summary>
          <label>
            선 두께 (pt)
            <input
              type="number"
              min="0"
              max="100"
              step="0.25"
              value={lineWidth}
              onChange={(event) => setLineWidth(event.target.value)}
              disabled={disabled}
            />
          </label>
          <ColorAction
            label="선 색"
            disabled={
              disabled || !lineWidth || +lineWidth < 0 || +lineWidth > 100
            }
            onApply={(rgb) =>
              apply("테두리 변경", { op: "set_line", rgb, width: +lineWidth })
            }
          />
        </details>
      ) : null}
      {supportsManualOperation(element, "set_fill") ? (
        <ColorAction
          label="채우기 색"
          disabled={disabled}
          onApply={(rgb) => apply("채우기 색 변경", { op: "set_fill", rgb })}
        />
      ) : null}
      <details className="tool-section">
        <summary>순서·복제·삭제</summary>
        <div className="tool-grid">
          {[
            ["front", "맨 앞으로"],
            ["forward", "한 단계 앞으로"],
            ["backward", "한 단계 뒤로"],
            ["back", "맨 뒤로"],
          ].map(([position, label]) => (
            <button
              type="button"
              key={position}
              disabled={disabled}
              onClick={() =>
                void apply(label, { op: "reorder_shape", position })
              }
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              void apply("요소 복제", {
                op: "duplicate_shape",
                x: element.x + 180000,
                y: element.y + 180000,
              })
            }
          >
            복제
          </button>
          {element.kind === "group" ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void apply("그룹 해제", { op: "ungroup_shape" })}
            >
              그룹 해제
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (
                window.confirm(
                  `${element.name} 요소를 삭제할까요? 저장 후 되돌릴 수 있습니다.`,
                )
              )
                void apply("요소 삭제", { op: "delete_shape" });
            }}
          >
            삭제
          </button>
        </div>
      </details>
    </>
  );
}

function ImageAction({
  documentId,
  label,
  disabled,
  onImage,
}: {
  documentId: string;
  label: string;
  disabled: boolean;
  onImage: (
    asset: Awaited<ReturnType<typeof uploadImageAsset>>,
  ) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="direct-image-action">
      <label>
        {uploading ? "이미지 업로드 중…" : label}
        <input
          type="file"
          accept="image/png,image/jpeg"
          disabled={disabled || uploading}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setUploading(true);
            setError("");
            try {
              await onImage(await uploadImageAsset(documentId, file));
            } catch (error) {
              setError(
                error instanceof Error ? error.message : "이미지 작업 실패",
              );
            } finally {
              setUploading(false);
            }
          }}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
