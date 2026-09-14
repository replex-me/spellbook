import { routeError } from "@/lib/http";
import {
  WopiLockConflict,
  wopiCheckFileInfo,
  wopiLock,
} from "@/lib/native-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await wopiCheckFileInfo(request, (await context.params).id),
      {
        headers: { "cache-control": "private, no-store" },
      },
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
    const result = await wopiLock(request, (await context.params).id);
    return new Response(null, {
      status: result.status,
      headers:
        result.lock !== undefined ? { "x-wopi-lock": result.lock } : undefined,
    });
  } catch (error) {
    if (error instanceof WopiLockConflict)
      return new Response(null, {
        status: 409,
        headers: { "x-wopi-lock": error.lock },
      });
    return routeError(error);
  }
}
