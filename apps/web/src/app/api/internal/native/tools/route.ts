import { routeError } from "@/lib/http";
import { authorizeInternal } from "@/lib/internal-auth";
import { executeNativeTool } from "@/lib/native-runtime";

export async function POST(request: Request) {
  try {
    authorizeInternal(request);
    return Response.json(await executeNativeTool(await request.json()));
  } catch (error) {
    return routeError(error);
  }
}
