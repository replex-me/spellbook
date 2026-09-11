import { authorizeInternal } from "@/lib/internal-auth";
import { executeAgentTool } from "@/lib/orchestration";
import { EditValidationError } from "@/lib/edit-scope";
import { routeError } from "@/lib/http";

export async function POST(request: Request) {
  try {
    authorizeInternal(request);
    return Response.json(await executeAgentTool(await request.json()));
  } catch (error) {
    if (error instanceof EditValidationError)
      return Response.json({ error: error.message }, { status: 400 });
    return routeError(error);
  }
}
