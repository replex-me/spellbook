import { routeError } from "@/lib/http";
import { requireNativeRequestSession } from "@/lib/native-request-auth";
import { pollNativeSession } from "@/lib/native-runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
    return Response.json(
      await pollNativeSession(
        await requireNativeRequestSession(request, (await context.params).id),
        (await context.params).id,
        after,
      ),
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
