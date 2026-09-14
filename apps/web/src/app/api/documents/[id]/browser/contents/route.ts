import { getBrowserDocument, saveBrowserDocument } from "@/lib/browser-session";
import { requireSession, routeError } from "@/lib/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const file = await getBrowserDocument(
      await requireSession(request),
      (await context.params).id,
    );
    return new Response(new Uint8Array(file.data), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "cache-control": "private, no-store",
        etag: file.revision,
      },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const saved = await saveBrowserDocument(
      await requireSession(request),
      (await context.params).id,
      request,
    );
    return Response.json(saved, {
      headers: {
        "cache-control": "private, no-store",
        etag: saved.revision,
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
