import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("PDF advance measurement uses text origins, not glyph boxes", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      String.raw`
import importlib.util, sys
spec = importlib.util.spec_from_file_location('geometry', 'scripts/compare-pdf-text-geometry.py')
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
def char(x, y=0):
    return m.Char('A', x, x+8, y, y+10, 'test', 10, 'latin', x, y)
chars = [char(0), char(6), char(17)]
m.set_origin_advances(chars, [1,0])
assert [c.advance for c in chars] == [6,11,None]
vertical = [char(0,0), char(0,12)]
m.set_origin_advances(vertical, [0,1])
assert vertical[0].advance == 12
rtl = [char(20), char(10)]
m.set_origin_advances(rtl, [-1,0])
assert rtl[0].advance == 10
print('passed')
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed/);
});

test("PDF style review catches weight and size losses without guessing across changed text", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      String.raw`
import importlib.util, sys
spec = importlib.util.spec_from_file_location('geometry', 'scripts/compare-pdf-text-geometry.py')
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
def line(font, size, bold, italic, text='AB'):
    chars = [m.Char(c, 0, 8, 0, 10, font, size, 'latin', reported_bold=bold, reported_italic=italic) for c in text]
    return m.Line(1, 0, text, 0, 16, 5, chars)
a = line('Face-BoldItalic', 54, True, True)
b = line('Fallback-Regular', 50, False, False)
r = m.compare_character_styles(a, b)
assert r['reportedBoldLossCharacters'] == 2
assert r['reportedItalicLossCharacters'] == 2
assert r['sizeChangedCharacters'] == 2
assert r['fontTransitions'][0]['characters'] == 2
assert m.compare_character_styles(a, a)['reportedBoldLossCharacters'] == 0
assert m.compare_character_styles(a, line('Other', 54, False, False, 'AC')) is None
assert m.compare_character_styles(a, line('Other', 54, None, None))['reportedBoldLossCharacters'] == 0
assert m.compare_character_styles(a, line('Other', 54, False, False, 'A B'))['reportedBoldLossCharacters'] == 2
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
