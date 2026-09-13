import { authorizeNativeConnectorJob } from "../../../../../../lib/native-connector-auth";
import { HttpError, routeError } from "../../../../../../lib/http";
import { executeNativeTool } from "../../../../../../lib/native-runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    await authorizeNativeConnectorJob(request, jobId);
    const input = (await request.json()) as Record<string, unknown>;
    if (input.jobId !== jobId)
      throw new HttpError(400, "native_connector_job_mismatch");
    return Response.json(await executeNativeTool(input));
  } catch (error) {
    return routeError(error);
  }
}
