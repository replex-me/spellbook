import { requireSession, routeError } from "@/lib/http";
import { warmOfficeEditor } from "@/lib/native-session";

export async function POST(request: Request) {
  try {
    await requireSession(request);
    await warmOfficeEditor();
    return Response.json({ ready: true });
  } catch (error) {
    return routeError(error);
  }
}
