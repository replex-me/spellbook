import { routeError } from "@/lib/http";
import { requireNativeRequestSession } from "@/lib/native-request-auth";
import { nativeModels } from "@/lib/native-runtime";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await nativeModels(
        await requireNativeRequestSession(request, (await context.params).id),
        (await context.params).id,
      ),
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
