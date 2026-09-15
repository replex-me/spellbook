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
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 5_000_000)
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

export async function uploadMediaAsset(
  documentId: string,
  file: File,
): Promise<{
  assetId: string;
  fileName: string;
  contentType: string;
  kind: "media";
}> {
  if (
    ![
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/ogg",
      "audio/mp4",
      "video/mp4",
      "video/webm",
    ].includes(file.type) ||
    file.size > 25_000_000
  )
    throw new Error("MP3/WAV/OGG/M4A/MP4/WebM, 25MB 이하 파일을 선택하세요.");
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`/api/documents/${documentId}/assets`, {
    method: "POST",
    body: form,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      userFacingError(result.error, "미디어를 업로드하지 못했습니다."),
    );
  return result;
}
