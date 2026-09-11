import registry from "../../../../contracts/document-formats.json";

export type DocumentFormatId = "pptx" | "docx" | "spellbook";
export type DocumentFormatAvailability =
  | "beta"
  | "experimental"
  | "planned"
  | "unsupported";

export interface DocumentFormat {
  id: DocumentFormatId;
  label: string;
  availability: DocumentFormatAvailability;
  extensions: string[];
  mimeTypes: string[];
  maxBytes: number;
  editor: {
    kind: "wopi" | "native" | "none";
    wopiApp: string | null;
    wopiAction: string | null;
  };
  semantics: {
    unit: string;
    rootCollection: string;
    outputKind: string;
  };
}

const formats = registry.formats as DocumentFormat[];

export function documentFormats(): readonly DocumentFormat[] {
  return formats;
}

export function documentFormat(id: DocumentFormatId): DocumentFormat {
  const format = formats.find((candidate) => candidate.id === id);
  if (!format) throw new Error(`Unknown document format: ${id}`);
  return format;
}

export function availableDocumentFormatForFile(
  fileName: string,
): DocumentFormat | null {
  const normalized = fileName.trim().toLowerCase();
  return (
    formats.find(
      (format) =>
        ["beta", "experimental"].includes(format.availability) &&
        format.extensions.some((extension) => normalized.endsWith(extension)),
    ) ?? null
  );
}

export const currentPresentationFormat = documentFormat("pptx");
