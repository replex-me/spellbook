import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface NativeEditContract {
  version: string;
  coordinateUnit: string;
  nativeUndoRequired: boolean;
  aiExposure: {
    operationCount: number;
  };
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
    document: string[];
    slide: string[];
    create: string[];
    multiElement: string[];
    element: string[];
  };
  candidateOperations: string[];
  mutationModel: {
    version: string;
    domains: Record<string, { atomicBoundary: string; description: string }>;
    families: Record<
      string,
      {
        domain: string;
        undoProvider: string;
        fixture: string;
        verification: string[];
        changeBudget: string[];
      }
    >;
    operations: Record<
      string,
      {
        family: string;
        target: string;
        execution: string;
        identityEffect:
          | "preserve"
          | "create"
          | "delete"
          | "reorder"
          | "reparent"
          | "replace";
        availability:
          | "runtime_verified"
          | "engine_patch_ready"
          | "runtime_validation_required"
          | "format_excluded";
        minEnginePatch: number;
      }
    >;
  };
  toolInputSchema: Record<string, unknown> & {
    properties: { op: { enum: string[] } };
  };
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const contractsDirectory =
  process.env.SPELLBOOK_CONTRACTS_DIR ??
  path.resolve(moduleDirectory, "../../../contracts");

export const nativeEditContract = JSON.parse(
  readFileSync(
    path.join(contractsDirectory, "native-edit-capabilities.json"),
    "utf8",
  ),
) as NativeEditContract;

const grouped = Object.values(nativeEditContract.operationGroups).flat();
const declared = nativeEditContract.toolInputSchema.properties.op.enum;
const mutationOperations = nativeEditContract.mutationModel.operations;
const executable = Object.entries(mutationOperations)
  .filter(([, operation]) => operation.availability !== "format_excluded")
  .map(([operation]) => operation);
if (
  !nativeEditContract.nativeUndoRequired ||
  nativeEditContract.aiExposure.operationCount !== executable.length ||
  new Set(grouped).size !== grouped.length ||
  new Set(declared).size !== declared.length ||
  grouped.length !== executable.length ||
  declared.length !== executable.length ||
  grouped.some((operation) => !declared.includes(operation)) ||
  executable.some(
    (operation) =>
      !grouped.includes(operation) || !declared.includes(operation),
  )
)
  throw new Error("Invalid native edit capability contract.");

export const nativeSlideOperations = new Set(
  nativeEditContract.operationGroups.slide,
);
export const nativeDocumentOperations = new Set(
  nativeEditContract.operationGroups.document,
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
  Object.entries(mutationOperations)
    .filter(
      ([, contract]) =>
        contract.availability !== "format_excluded" &&
        contract.identityEffect === "replace",
    )
    .map(([operation]) => operation),
);

export const nativePlatformAssetOperations = new Set(
  Object.entries(mutationOperations)
    .filter(
      ([, contract]) =>
        contract.availability !== "format_excluded" &&
        contract.execution === "platform_asset",
    )
    .map(([operation]) => operation),
);

export const nativeEditOperationCount = executable.length;

export const nativeMutationOperations = mutationOperations;

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
