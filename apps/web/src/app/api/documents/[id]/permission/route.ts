import { requireSession, routeError } from "@/lib/http";
import { updateAiPermission } from "@/lib/ai-permissions";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await updateAiPermission(
        await requireSession(request),
        (await context.params).id,
        await request.json(),
      ),
    );
  } catch (error) {
    return routeError(error);
  }
}
