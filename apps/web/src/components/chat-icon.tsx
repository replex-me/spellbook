import type { CSSProperties } from "react";

const paths = {
  send: "M12 19V5m-6 6 6-6 6 6",
  plus: "M12 5v14M5 12h14",
  down: "M12 5v14m-6-6 6 6 6-6",
  copy: "M9 9h11v11H9zM15 9V4H4v11h5",
  check: "m5 12 4 4L19 6",
  stop: "M7 7h10v10H7z",
  slide: "M3 4h18v13H3zM12 17v4m-4 0h8",
} as const;

export function ChatIcon({
  name,
  style,
}: {
  name: keyof typeof paths;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
