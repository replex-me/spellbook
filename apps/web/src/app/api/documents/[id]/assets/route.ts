import { requireSession, routeError } from "@/lib/http";
import { uploadImage } from "@/lib/image-assets";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    if (Number(request.headers.get("content-length")) > 5_100_000)
      return Response.json({ error: "image_too_large" }, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json({ error: "file_required" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 5_100_000) {
        await reader.cancel();
        return Response.json({ error: "image_too_large" }, { status: 413 });
      }
      chunks.push(item.value);
    }
    const file = (
      await new Response(Buffer.concat(chunks), {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData()
    ).get("file");
    if (!(file instanceof File))
      return Response.json({ error: "file_required" }, { status: 400 });
    return Response.json(
      await uploadImage(session, (await context.params).id, file),
      { status: 201 },
    );
  } catch (error) {
    return routeError(error);
  }
}
