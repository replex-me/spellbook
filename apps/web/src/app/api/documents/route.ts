import { listDocuments, uploadDocument } from "@/lib/orchestration";
import { requireSession, routeError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return Response.json({
      documents: await listDocuments(await requireSession(request)),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return Response.json({ error: "file_required" }, { status: 400 });
    return Response.json(await uploadDocument(session, file), { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
