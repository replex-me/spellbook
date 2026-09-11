import type {
  AvailableModel,
  ModelSettings,
} from "../../../../contracts/ai-models";

export type { AvailableModel, ModelSettings };

export function parseModelSettings(value: unknown): ModelSettings | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_model_settings");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !["model", "effort"].includes(key)) ||
    typeof input.model !== "string" ||
    !input.model ||
    input.model.length > 120 ||
    typeof input.effort !== "string" ||
    !input.effort ||
    input.effort.length > 24
  )
    throw new Error("invalid_model_settings");
  return { model: input.model, effort: input.effort };
}

export function supportsSettings(
  models: AvailableModel[],
  settings: ModelSettings,
): boolean {
  return !!models
    .find((item) => item.model === settings.model)
    ?.supportedReasoningEfforts.some(
      (item) => item.reasoningEffort === settings.effort,
    );
}
