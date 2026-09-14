/** Public account-backed model catalog; no API catalog or static model IDs. */
export interface AvailableModel {
  provider?: "codex" | "claude_code";
  model: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description: string;
  }>;
  isDefault: boolean;
}
export interface ModelSettings {
  provider?: "codex" | "claude_code";
  model: string;
  effort: string;
}
