import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface NativeEditContract {
  version: string;
  coordinateUnit: string;
  nativeUndoRequired: boolean;
  transaction: {
    maxCommands: number;
    supportsDryRun: boolean;
    atomicByDefault: boolean;
    targetResolution: string;
    maxStructureChangingCommandsOnStockEngine: number;
    identityReplacingOperations: string[];
    ordering: string;
  };
  operationGroups: {
    slide: string[];
    create: string[];
    multiElement: string[];
    element: string[];
  };
  toolInputSchema: Record<string, unknown> & {
    properties: { op: { enum: string[] } };
  };
}

const contractsDirectory =
  process.env.SPELLBOOK_CONTRACTS_DIR ??
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../contracts",
  );

export const nativeEditContract = JSON.parse(
  readFileSync(
    path.join(contractsDirectory, "native-edit-capabilities.json"),
    "utf8",
  ),
) as NativeEditContract;

const grouped = Object.values(nativeEditContract.operationGroups).flat();
const declared = nativeEditContract.toolInputSchema.properties.op.enum;
if (
  !nativeEditContract.nativeUndoRequired ||
  new Set(grouped).size !== grouped.length ||
  grouped.length !== declared.length ||
  grouped.some((operation) => !declared.includes(operation))
)
  throw new Error("Invalid native edit capability contract.");

export const nativeSlideOperations = new Set(
  nativeEditContract.operationGroups.slide,
);
export const nativeCreateOperations = new Set(
  nativeEditContract.operationGroups.create,
);
export const nativeMultiElementOperations = new Set(
  nativeEditContract.operationGroups.multiElement,
);
export const nativeElementOperations = new Set(
  nativeEditContract.operationGroups.element,
);
export const nativeIdentityReplacingOperations = new Set(
  nativeEditContract.transaction.identityReplacingOperations,
);

export const nativeBatchEditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    commands: {
      type: "array",
      minItems: 1,
      maxItems: nativeEditContract.transaction.maxCommands,
      items: nativeEditContract.toolInputSchema,
    },
    dryRun: { type: "boolean" },
  },
  required: ["commands", "dryRun"],
} as const;
