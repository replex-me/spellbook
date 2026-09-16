import assert from "node:assert/strict";
import test from "node:test";

import { cumulativeUiTestErrors } from "./verify-cumulative-source.mjs";

test("accepts balanced cumulative UI test source with pinned includes and pointer types", () => {
  const source = `
#include <unokywds.hxx>
static constexpr OUString aJson = uR"json({"ok":true})json"_ustr;
CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testExample) {
  CPPUNIT_ASSERT_EQUAL(static_cast<SdrObject*>(pOriginal.get()), pPage->GetObj(0));
  auto layer = sUNO_LayerName_background_objects;
}
`;
  assert.deepEqual(cumulativeUiTestErrors(source), []);
});

test("rejects a later fixture spliced into an earlier raw string", () => {
  const source = `
static constexpr OUString aJson = uR"json({
CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testSpliced) {}
})json"_ustr;
`;
  assert.match(
    cumulativeUiTestErrors(source).join("; "),
    /test fixture nested in raw string/u,
  );
});

test("rejects an unterminated raw string and unbound pinned-source APIs", () => {
  const source = `
auto layer = sUNO_LayerName_background_objects;
CPPUNIT_ASSERT_EQUAL(pInserted.get(), pPage->GetObj(0));
static constexpr OUString aJson = uR"json({
`;
  const errors = cumulativeUiTestErrors(source).join("; ");
  assert.match(errors, /unterminated raw string/u);
  assert.match(errors, /without unokywds\.hxx/u);
  assert.match(errors, /without an SdrObject cast/u);
});
