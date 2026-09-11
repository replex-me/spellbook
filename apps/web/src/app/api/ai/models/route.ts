import { requireSession, routeError } from "@/lib/http";
import { callAiAccount } from "@/lib/workers";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return Response.json(
      await callAiAccount("/internal/models", session.email),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
