import { documentDetail } from "@/lib/orchestration";
import { requireSession, routeError } from "@/lib/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const detail = await documentDetail(
      await requireSession(request),
      id,
      request.headers.get("if-none-match") ?? undefined,
    );
    const headers = {
      etag: detail.revision,
      "cache-control": "private, no-cache",
    };
    return "notModified" in detail
      ? new Response(null, { status: 304, headers })
      : Response.json(detail, { headers });
  } catch (error) {
    return routeError(error);
  }
}
