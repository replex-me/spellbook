import { routeError } from "@/lib/http";
import { requireNativeRequestSession } from "@/lib/native-request-auth";
import { completeNativeTask } from "@/lib/native-runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await completeNativeTask(
        await requireNativeRequestSession(request, (await context.params).id),
        (await context.params).id,
        await request.json(),
      ),
    );
  } catch (error) {
    return routeError(error);
  }
}
