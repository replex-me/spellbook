/** Public account-backed model catalog; no API catalog or static model IDs. */
export interface AvailableModel {
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
  model: string;
  effort: string;
}
