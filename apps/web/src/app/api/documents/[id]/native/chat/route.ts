import { routeError } from "@/lib/http";
import { requireNativeRequestSession } from "@/lib/native-request-auth";
import { submitNativeTurn } from "@/lib/native-runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await submitNativeTurn(
        await requireNativeRequestSession(request, (await context.params).id),
        (await context.params).id,
        await request.json(),
      ),
      { status: 202 },
    );
  } catch (error) {
    return routeError(error);
  }
}
