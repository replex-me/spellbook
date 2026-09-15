import type { Metadata } from "next";

import "./globals.css";
import "./design-system.css";

export const metadata: Metadata = {
  title: "Spellbook — AI PowerPoint Editor",
  description: "원본 PPTX를 보면서 고치고 편집 가능한 상태로 돌려받는 도구",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
