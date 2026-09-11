import { requireSession, routeError } from "@/lib/http";
import { readConversation, steerConversation } from "@/lib/conversation";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await readConversation(
        await requireSession(request),
        (await context.params).id,
      ),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const body = await request.json();
    return Response.json(
      await steerConversation(
        await requireSession(request),
        (await context.params).id,
        {
          text: typeof body.text === "string" ? body.text : "",
          requestId: typeof body.requestId === "string" ? body.requestId : "",
        },
      ),
      { status: 202 },
    );
  } catch (error) {
    return routeError(error);
  }
}
