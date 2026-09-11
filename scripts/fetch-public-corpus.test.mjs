import assert from "node:assert/strict";
import test from "node:test";

import {
  assessCoverage,
  detectPptxFeatures,
  preserveReferenceState,
  validateCatalog,
} from "./fetch-public-corpus.mjs";

const matrix = {
  contractVersion: "1.0",
  features: [
    { id: "basic-shape", verification: "render-and-edit", minimumFixtures: 1 },
    { id: "chart", verification: "render-and-preserve", minimumFixtures: 1 },
    { id: "activex", verification: "preserve-only", minimumFixtures: 1 },
    { id: "macro", verification: "excluded", minimumFixtures: 0 },
  ],
};

test("detects structural, visual, and preservation-only PPTX features", () => {
  const detected = detectPptxFeatures({
    entries: [
      "ppt/slides/slide1.xml",
      "ppt/charts/chart1.xml",
      "ppt/activeX/activeX1.xml",
      "ppt/media/image1.svg",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout1.xml",
    ],
    xml: '<p:sldSz cx="1" cy="1"/>',
    visualXml:
      "<p:sp><a:gradFill/><a:srcRect/><p:timing/><p:transition/></p:sp>",
    relationships:
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External"/>',
  });
  assert.deepEqual(
    [
      "activex",
      "animation",
      "basic-shape",
      "chart",
      "external-relationship",
      "gradient-fill",
      "hyperlink",
      "picture-crop",
      "slide-master-layout",
      "slide-size",
      "transition",
      "vector-image",
    ].sort(),
    detected,
  );
});

test("catalogs require pinned revisions, hashes, sizes, and known features", () => {
  const catalog = {
    contractVersion: "1.0",
    repositories: [
      {
        id: "upstream",
        repositoryUrl: "https://github.com/example/project",
        revision: "a".repeat(40),
        license: {
          spdx: "MIT",
          url: "https://example.test/license",
          scope:
            "Repository-level license only; fixture provenance not audited.",
        },
      },
    ],
    decks: [
      {
        id: "fixture",
        repository: "upstream",
        path: "fixtures/example.pptx",
        bytes: 42,
        sha256: "b".repeat(64),
        expectedFeatures: ["basic-shape"],
      },
    ],
  };
  assert.doesNotThrow(() => validateCatalog(catalog, matrix));
  catalog.decks[0].expectedFeatures = ["invented-feature"];
  assert.throws(() => validateCatalog(catalog, matrix), /Unknown feature/u);
});

test("coverage excludes desktop-only scope but fails uncovered web scope", () => {
  const incomplete = assessCoverage(matrix, [
    { detectedFeatures: ["basic-shape", "activex"] },
  ]);
  assert.equal(incomplete.status, "incomplete");
  assert.deepEqual(incomplete.gaps, [
    { feature: "chart", expected: 1, actual: 0 },
  ]);

  const complete = assessCoverage(matrix, [
    { detectedFeatures: ["basic-shape", "chart", "activex"] },
  ]);
  assert.equal(complete.status, "pass");
  assert.equal(complete.counts.macro, 0);
});

test("refreshing the public catalog preserves matching PowerPoint references", () => {
  const refreshed = preserveReferenceState(
    {
      corpusId: "public-corpus",
      referenceRenderer: { version: "not-recorded" },
      decks: [
        { id: "same", source: "downloads/same.pptx" },
        { id: "changed", source: "downloads/changed.pptx" },
      ],
    },
    {
      corpusId: "public-corpus",
      referenceRenderer: { version: "16.109.1" },
      referenceFailures: [{ id: "failed" }],
      decks: [
        {
          id: "same",
          source: "downloads/same.pptx",
          references: "references/same",
        },
        {
          id: "changed",
          source: "downloads/old.pptx",
          references: "references/changed",
        },
      ],
    },
  );

  assert.equal(refreshed.referenceRenderer.version, "16.109.1");
  assert.equal(refreshed.decks[0].references, "references/same");
  assert.equal(refreshed.decks[1].references, undefined);
  assert.deepEqual(refreshed.referenceFailures, [{ id: "failed" }]);
});
