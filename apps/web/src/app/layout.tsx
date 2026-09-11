import type { Metadata } from "next";

import "./globals.css";
import "./design-system.css";

export const metadata: Metadata = {
  title: "Spellbook — AI PowerPoint Editor",
  description: "원본 PPTX를 보면서 고치고 그대로 돌려받는 비공개 편집 도구",
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
