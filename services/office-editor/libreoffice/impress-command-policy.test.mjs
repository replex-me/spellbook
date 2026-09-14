import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  semanticFamilyForCommand,
  semanticFamilyRules,
} from "./impress-command-policy.mjs";

const capabilityMatrix = JSON.parse(
  readFileSync("contracts/impress-ai-capability-matrix.json", "utf8"),
);

test("raw Impress commands route to product semantic families", () => {
  const cases = [
    [".uno:Save", "platform_owned", "document_lifecycle"],
    [".uno:ExportDirectToPDF", "platform_owned", "file_export_print_share"],
    [".uno:Zoom100Percent", "human_editor_state", "view_navigation_presenter"],
    [".uno:RunMacro", "security_excluded", "macros_forms_external_automation"],
    [".uno:InsertSlide", "document_mutation_candidate", "slide_structure"],
    [".uno:InsertTable", "document_mutation_candidate", "tables"],
    [".uno:InsertObjectChart", "document_mutation_candidate", "charts_data"],
    [
      ".uno:ConnectorCurveArrows",
      "document_mutation_candidate",
      "connectors_freeform_3d_fontwork",
    ],
    [
      ".uno:GraphicFilterSepia",
      "document_mutation_candidate",
      "pictures_media",
    ],
    [
      ".uno:ObjectTitleDescription",
      "document_mutation_candidate",
      "notes_comments_accessibility",
    ],
    [
      ".uno:CustomAnimation",
      "interactive_document_ui",
      "animations_transitions_timing",
    ],
  ];
  for (const [command, category, expected] of cases)
    assert.equal(
      semanticFamilyForCommand(command, category),
      expected,
      command,
    );
});

test("command policy routes only to declared product semantic families", () => {
  const declared = new Set(
    capabilityMatrix.semanticFamilies.map((family) => family.id),
  );
  for (const rule of semanticFamilyRules)
    assert.ok(declared.has(rule.family), rule.family);
  assert.equal(
    capabilityMatrix.operationCoverage.rawUiCommandRouting.count,
    725,
  );
  assert.equal(
    capabilityMatrix.operationCoverage.rawUiCommandRouting.unmapped,
    0,
  );
  assert.equal(
    capabilityMatrix.operationCoverage.rawUiCommandRouting.routedFamilyCount,
    19,
  );
  assert.deepEqual(
    capabilityMatrix.operationCoverage.rawUiCommandRouting
      .familiesWithoutRawUiCommands,
    ["smartart_diagrams"],
  );
});

test("unknown document commands stay explicitly unmapped", () => {
  assert.equal(
    semanticFamilyForCommand(
      ".uno:CompletelyUnknownDocumentCommand",
      "document_mutation_candidate",
    ),
    null,
  );
  assert.throws(
    () => semanticFamilyForCommand("unsafe", "document_mutation_candidate"),
    /Invalid Impress command/u,
  );
});
