import { routeError } from "@/lib/http";
import { requireNativeRequestSession } from "@/lib/native-request-auth";
import { cancelNativeTurn } from "@/lib/native-runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await cancelNativeTurn(
        await requireNativeRequestSession(request, (await context.params).id),
        (await context.params).id,
      ),
    );
  } catch (error) {
    return routeError(error);
  }
}
