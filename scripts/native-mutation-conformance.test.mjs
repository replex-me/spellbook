import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildConformancePlan } from "./native-mutation-conformance.mjs";

const capabilities = JSON.parse(
  fs.readFileSync("contracts/native-edit-capabilities.json", "utf8"),
);
const conformance = JSON.parse(
  fs.readFileSync("contracts/native-mutation-conformance.json", "utf8"),
);

test("native mutation plan covers every operation through family fixtures", () => {
  const plan = buildConformancePlan(capabilities, conformance);

  assert.equal(plan.summary.operations, 62);
  assert.equal(plan.summary.families, 15);
  assert.equal(plan.summary.scenarios, 9);
  assert.equal(plan.summary.nativeTests, 18);
  assert.equal(Object.keys(plan.scenarios)[0], "table-structure");
  assert.equal(Object.keys(plan.scenarios).at(-1), "general-native-surface");
  assert.deepEqual(
    Object.values(plan.families)
      .flatMap((family) => family.operations)
      .sort(),
    Object.entries(capabilities.mutationModel.operations)
      .filter(
        ([, operation]) =>
          operation.availability !== "format_excluded" &&
          operation.minEnginePatch <= plan.enginePatchLevel,
      )
      .map(([operation]) => operation)
      .sort(),
  );
});

test("scenario order is complete and cannot silently drift from the contract", () => {
  const invalid = structuredClone(conformance);
  invalid.executionOrder = invalid.executionOrder.slice(1);

  assert.throws(
    () => buildConformancePlan(capabilities, invalid),
    /Invalid conformance executionOrder.*missing=table-structure/,
  );
});

test("engine patch selection removes unavailable operations without hand-maintained lists", () => {
  const stock = buildConformancePlan(capabilities, conformance, {
    enginePatchLevel: 0,
  });

  assert.equal(stock.summary.operations, 31);
  assert.ok(stock.families.chart_model.operations.includes("set_chart_data"));
  assert.ok(!stock.families.object_text.operations.includes("font_size"));
  assert.ok(!stock.families.object_text.operations.includes("font_family"));
  assert.equal(stock.families.animation, undefined);
  assert.equal(stock.families.slide_transition, undefined);
});

test("plan maps every required evidence gate to a scoped provider", () => {
  const plan = buildConformancePlan(capabilities, conformance);

  assert.deepEqual(plan.families.object_text.missingGates, []);
  assert.deepEqual(plan.families.slide_transition.missingGates, []);
  assert.deepEqual(plan.families.animation.missingGates, []);
  assert.equal(plan.summary.missingGates, 0);
  assert.equal(plan.summary.complete, true);
  assert.ok(plan.families.animation.providedGates.includes("playback"));
  assert.ok(!plan.families.object_text.providedGates.includes("playback"));
});
