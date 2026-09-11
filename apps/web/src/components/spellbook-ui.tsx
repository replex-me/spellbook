import type { CSSProperties, ReactNode } from "react";

const iconPaths = {
  arrowRight: ["M5 12h14", "m13-6 6 6-6 6"],
  check: ["m5 12 4 4L19 6"],
  chevronDown: ["m7 10 5 5 5-5"],
  close: ["M6 6l12 12M18 6 6 18"],
  download: ["M12 4v11m-4-4 4 4 4-4", "M5 20h14"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v5h5"],
  home: ["m4 11 8-7 8 7v9h-5v-6H9v6H4z"],
  logout: ["M10 5H5v14h5", "m14-4 5 4-5 4", "M19 12H9"],
  redo: ["M20 7v5h-5", "M20 12a8 8 0 1 0-2 5.3"],
  save: ["M5 3h12l2 2v16H5z", "M8 3v6h8V3", "M8 16h8"],
  shield: [
    "M12 3 5 6v5c0 4.7 2.8 8.1 7 10 4.2-1.9 7-5.3 7-10V6z",
    "m9 12 2 2 4-5",
  ],
  sparkles: [
    "m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2z",
    "m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z",
  ],
  stop: ["M8 8h8v8H8z"],
  undo: ["M4 7v5h5", "M4 12a8 8 0 1 1 2 5.3"],
  upload: ["M12 20V9m-4 4 4-4 4 4", "M5 4h14"],
} as const;

export type SpellbookIconName = keyof typeof iconPaths;

export function SpellbookIcon({
  name,
  size = 18,
  style,
}: {
  name: SpellbookIconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      className="ds-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {iconPaths[name].map((value, index) => (
        <path key={index} d={value} />
      ))}
    </svg>
  );
}

export function SpellbookBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`ds-brand ${compact ? "is-compact" : ""}`}>
      <span className="ds-brand-symbol" aria-hidden="true">
        <span>S</span>
      </span>
      {!compact ? <span className="ds-brand-name">Spellbook</span> : null}
    </span>
  );
}

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "progress" | "warning" | "danger" | "ai";
  children: ReactNode;
}) {
  return <span className={`ds-badge is-${tone}`}>{children}</span>;
}
