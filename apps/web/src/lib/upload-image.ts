/** Shared browser upload boundary for chat attachments and direct image edits. */
import { userFacingError } from "./user-errors";

export async function uploadImageAsset(
  documentId: string,
  file: File,
): Promise<{
  assetId: string;
  fileName: string;
  width: number;
  height: number;
}> {
  if (
    !["image/png", "image/jpeg"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("PNG/JPEG, 5MB 이하 이미지를 선택하세요.");
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`/api/documents/${documentId}/assets`, {
    method: "POST",
    body: form,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      userFacingError(result.error, "이미지를 업로드하지 못했습니다."),
    );
  return result;
}
