import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function cumulativeUiTestErrors(source) {
  const errors = [];
  const rawStringStart = /(?:u8|u|U|L)?R"([A-Za-z0-9_]{0,16})\(/gu;
  let match;
  while ((match = rawStringStart.exec(source))) {
    const close = `)${match[1]}"`;
    const closeIndex = source.indexOf(close, rawStringStart.lastIndex);
    if (closeIndex < 0) {
      errors.push(`unterminated raw string at byte ${match.index}`);
      break;
    }
    const body = source.slice(rawStringStart.lastIndex, closeIndex);
    if (body.includes("CPPUNIT_TEST_FIXTURE"))
      errors.push(`test fixture nested in raw string at byte ${match.index}`);
    rawStringStart.lastIndex = closeIndex + close.length;
  }

  if (
    source.includes("sUNO_LayerName_background_objects") &&
    !source.includes("#include <unokywds.hxx>")
  )
    errors.push("background layer constant is used without unokywds.hxx");

  if (
    /CPPUNIT_ASSERT_EQUAL\(p(?:Original|Inserted)\.get\(\),\s*pPage->GetObj/gu.test(
      source,
    )
  )
    errors.push(
      "derived drawing pointer is compared without an SdrObject cast",
    );

  return errors;
}

function requiredFlagValue(name, argv) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return value;
}

function main() {
  const engineRoot = path.resolve(requiredFlagValue("--source", process.argv));
  const testPath = path.join(engineRoot, "sd/qa/unit/uiimpress.cxx");
  const errors = cumulativeUiTestErrors(fs.readFileSync(testPath, "utf8"));
  if (errors.length) throw new Error(errors.join("; "));
  process.stdout.write(
    `${JSON.stringify({ status: "cumulative-source-verified", testPath })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
