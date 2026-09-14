import {
  createBrowserDocumentLaunch,
  requireBrowserOrigin,
} from "@/lib/browser-session";
import { requireSession, routeError } from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireBrowserOrigin(request);
    return Response.json(
      await createBrowserDocumentLaunch(
        await requireSession(request),
        (await context.params).id,
      ),
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
