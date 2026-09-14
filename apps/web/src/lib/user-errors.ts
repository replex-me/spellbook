const messages: Record<string, string> = {
  storage_capacity_exhausted:
    "저장 공간이 부족해 작업을 안전하게 중단했습니다. 기존 파일은 그대로 보존됩니다. 공간을 확보한 뒤 다시 시도해 주세요.",
};

export function userFacingError(
  error: string | null | undefined,
  fallback: string,
): string {
  if (!error || error === "unexpected_error") return fallback;
  return messages[error] ?? error;
}
