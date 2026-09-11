import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const contractsDir = path.resolve("contracts");
const files = fs
  .readdirSync(contractsDir)
  .filter((name) => name.endsWith(".schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: true });

for (const file of files) {
  const schema = JSON.parse(
    fs.readFileSync(path.join(contractsDir, file), "utf8"),
  );
  ajv.compile(schema);
}

const formatSchema = JSON.parse(
  fs.readFileSync(
    path.join(contractsDir, "document-formats.schema.json"),
    "utf8",
  ),
);
const formatRegistry = JSON.parse(
  fs.readFileSync(path.join(contractsDir, "document-formats.json"), "utf8"),
);
const validateFormats =
  ajv.getSchema(formatSchema.$id) ?? ajv.compile(formatSchema);
if (!validateFormats(formatRegistry)) {
  throw new Error(
    `Invalid document format registry: ${ajv.errorsText(validateFormats.errors)}`,
  );
}

process.stdout.write(`Validated ${files.length} JSON contracts.\n`);
