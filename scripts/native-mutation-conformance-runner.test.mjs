import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  buildChangeBudget,
  buildScenarioExecutionPlan,
  isTransientEditorConnectionFailure,
  localProbeBrowserOrigin,
  operationsFromReport,
  persistenceStateFromProbeOutput,
} from "./native-mutation-conformance-runner.mjs";
import { buildConformancePlan } from "./native-mutation-conformance.mjs";

const capabilities = JSON.parse(
  fs.readFileSync("contracts/native-edit-capabilities.json", "utf8"),
);
const conformance = JSON.parse(
  fs.readFileSync("contracts/native-mutation-conformance.json", "utf8"),
);
const publicSources = JSON.parse(
  fs.readFileSync("eval/public/sources.json", "utf8"),
);

function assertPinnedPublicSource(scenario) {
  if (fs.existsSync(scenario.source)) {
    assert.equal(
      createHash("sha256")
        .update(fs.readFileSync(scenario.source))
        .digest("hex"),
      scenario.sourceSha256,
    );
    return;
  }
  const match = /^eval\/public\/downloads\/([^/]+)\.pptx$/u.exec(
    scenario.source,
  );
  assert.ok(match, `${scenario.source} is neither checked in nor fetchable`);
  const deck = publicSources.decks.find(({ id }) => id === match[1]);
  assert.ok(deck, `${scenario.source} is missing from the public catalog`);
  assert.equal(deck.sha256, scenario.sourceSha256);
}

test("execution plan assigns a real PPTX and bounded operation routes to every scenario", () => {
  const plan = buildConformancePlan(capabilities, conformance);
  const scenarios = buildScenarioExecutionPlan(capabilities, conformance, plan);

  assert.equal(scenarios.length, 9);
  assert.equal(scenarios[0].name, "table-structure");
  assert.equal(scenarios.at(-1).name, "general-native-surface");
  scenarios.forEach(assertPinnedPublicSource);
  assert.ok(
    scenarios.every((scenario) => /^[0-9a-f]{64}$/.test(scenario.sourceSha256)),
  );
  assert.ok(scenarios.every((scenario) => scenario.allowedOperations.length));
  assert.deepEqual(
    scenarios.find((scenario) => scenario.name === "animation-timing")
      .allowedOperations,
    ["set_animation_timing"],
  );
});

test("partial family runs retain selected coverage without pretending a shared scenario is isolated", () => {
  const plan = buildConformancePlan(capabilities, conformance, {
    families: ["object_text"],
  });
  const [scenario] = buildScenarioExecutionPlan(
    capabilities,
    conformance,
    plan,
  );

  assert.equal(scenario.name, "general-native-surface");
  assert.ok(scenario.selectedOperations.includes("replace_text_range"));
  assert.ok(scenario.allowedOperations.includes("insert_slide"));
  assert.ok(!scenario.selectedOperations.includes("insert_slide"));
});

test("the runner supplies the contract-derived operation set to each probe", () => {
  const plan = buildConformancePlan(capabilities, conformance);
  const scenarios = buildScenarioExecutionPlan(capabilities, conformance, plan);
  const general = scenarios.find(
    (scenario) => scenario.name === "general-native-surface",
  );

  assert.ok(general.allowedOperations.includes("insert_slide"));
  assert.ok(general.allowedOperations.includes("set_slide_layout"));
  assert.ok(general.allowedOperations.includes("text_shadow"));
});

test("report operation extraction is stable for broad and dedicated probes", () => {
  assert.deepEqual(
    operationsFromReport({
      commands: ["move", { op: "resize" }, "move"],
      operation: "replace_text",
    }),
    ["move", "replace_text", "resize"],
  );
});

test("change budgets are derived from executed operation families and identity effects", () => {
  const budget = buildChangeBudget(
    capabilities,
    ["insert_slide", "set_speaker_notes"],
    null,
  );

  assert.equal(budget.allowPartCreationOrDeletion, true);
  assert.ok(budget.allowedCategories.includes("presentation"));
  assert.ok(budget.allowedCategories.includes("notes_parts"));
  assert.ok(!budget.allowedCategories.includes("unknown"));
});

test("browser origin matches the WOPI PostMessageOrigin contract", () => {
  assert.equal(localProbeBrowserOrigin(31_907), "http://localhost:31907");
  assert.throws(() => localProbeBrowserOrigin(0), /port is invalid/);
});

test("baseline probe output keeps only comparable persistence state", () => {
  assert.deepEqual(
    persistenceStateFromProbeOutput(
      JSON.stringify({
        revision: "ignored",
        slides: [{ slideIndex: 0 }],
        masters: [{ masterIndex: 0 }],
        images: [{ byteLength: 123 }],
      }),
    ),
    {
      slides: [{ slideIndex: 0 }],
      masters: [{ masterIndex: 0 }],
    },
  );
  assert.throws(
    () => persistenceStateFromProbeOutput("{}"),
    /returned no slide\/master state/,
  );
});

test("only extension connection timeouts qualify for read-only session retry", () => {
  assert.equal(
    isTransientEditorConnectionFailure(
      new Error("Native editor extension did not connect."),
    ),
    true,
  );
  assert.equal(
    isTransientEditorConnectionFailure(new Error("PPTX persistence failed")),
    false,
  );
});
