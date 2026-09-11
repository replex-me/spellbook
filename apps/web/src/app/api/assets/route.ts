import { getObject } from "@/lib/storage";
import { requireSession, routeError } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const objectName = new URL(request.url).searchParams.get("object") ?? "";
    const accountKey = Buffer.from(session.accountId).toString("base64url");
    if (!objectName.startsWith(`accounts/${accountKey}/documents/`)) {
      return Response.json({ error: "asset_not_found" }, { status: 404 });
    }
    const data = await getObject(objectName);
    const contentType = objectName.endsWith(".png")
      ? "image/png"
      : objectName.endsWith(".json")
        ? "application/json"
        : "application/octet-stream";
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": contentType,
        "cache-control": "private, max-age=60",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
