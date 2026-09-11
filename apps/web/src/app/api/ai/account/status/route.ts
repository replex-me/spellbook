import { requireSession, routeError } from "@/lib/http";
import { callAiAccount } from "@/lib/workers";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return Response.json(
      await callAiAccount("/internal/account/status", session.email),
    );
  } catch (error) {
    return routeError(error);
  }
}
