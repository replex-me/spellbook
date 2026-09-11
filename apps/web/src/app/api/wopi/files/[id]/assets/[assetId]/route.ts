import { routeError } from "@/lib/http";
import { wopiGetImageAsset } from "@/lib/native-session";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; assetId: string }> },
) {
  try {
    const { id, assetId } = await context.params;
    const asset = await wopiGetImageAsset(request, id, assetId);
    return new Response(new Uint8Array(asset.data), {
      headers: {
        "content-type": asset.contentType,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
