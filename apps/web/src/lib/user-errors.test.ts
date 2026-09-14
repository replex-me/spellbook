import { describe, expect, it } from "vitest";

import { userFacingError } from "./user-errors";

describe("user-facing product errors", () => {
  it("explains storage protection without exposing an internal code", () => {
    expect(
      userFacingError("storage_capacity_exhausted", "업로드하지 못했습니다."),
    ).toBe(
      "저장 공간이 부족해 작업을 안전하게 중단했습니다. 기존 파일은 그대로 보존됩니다. 공간을 확보한 뒤 다시 시도해 주세요.",
    );
  });

  it("preserves a useful server explanation and falls back for internal codes", () => {
    expect(
      userFacingError("Only .pptx files are supported", "실패했습니다."),
    ).toBe("Only .pptx files are supported");
    expect(userFacingError("unexpected_error", "실패했습니다.")).toBe(
      "실패했습니다.",
    );
  });
});
