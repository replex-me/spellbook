import type { ElementNode } from "./models";
import capabilities from "../../../../contracts/edit-target-capabilities.json";

export function supportsManualOperation(
  element: ElementNode,
  op: string,
): boolean {
  const rule = (
    capabilities as Record<
      string,
      { targetKinds: string[]; requiresTableCells?: boolean }
    >
  )[op];
  return (
    element.editable &&
    (!rule ||
      (rule.targetKinds.includes(element.kind) &&
        (!rule.requiresTableCells || !!element.tableCells)))
  );
}

export function emuToCm(value: number): string {
  return (value / 360000).toFixed(3);
}
export function cmToEmu(value: string, original?: number): number {
  if (original !== undefined && value === emuToCm(original)) return original;
  if (!value.trim() || !Number.isFinite(Number(value)))
    throw new Error("위치와 크기는 숫자로 입력하세요.");
  return Math.round(Number(value) * 360000);
}
