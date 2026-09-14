import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";

import { applyOoxmlCommand } from "./ooxml-worker-source.mjs";

const fixtureUrl = new URL(
  "../../eval/public/fixtures/general-native-surface.pptx",
  import.meta.url,
);

test("browser OOXML worker adds one slide without rewriting existing parts", async () => {
  const source = new Uint8Array(await readFile(fixtureUrl));
  const before = unzipSync(source);
  const { bytes, report } = applyOoxmlCommand(source, {
    op: "add_slide",
    templateSlideIndex: 0,
    insertIndex: 1,
  });
  const after = unzipSync(bytes);
  assert.equal(report.slideCount, 2);
  assert.ok(after["ppt/slides/slide2.xml"]);
  assert.ok(after["ppt/slides/_rels/slide2.xml.rels"]);
  assert.equal(
    hash(after["ppt/slides/slide1.xml"]),
    hash(before["ppt/slides/slide1.xml"]),
  );
  assert.equal(
    hash(after["ppt/theme/theme1.xml"]),
    hash(before["ppt/theme/theme1.xml"]),
  );
  const presentation = strFromU8(after["ppt/presentation.xml"]);
  assert.equal((presentation.match(/<p:sldId\b/gu) ?? []).length, 2);
  assert.deepEqual(slidePaths(after), [
    "ppt/slides/slide1.xml",
    "ppt/slides/slide2.xml",
  ]);
  assert.deepEqual(report.changedParts, [
    "[Content_Types].xml",
    "ppt/_rels/presentation.xml.rels",
    "ppt/presentation.xml",
    "ppt/slides/_rels/slide2.xml.rels",
    "ppt/slides/slide2.xml",
  ]);
});

test("browser OOXML worker duplicates, moves, and deletes through one package topology", async () => {
  const source = new Uint8Array(await readFile(fixtureUrl));
  const original = unzipSync(source);
  const duplicated = applyOoxmlCommand(source, {
    op: "duplicate_slide",
    slideIndex: 0,
    insertIndex: 0,
  });
  const duplicateEntries = unzipSync(duplicated.bytes);
  assert.equal(duplicated.report.slideCount, 2);
  assert.deepEqual(slidePaths(duplicateEntries), [
    "ppt/slides/slide2.xml",
    "ppt/slides/slide1.xml",
  ]);
  assert.equal(
    hash(duplicateEntries["ppt/slides/slide2.xml"]),
    hash(original["ppt/slides/slide1.xml"]),
  );
  assert.equal(
    hash(duplicateEntries["ppt/slides/slide1.xml"]),
    hash(original["ppt/slides/slide1.xml"]),
  );
  assert.equal(
    hash(duplicateEntries["ppt/theme/theme1.xml"]),
    hash(original["ppt/theme/theme1.xml"]),
  );

  const moved = applyOoxmlCommand(duplicated.bytes, {
    op: "move_slide",
    slideIndex: 0,
    insertIndex: 1,
  });
  const movedEntries = unzipSync(moved.bytes);
  assert.deepEqual(slidePaths(movedEntries), [
    "ppt/slides/slide1.xml",
    "ppt/slides/slide2.xml",
  ]);
  assert.deepEqual(moved.report.changedParts, ["ppt/presentation.xml"]);
  assert.deepEqual(changedLogicalParts(duplicateEntries, movedEntries), [
    "ppt/presentation.xml",
  ]);

  const deleted = applyOoxmlCommand(moved.bytes, {
    op: "delete_slide",
    slideIndex: 1,
  });
  const deletedEntries = unzipSync(deleted.bytes);
  assert.equal(deleted.report.slideCount, 1);
  assert.deepEqual(slidePaths(deletedEntries), ["ppt/slides/slide1.xml"]);
  assert.deepEqual(deleted.report.removedParts, ["ppt/slides/slide2.xml"]);
  assert.equal(deletedEntries["ppt/slides/slide2.xml"], undefined);
  assert.equal(deletedEntries["ppt/slides/_rels/slide2.xml.rels"], undefined);
  assert.deepEqual(
    Object.keys(deletedEntries).sort(),
    Object.keys(original).sort(),
  );
  assert.equal(
    hash(deletedEntries["ppt/slides/slide1.xml"]),
    hash(original["ppt/slides/slide1.xml"]),
  );
  assert.equal(
    hash(deletedEntries["ppt/theme/theme1.xml"]),
    hash(original["ppt/theme/theme1.xml"]),
  );
});

test("browser OOXML worker clones and garbage-collects owned dependency graphs", async () => {
  const source = withOwnedDependencyGraph(
    new Uint8Array(await readFile(fixtureUrl)),
  );
  const duplicated = applyOoxmlCommand(source, {
    op: "duplicate_slide",
    slideIndex: 0,
    insertIndex: 1,
  });
  const duplicateEntries = unzipSync(duplicated.bytes);
  const clonedChart = "ppt/charts/chart1-spellbook-1.xml";
  const clonedWorkbook =
    "ppt/embeddings/Microsoft_Excel_Worksheet1-spellbook-1.xlsx";
  assert.ok(duplicateEntries[clonedChart]);
  assert.ok(
    duplicateEntries[
      `${clonedChart.slice(0, 11)}_rels/${clonedChart.slice(11)}.rels`
    ],
  );
  assert.ok(duplicateEntries[clonedWorkbook]);
  assert.equal(
    hash(duplicateEntries[clonedChart]),
    hash(duplicateEntries["ppt/charts/chart1.xml"]),
  );
  assert.equal(
    hash(duplicateEntries[clonedWorkbook]),
    hash(duplicateEntries["ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx"]),
  );

  const deleted = applyOoxmlCommand(duplicated.bytes, {
    op: "delete_slide",
    slideIndex: 1,
  });
  const deletedEntries = unzipSync(deleted.bytes);
  assert.deepEqual(deleted.report.removedParts, [
    clonedChart,
    clonedWorkbook,
    "ppt/slides/slide2.xml",
  ]);
  assert.equal(deletedEntries[clonedChart], undefined);
  assert.equal(deletedEntries[clonedWorkbook], undefined);
  assert.ok(deletedEntries["ppt/charts/chart1.xml"]);
  assert.ok(deletedEntries["ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx"]);
});

test("browser OOXML worker refuses to delete the final slide", async () => {
  const source = new Uint8Array(await readFile(fixtureUrl));
  assert.throws(
    () =>
      applyOoxmlCommand(source, {
        op: "delete_slide",
        slideIndex: 0,
      }),
    /last slide cannot be deleted/iu,
  );
});

test("browser OOXML worker rejects non-PPTX and unsupported commands", async () => {
  assert.throws(
    () =>
      applyOoxmlCommand(new Uint8Array([1, 2, 3]), {
        op: "add_slide",
        templateSlideIndex: 0,
        insertIndex: 1,
      }),
    /PPTX ZIP end record is missing/iu,
  );
  const source = new Uint8Array(await readFile(fixtureUrl));
  assert.throws(
    () =>
      applyOoxmlCommand(source, {
        op: "replace_text",
      }),
    /Unsupported browser OOXML operation/iu,
  );
});

test("browser OOXML worker rejects unsafe package paths before mutation", () => {
  const unsafe = zipSync({
    "../outside.xml": strToU8("<outside/>", true),
  });
  assert.throws(
    () =>
      applyOoxmlCommand(unsafe, {
        op: "add_slide",
        templateSlideIndex: 0,
        insertIndex: 1,
      }),
    /Unsafe or duplicate PPTX ZIP entry/iu,
  );
});

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function changedLogicalParts(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names]
    .filter(
      (name) =>
        !before[name] ||
        !after[name] ||
        hash(before[name]) !== hash(after[name]),
    )
    .sort();
}

function slidePaths(entries) {
  const presentationNamespace =
    "http://schemas.openxmlformats.org/presentationml/2006/main";
  const relationshipAttributeNamespace =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const packageRelationshipNamespace =
    "http://schemas.openxmlformats.org/package/2006/relationships";
  const presentation = new DOMParser().parseFromString(
    strFromU8(entries["ppt/presentation.xml"]),
    "application/xml",
  );
  const relationships = new DOMParser().parseFromString(
    strFromU8(entries["ppt/_rels/presentation.xml.rels"]),
    "application/xml",
  );
  const targets = new Map(
    [
      ...relationships.getElementsByTagNameNS(
        packageRelationshipNamespace,
        "Relationship",
      ),
    ].map((relationship) => [
      relationship.getAttribute("Id"),
      relationship.getAttribute("Target"),
    ]),
  );
  return [
    ...presentation.getElementsByTagNameNS(presentationNamespace, "sldId"),
  ].map((slideId) => {
    const relationshipId = slideId.getAttributeNS(
      relationshipAttributeNamespace,
      "id",
    );
    const target = targets.get(relationshipId);
    assert.ok(target, `Missing relationship ${relationshipId}`);
    return new URL(
      target,
      "https://package.invalid/ppt/presentation.xml",
    ).pathname.replace(/^\//u, "");
  });
}

function withOwnedDependencyGraph(source) {
  const entries = unzipSync(source);
  const slideRelationshipsPath = "ppt/slides/_rels/slide1.xml.rels";
  const slideRelationships = strFromU8(entries[slideRelationshipsPath]).replace(
    "</Relationships>",
    '<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
  );
  entries[slideRelationshipsPath] = strToU8(slideRelationships);
  entries["ppt/charts/chart1.xml"] = strToU8(
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
  );
  entries["ppt/charts/_rels/chart1.xml.rels"] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/Microsoft_Excel_Worksheet1.xlsx"/></Relationships>',
  );
  entries["ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx"] = strToU8(
    "owned-workbook-fixture",
  );
  const contentTypes = strFromU8(entries["[Content_Types].xml"]).replace(
    "</Types>",
    '<Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>',
  );
  entries["[Content_Types].xml"] = strToU8(contentTypes);
  return zipSync(entries, { level: 6 });
}
