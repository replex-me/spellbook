import Ajv2020 from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import schema from "../../../../contracts/edit-command.schema.json";
import { editContractErrors } from "./edit-contract-errors";

it("retains style errors when AJV compiles references with relative schema paths", () => {
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  const command = {
    contractVersion: "1.0",
    baseDocumentSha256: "a".repeat(64),
    summary: "test",
    commands: [
      {
        op: "set_text_style",
        target: { slideIndex: 1, elementId: "1:4", sourceHash: "b".repeat(64) },
        fontSizePt: 28,
      },
    ],
  };
  validate(command);
  expect(editContractErrors(command, validate.errors)).toContain("fontSizePt");
  command.commands[0].op = "format_text";
  validate(command);
  expect(editContractErrors(command, validate.errors)).toContain(
    "set_text_style",
  );
});

it("identifies missing slide fields without unrelated command errors or source text", () => {
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  const command = {
    contractVersion: "1.0",
    baseDocumentSha256: "a".repeat(64),
    summary: "private content",
    commands: [{ op: "add_slide", slideIndex: 0 }],
  };
  expect(validate(command)).toBe(false);
  const result = editContractErrors(command, validate.errors);
  expect(result).toContain("templateSlideIndex");
  expect(result).toContain("insertIndex");
  expect(result).not.toContain("sourceHash");
  expect(result).not.toContain("private content");
});

it("reports missing batch fields so the agent can repair the actual contract", () => {
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  const command = {
    commands: [{ op: "add_slide", templateSlideIndex: 0, insertIndex: 1 }],
  };
  validate(command);
  expect(editContractErrors(command, validate.errors)).toContain(
    "baseDocumentSha256",
  );
});
