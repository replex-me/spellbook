import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Korean sans-serif fallback preserves explicit families and layout language", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      String.raw`
import json, xml.etree.ElementTree as ET
p = ET.parse('services/fonts/spellbook-korean-fallback.conf').getroot()
m = p.findall('match')
assert len(m) == 1 and m[0].get('target') == 'pattern'
tests = {x.get('name'): (x.get('compare'), x.findtext('string')) for x in m[0].findall('test')}
edits = [(x.attrib, x.findtext('string')) for x in m[0].findall('edit')]
print(json.dumps({'tests': tests, 'edits': edits}))
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const policy = JSON.parse(result.stdout);
  assert.deepEqual(policy.tests, {
    lang: ["contains", "ko"],
    family: ["eq", "sans-serif"],
  });
  assert.deepEqual(policy.edits, [
    [
      {
        name: "family",
        mode: "append_last",
        binding: "strong",
      },
      "Malgun Gothic",
    ],
  ]);
  for (const dockerfile of [
    "services/document-worker/Dockerfile",
    "services/office-editor/Dockerfile",
  ]) {
    const source = readFileSync(dockerfile, "utf8");
    assert.match(
      source,
      /COPY (?:--from=open-fonts )?services\/fonts\/install-open-fonts\.sh \/usr\/local\/bin\/install-spellbook-open-fonts/,
    );
    assert.match(
      source,
      /spellbook-korean-fallback\.conf \/etc\/fonts\/conf\.d\/99-spellbook-korean-fallback\.conf/,
    );
    assert.match(
      source,
      /fc-match --format='%\{family\}' Arial\)" = "Liberation Sans"/,
    );
  }
});
