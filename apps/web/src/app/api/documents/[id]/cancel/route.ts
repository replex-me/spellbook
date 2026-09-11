import { cancelDocumentTurn } from "@/lib/orchestration";
import { requireSession, routeError } from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await cancelDocumentTurn(await requireSession(request), id);
    return Response.json({ status: "cancelled" });
  } catch (error) {
    return routeError(error);
  }
}
