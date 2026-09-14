import { requireSession, routeError } from "@/lib/http";
import { pollNativeSession } from "@/lib/native-runtime";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const status = await pollNativeSession(
      await requireSession(request),
      (await context.params).id,
      0,
    );
    return Response.json(
      { session: status.session },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
