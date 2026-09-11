import { requireSession, routeError } from "@/lib/http";
import { createNativeLaunch } from "@/lib/native-session";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await createNativeLaunch(
        await requireSession(request),
        (await context.params).id,
      ),
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
