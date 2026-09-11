import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("render fidelity treats every element outline as primary evidence", () => {
  const analyzer = readFileSync(
    "scripts/analyze-render-differences.py",
    "utf8",
  );

  assert.match(
    analyzer,
    /Structural fidelity is evaluated before pixel residuals/,
  );
  assert.match(analyzer, /EDGE_CANNY_LOW = 50/);
  assert.match(analyzer, /kind != "connector"/);
  assert.match(analyzer, /"missing_in_render" if ref_count/);
  assert.match(analyzer, /"higherZOverlapAreaFraction"/);
  assert.match(analyzer, /"higherZOverlapRegionRmse"/);
  assert.match(analyzer, /"visibleCoreRegionRmse"/);
  assert.match(analyzer, /def slide_element_structural_roles/);
  assert.match(analyzer, /def slide_element_structural_traits/);
  assert.match(analyzer, /east_asian_line_break_implicit/);
  assert.match(analyzer, /east_asian_line_break_disabled/);
  assert.match(analyzer, /def slide_element_stroke_widths/);
  assert.match(analyzer, /def edge_internal_layout_metrics/);
  assert.match(analyzer, /def edge_geometry_metrics_from_edges/);
  assert.match(analyzer, /def slide_element_coverage_metrics/);
  assert.match(analyzer, /"edgeProjectionXEmdPx"/);
  assert.match(analyzer, /"edgeGridDistributionL1"/);
  assert.match(analyzer, /"internalTopologyChanged"/);
  assert.match(analyzer, /"unattributedInternalLayoutStatus"/);
  assert.match(analyzer, /stroke_half_width \+ 2/);
  assert.match(analyzer, /"worstIsolatedStructuralElements"/);
  for (const role of [
    "chart",
    "connector",
    "group",
    "picture",
    "smartart",
    "table",
    "text_shape",
  ])
    assert.match(analyzer, new RegExp(`\\"${role}\\"`));
});

test("candidate comparisons fail closed on structural regressions", () => {
  const comparator = readFileSync(
    "scripts/compare-render-structures.py",
    "utf8",
  );
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.match(comparator, /Pixel RMSE\s+does not participate/);
  assert.match(comparator, /"presence_mismatch": 3/);
  assert.match(comparator, /"hardRegression"/);
  assert.match(comparator, /"blockingMissingElements"/);
  assert.match(comparator, /"mixedMetricMovements"/);
  assert.match(comparator, /INTERNAL_STATUS_RANK/);
  assert.match(comparator, /load_unattributed_regions/);
  assert.match(comparator, /blockingMissingUnattributedRegions/);
  assert.match(comparator, /"byStructuralTrait"/);
  assert.equal(
    packageJson.scripts["corpus:compare-structures"],
    "python3 scripts/compare-render-structures.py",
  );
  assert.equal(
    packageJson.scripts["corpus:review-structures"],
    "python3 scripts/build-structure-regression-montages.py",
  );
});

test("internal layout metrics detect structure moving inside an unchanged box", () => {
  const source = String.raw`
import importlib.util
import numpy as np
import cv2

spec = importlib.util.spec_from_file_location("analysis", "scripts/analyze-render-differences.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
reference = np.full((120, 200, 3), 255, dtype=np.uint8)
candidate = reference.copy()
cv2.rectangle(reference, (15, 20), (80, 80), (0, 0, 0), 2)
cv2.rectangle(candidate, (95, 20), (160, 80), (0, 0, 0), 2)
same = module.edge_geometry_metrics(reference, reference)
moved = module.edge_geometry_metrics(reference, candidate)
assert same["internalLayoutStatus"] == "aligned", same
assert same["edgeGridDistributionL1"] == 0, same
assert moved["internalLayoutStatus"] == "topology_changed", moved
assert moved["edgeProjectionXEmdPx"] > 50, moved
assert moved["edgeGridDistributionL1"] > 1, moved
`;
  const result = spawnSync("python3", ["-c", source], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("hard-regression review includes improved outcomes and is not truncated at 100", () => {
  const source = String.raw`
import importlib.util
spec = importlib.util.spec_from_file_location("review", "scripts/build-structure-regression-montages.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
rows = [{"key": str(i), "corpus": "real", "hardRegression": True, "outcome": "improved"} for i in range(188)]
assert len(module.select_review_rows({"hardRegressionRows": rows}, hard_only=True)) == 188
assert len(module.select_review_rows({"hardRegressionRows": rows}, hard_only=True, limit=4)) == 4
assert not module.select_review_rows({"hardRegressionRows": rows}, corpus="public", hard_only=True)
legacy = {"worstRegressions": rows[:1], "largestImprovements": rows[:2]}
assert len(module.select_review_rows(legacy, hard_only=True)) == 2
assert len(module.select_review_rows({"worstRegressions": rows})) == 100
`;
  const result = spawnSync("python3", ["-c", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("structural traits distinguish implicit, enabled, and disabled East Asian line breaking", () => {
  const source = String.raw`
import importlib.util
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location("analysis", "scripts/analyze-render-differences.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
namespace = "http://schemas.openxmlformats.org/drawingml/2006/main"

def descendants(value):
    return list(ET.fromstring(value).iter())

implicit = module.east_asian_line_break_traits(descendants(
    f'<a:p xmlns:a="{namespace}"><a:r><a:t>이해하고</a:t></a:r></a:p>'
))
enabled = module.east_asian_line_break_traits(descendants(
    f'<a:p xmlns:a="{namespace}"><a:pPr eaLnBrk="1"/><a:r><a:t>理解</a:t></a:r></a:p>'
))
disabled = module.east_asian_line_break_traits(descendants(
    f'<a:p xmlns:a="{namespace}"><a:pPr eaLnBrk="0"/><a:r><a:t>テスト</a:t></a:r></a:p>'
))
latin = module.east_asian_line_break_traits(descendants(
    f'<a:p xmlns:a="{namespace}"><a:pPr eaLnBrk="1"/><a:r><a:t>Latin</a:t></a:r></a:p>'
))
assert implicit == {"text_east_asian_content", "text_east_asian_line_break_implicit"}, implicit
assert enabled == {"text_east_asian_content", "text_east_asian_line_break_enabled"}, enabled
assert disabled == {"text_east_asian_content", "text_east_asian_line_break_disabled"}, disabled
assert latin == set(), latin
`;
  const result = spawnSync("python3", ["-c", source], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("an outline improvement cannot hide an internal topology regression", () => {
  const source = String.raw`
import importlib.util

spec = importlib.util.spec_from_file_location("comparison", "scripts/compare-render-structures.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
baseline = {
    "outlineStatus": "displaced",
    "internalLayoutStatus": "aligned",
}
candidate = {
    "outlineStatus": "aligned_1px",
    "internalLayoutStatus": "topology_changed",
}
assert module.classify_pair(baseline, candidate) == ("mixed", True)
`;
  const result = spawnSync("python3", ["-c", source], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
