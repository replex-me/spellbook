// CommonMark does not close emphasis when quoted text is immediately followed
// by a letter, which is common with Korean particles: **“제목”**입니다.
// Keep the exact visible sentence while moving paired quotes outside emphasis.
export function normalizeQuotedStrongMarkdown(source: string): string {
  return source.replace(
    /\*\*(["'“‘「『])([^*\n]+?)(["'”’」』])\*\*(?=[\p{L}\p{N}])/gu,
    "$1**$2**$3",
  );
}
