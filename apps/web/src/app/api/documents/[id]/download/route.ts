import { downloadCurrent } from "@/lib/orchestration";
import { HttpError, requireSession, routeError } from "@/lib/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const source = new URL(request.url).searchParams.get("source") ?? "current";
    if (source !== "current" && source !== "original" && source !== "candidate")
      throw new HttpError(400, "invalid_download_source");
    const file = await downloadCurrent(
      await requireSession(request),
      id,
      source,
    );
    return new Response(new Uint8Array(file.data), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
