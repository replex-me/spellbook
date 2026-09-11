import { createManualEdit } from "@/lib/orchestration";
import { requireSession, routeError, HttpError } from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    const { id } = await context.params;
    const body = await request.json();
    if (
      !body ||
      typeof body.requestId !== "string" ||
      typeof body.baseVersionId !== "string"
    )
      throw new HttpError(400, "invalid_manual_request");
    return Response.json(await createManualEdit(session, id, body), {
      status: 202,
    });
  } catch (error) {
    return routeError(error);
  }
}
