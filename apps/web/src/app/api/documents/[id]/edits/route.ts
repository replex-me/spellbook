import { createEdit } from "@/lib/orchestration";
import { parseModelSettings } from "@/lib/ai-models";
import { requireSession, routeError } from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const selectedElementIds = Array.isArray(body.selectedElementIds)
      ? body.selectedElementIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const selectedSlideIndexes = Array.isArray(body.selectedSlideIndexes)
      ? body.selectedSlideIndexes.map(Number).filter(Number.isInteger)
      : [];
    return Response.json(
      await createEdit(await requireSession(request), id, {
        modelSettings: parseModelSettings(body.modelSettings),
        requestText:
          typeof body.requestText === "string" ? body.requestText : "",
        selectedElementIds,
        selectedSlideIndexes,
        baseCandidateEditId:
          typeof body.baseCandidateEditId === "string"
            ? body.baseCandidateEditId
            : undefined,
      }),
      { status: 202 },
    );
  } catch (error) {
    return routeError(error);
  }
}
