import { approveCandidate } from "@/lib/orchestration";
import { requireSession, routeError } from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; editId: string }> },
) {
  try {
    const { id, editId } = await context.params;
    await approveCandidate(await requireSession(request), id, editId);
    return Response.json({ status: "approved" });
  } catch (error) {
    return routeError(error);
  }
}
