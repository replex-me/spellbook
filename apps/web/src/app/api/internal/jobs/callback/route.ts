import { authorizeInternal } from "@/lib/internal-auth";

import { handleWorkerCallback } from "@/lib/orchestration";
import type { WorkerCallback } from "@/lib/models";
import { routeError } from "@/lib/http";

export async function POST(request: Request) {
  try {
    authorizeInternal(request);
    await handleWorkerCallback((await request.json()) as WorkerCallback);
    return Response.json({ status: "accepted" });
  } catch (error) {
    return routeError(error);
  }
}
