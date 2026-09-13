import { authorizeNativeConnectorJob } from "../../../../../../lib/native-connector-auth";
import { HttpError, routeError } from "../../../../../../lib/http";
import type { WorkerCallback } from "../../../../../../lib/models";
import { handleWorkerCallback } from "../../../../../../lib/orchestration";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const job = await authorizeNativeConnectorJob(request, jobId);
    const callback = (await request.json()) as WorkerCallback;
    if (callback.jobId !== jobId)
      throw new HttpError(400, "native_connector_job_mismatch");
    await handleWorkerCallback(callback);
    return Response.json({ status: "accepted", jobId: job.id });
  } catch (error) {
    return routeError(error);
  }
}
