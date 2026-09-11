import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function runPython(source) {
  const result = spawnSync("python3", ["-c", source], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runCpp(source) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spellbook-cpp-test-"));
  try {
    const binary = path.join(directory, "test");
    const compilation = spawnSync(
      "c++",
      ["-x", "c++", "-std=c++17", "-o", binary, "-"],
      { encoding: "utf8", input: source },
    );
    assert.equal(compilation.status, 0, compilation.stderr);
    const result = spawnSync(binary, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("derives PowerPoint baseline shifts from actual font ascent and descent", () => {
  const values = runPython(String.raw`
import json, sys
sys.path.insert(0, "services/document-worker/scripts")
from powerpoint_text_metrics import FontVerticalMetrics
cases = {
    "sangsang": FontVerticalMetrics(1000, 800, 200, False),
    "calibri": FontVerticalMetrics(2048, 1950, 550, False),
    "trebuchet": FontVerticalMetrics(2048, 1923, 455, False),
}
print(json.dumps({key: value.baseline_shift_percent for key, value in cases.items()}))
`);

  assert.ok(Math.abs(values.sangsang - 4) < 1e-12);
  assert.ok(Math.abs(values.calibri - 6.4) < 1e-12);
  assert.ok(Math.abs(values.trebuchet - 2.960470984020181) < 1e-12);
});

const PATCH_ROOT = "services/document-worker/libreoffice/patches";
const PATCH_SERIES = [
  "0001-oox-powerpoint-text-import.patch",
  "0002-fix-source-tarball-module-symlinks.patch",
  "0003-powerpoint-text-layout-compat.patch",
  "0004-hangul-glyph-fallback-language.patch",
];

function readPatch(name) {
  const patchPath = `${PATCH_ROOT}/${name}`;
  const patchSyntax = spawnSync(
    "git",
    ["apply", "--numstat", path.resolve(patchPath)],
    {
      cwd: os.tmpdir(),
      encoding: "utf8",
    },
  );
  assert.equal(patchSyntax.status, 0, patchSyntax.stderr);
  return readFileSync(patchPath, "utf8");
}

test("import patch transports PPTX text semantics through existing model properties", () => {
  const patch = readPatch(PATCH_SERIES[0]);

  // Only oox files: the importer never reaches into the layout engine.
  const files = [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
  assert.ok(files.length > 0);
  for (const file of files) assert.match(file, /^oox\//, file);

  // eaLnBrk = East Asian (kinsoku) line breaking rules.
  assert.match(patch, /XML_eaLnBrk/);
  assert.match(patch, /PROP_ParaIsForbiddenRules/);
  assert.match(patch, /properties\.txt[\s\S]*\+ParaIsForbiddenRules/);
  // kern = pair kerning threshold in hundredths of a point.
  assert.match(patch, /XML_kern/);
  assert.match(patch, /moKerning/);
  assert.match(patch, /PROP_CharAutoKerning/);
  assert.match(patch, /moHeight\.value\(\) >= moKerning\.value\(\)/);
  assert.match(patch, /properties\.txt[\s\S]*\+CharAutoKerning/);
  // normAutofit fontScale / lnSpcReduction are percentages on the shape.
  assert.match(
    patch,
    /PROP_TextFitToSizeFontScale, mrTextBodyProp\.mnFontScale \/ 1000\.0/,
  );
  assert.match(
    patch,
    /PROP_TextFitToSizeSpacingScale, \(100000 - mrTextBodyProp\.mnSpacingScale\) \/ 1000\.0/,
  );
  assert.doesNotMatch(patch, /^\+.*mnFontScale \/ 100000\.0/m);
  // Do not force every weak character into the Latin font. PowerPoint's
  // East Asian runs use their Asian font for stars, hearts and circled digits.
  // The hint belongs to ASCII spans in TextRun, not every character property.
  assert.match(patch, /return !bComplex && c >= 0x20 && c <= 0x7e/);
  assert.match(
    patch,
    /useLatinSlot\(getText\(\)\[nIndex \+ nCount\]\) == bLatinSlot/,
  );
  assert.match(patch, /ScriptHintType::AUTOMATIC/);
  // Upstream resolves an explicit a:sym font into CharFontName and sets
  // bReset. Those PUA glyphs must use that slot, not contextual Asian fallback.
  assert.match(
    patch,
    /PROP_CharScriptHint, \(bLatinSlot \|\| bReset\)\n\+\s+\? css::text::ScriptHintType::LATIN/,
  );
  const characterSection = patch
    .split("diff --git a/oox/source/drawingml/textcharacterproperties.cxx")[1]
    .split("diff --git")[0];
  assert.doesNotMatch(characterSection, /PROP_CharScriptHint/);
  // Keep the existing default-property mapping. Only actual strong scripts in
  // TextRun receive the declared language; neutral punctuation must not stamp
  // unrelated locale slots and change adjacent CJK break decisions.
  assert.doesNotMatch(characterSection, /^\+.*PROP_CharLocale/m);
  for (const slot of ["CharLocale", "CharLocaleAsian", "CharLocaleComplex"])
    assert.match(
      patch,
      new RegExp(`rProperties.setProperty\\(PROP_${slot}, aLocale\\)`),
    );
  assert.match(patch, /getText\(\).iterateCodePoints\(&nOffset\)/);
  assert.match(patch, /uscript_getScript\(nCharacter, &nError\)/);
  assert.match(patch, /unicode::getScriptClassFromUScriptCode\(eScript\)/);
  assert.doesNotMatch(patch, /^\+.*case .*ScriptType::WEAK/m);
  assert.match(patch, /if \(!nLanguageScripts\)\n\+\s+return/);
  assert.equal((patch.match(/^\+\s+applyRunLanguage\(/gm) ?? []).length, 3);
  assert.match(patch, /Library_oox.mk/);
  assert.match(patch, /^\+\s+icuuc/m);
  // No environment switches and no per-run space hacks in the importer.
  assert.doesNotMatch(patch, /getenv/);
  assert.doesNotMatch(patch, /IsAsciiSpaceRun/);
});

test("layout patch adds PowerPoint behaviour as document compatibility flags", () => {
  const patch = readPatch(PATCH_SERIES[2]);

  const files = [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(files.sort(), [
    "editeng/source/editeng/impedit.hxx",
    "editeng/source/editeng/impedit3.cxx",
    "include/editeng/editstat.hxx",
    "include/vcl/outdev.hxx",
    "sd/source/ui/docshell/docshel4.cxx",
    "vcl/inc/font/FontMetricData.hxx",
    "vcl/source/font/fontmetric.cxx",
    "vcl/source/outdev/font.cxx",
  ]);

  // The flags are EditEngine control bits, switched on by the PPTX import hook
  // next to the existing ULSPACESUMMATION compatibility bit.
  assert.match(patch, /FIXEDCELLFONTMETRICBASELINE = 0x08000000/);
  assert.match(patch, /WORDSPLITWITHOUTHYPHEN = 0x10000000/);
  assert.match(patch, /is_typed_flags<EEControlBits, 0x1fffffff>/);
  assert.match(
    patch,
    /ULSPACESUMMATION;[\s\S]*FIXEDCELLFONTMETRICBASELINE[\s\S]*WORDSPLITWITHOUTHYPHEN[\s\S]*SetControlWord\( nControlWord \)/,
  );
  assert.match(patch, /SvxScriptSpaceItem\(false, EE_PARA_ASIANCJKSPACING\)/);
  // A single documented A/B switch, read only in the import hook.
  const getenvLines = patch.match(/^\+.*getenv.*$/gm) ?? [];
  assert.equal(getenvLines.length, 1, getenvLines.join("\n"));
  assert.match(getenvLines[0], /SPELLBOOK_POWERPOINT_COMPAT/);
  const sections = patch.split(/^diff --git /m).filter(Boolean);
  const section = (file) => sections.find((s) => s.startsWith(`a/${file} `));
  assert.match(
    section("sd/source/ui/docshell/docshel4.cxx"),
    /SPELLBOOK_POWERPOINT_COMPAT/,
  );
  for (const file of files.filter((f) => !f.startsWith("sd/")))
    assert.doesNotMatch(section(file), /SPELLBOOK_|getenv/, file);

  // Baseline rule: hhea ratio inside the fixed cell box, from cached metrics.
  assert.match(patch, /FontMetricData::ImplCalcLineSpacing/);
  assert.doesNotMatch(patch, /^\+.*hb_ot_metrics_get_position/m);
  assert.match(patch, /GetFontHheaMetrics/);
  assert.match(patch, /if \(!ImplNewFont\(\)\)/);
  assert.match(patch, /mnHheaAscent = nAscent/);
  assert.match(patch, /mnHheaDescent = nDescent/);
  assert.match(
    patch,
    /maStatus\.UseFixedCellFontMetricBaseline\(\) && !GetVertical\(\)/,
  );
  assert.match(patch, /ApplyFontMetricBaseline\(\)/);
  assert.match(patch, /GetHeight\(\) != nFontMetricLineHeight/);
  assert.match(patch, /bFontMetricBaselineCompatible = false/);
  assert.match(patch, /NeedsArtificialBold\(\)/);
  assert.match(patch, /nDifference \* 10 > nFontHeight/);

  // Word split rule: relax Korean word protection only, not Latin wrapping.
  assert.match(
    patch,
    /maStatus\.AllowWordSplitWithoutHyphen\(\) && bCanHyphenate && !bHyphenated/,
  );
  // Keep Korean word protection when the paragraph does not allow splitting.
  // The import layer, not a blanket split, fixes missing run language.
  assert.match(patch, /FindWordSplitPosition/);
  assert.match(patch, /CharacterIteratorMode::SKIPCELL/);
  assert.match(patch, /forbiddenEndCharacters\.indexOf\(cBefore\)/);
  assert.match(patch, /forbiddenBeginCharacters\.indexOf\(cAfter\)/);
  assert.match(patch, /IsGlueCharacter/);
  assert.match(patch, /IsHangulCell\(cBefore\) && IsHangulCell\(cAfter\)/);
  assert.match(
    patch,
    /bCanHyphenate && !maStatus\.AllowWordSplitWithoutHyphen\(\)/,
  );
  assert.doesNotMatch(patch, /IsEastAsianBreakCharacter/);
  assert.doesNotMatch(patch, /bLeavesSingleTerminalCell/);
  assert.doesNotMatch(patch, /UsePowerPointEastAsianLineBreak/);
  // Kinsoku stays on the paragraph property that eaLnBrk imports into.
  assert.doesNotMatch(patch, /^\+.*applyForbiddenRules\s*=/m);
});

test("the actual C++ word and font predicates preserve script boundaries", () => {
  const patch = readPatch(PATCH_SERIES[2]);
  const added = patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  const body = added.match(
    /bool IsHangulCell\(sal_Unicode c\)\n\{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(body);
  const importAdded = readPatch(PATCH_SERIES[0])
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  const latinPredicate = importAdded.match(
    /const auto useLatinSlot = \[bComplex\]\(sal_Unicode c\) \{[\s\S]*?\};/,
  )?.[0];
  assert.ok(latinPredicate);
  runCpp(
    `#include <cassert>\nusing sal_Unicode = char16_t;\n${body}\nbool latin(bool bComplex, sal_Unicode c) { ${latinPredicate} return useLatinSlot(c); }\nint main() { assert(IsHangulCell(u'가')); assert(IsHangulCell(u'힣')); assert(IsHangulCell(0x1100)); assert(!IsHangulCell(u'D')); assert(!IsHangulCell(u'中')); assert(!IsHangulCell(u'★')); assert(!IsHangulCell(0xd800)); assert(latin(false, u' ')); assert(latin(false, u'A')); assert(latin(false, u'1')); assert(latin(false, u',')); assert(!latin(true, u' ')); assert(!latin(false, u'★')); assert(!latin(false, u'①')); assert(!latin(false, u'‘')); assert(!latin(false, u'가')); assert(!latin(false, 0xd800)); assert(!latin(false, 0xf0fc)); }`,
  );
});

test("the actual C++ language application preserves inactive locale slots", () => {
  const added = readPatch(PATCH_SERIES[0])
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  const application = added.match(
    /const auto applyRunLanguage = \[&\]\(PropertySet& rProperties\) \{[\s\S]*?\n\s+\};/,
  )?.[0];
  assert.ok(application);
  runCpp(`#include <cassert>
#include <optional>
enum { PROP_CharLocale, PROP_CharLocaleAsian, PROP_CharLocaleComplex };
struct PropertySet {
  int values[3] = { 10, 20, 30 };
  void setProperty(int slot, int locale) { values[slot] = locale; }
};
struct LanguageTag { explicit LanguageTag(int) {} int getLocale() { return 99; } };
PropertySet apply(unsigned char nLanguageScripts) {
  struct { std::optional<int> moLang = 1; } aTextCharacterProps;
  ${application}
  PropertySet result;
  applyRunLanguage(result);
  return result;
}
int main() {
  const auto neutral = apply(0);
  assert(neutral.values[0] == 10 && neutral.values[1] == 20 && neutral.values[2] == 30);
  const auto asian = apply(2);
  assert(asian.values[0] == 10 && asian.values[1] == 99 && asian.values[2] == 30);
  const auto latin = apply(1);
  assert(latin.values[0] == 99 && latin.values[1] == 20 && latin.values[2] == 30);
  const auto complex = apply(4);
  assert(complex.values[0] == 10 && complex.values[1] == 20 && complex.values[2] == 99);
  const auto mixed = apply(3);
  assert(mixed.values[0] == 99 && mixed.values[1] == 99 && mixed.values[2] == 30);
}
`);
});

test("glyph fallback selects Hangul fonts without changing text-layout language", () => {
  const patch = readPatch(PATCH_SERIES[3]);
  const files = [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(files, ["vcl/unx/generic/fontmanager/fontconfig.cxx"]);
  assert.doesNotMatch(
    patch,
    /CharLocale|setProperty|rPattern\.meLanguage\s*=|getenv/,
  );
  const body = patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  runCpp(`
#include <cassert>
#include <string>
constexpr int USCRIPT_HANGUL = 18;
bool incompatible(std::string sLang, int script, bool explicitScript) {
  if (explicitScript) return false;
  bool bIsImpossible = false;
  switch (script) {
${body}
    default: break;
  }
  return bIsImpossible;
}
int main() {
  assert(incompatible("en", USCRIPT_HANGUL, false));
  assert(incompatible("zh", USCRIPT_HANGUL, false));
  assert(!incompatible("ko", USCRIPT_HANGUL, false));
  assert(!incompatible("jje", USCRIPT_HANGUL, false));
  assert(!incompatible("en", USCRIPT_HANGUL, true));
  assert(!incompatible("en", 0, false));
}
`);
});

test("the optional engine layer verifies both patched LibreOffice libraries", () => {
  const engineImage = readFileSync(
    "services/document-worker/Dockerfile.libreoffice-engine",
    "utf8",
  );

  for (const name of PATCH_SERIES)
    assert.match(engineImage, new RegExp(name.replace(/\./g, "\\.")));
  assert.match(
    engineImage,
    /grep --binary-files=text --quiet 'GetFontHheaMetrics' libmergedlo\.so/,
  );
  assert.match(
    engineImage,
    /grep --binary-files=text --quiet 'SPELLBOOK_POWERPOINT_COMPAT' libsdlo\.so/,
  );
  assert.match(engineImage, /install --mode=0755 libsdlo\.so/);
  assert.match(engineImage, /SPELLBOOK_POWERPOINT_COMPAT=1/);
  assert.match(engineImage, /SPELLBOOK_DISABLE_CJK_SCRIPT_SPACING=0/);
  assert.match(engineImage, /SPELLBOOK_POWERPOINT_METRIC_BASELINE=0/);
  assert.match(
    engineImage,
    /sha256sum --check --strict libmergedlo\.so\.sha256 libsdlo\.so\.sha256/,
  );
  assert.doesNotMatch(engineImage, /_ENGINE=1/);
});

test("renderer keeps layout deterministic while retrying only process termination", () => {
  const renderer = readFileSync(
    "services/document-worker/src/Spellbook.Document.Core/LibreOfficeRenderer.cs",
    "utf8",
  );

  assert.doesNotMatch(renderer, /LibreOfficeTextLayoutNormalizer/);
  assert.doesNotMatch(renderer, /PDFTOTEXT_PATH/);
  assert.doesNotMatch(renderer, /layout-pass-/);
  assert.match(renderer, /private const int MaxRenderAttempts = 2/);
  assert.match(renderer, /IsRetryableLibreOfficeFailure/);
  assert.match(renderer, /pdfPath = await ConvertToPdfAsync\(/);
});

test("reads hhea metrics and bold selection from an SFNT face", () => {
  const values = runPython(String.raw`
import json, os, struct, sys, tempfile
sys.path.insert(0, "services/document-worker/scripts")
from powerpoint_text_metrics import read_font_vertical_metrics

font = bytearray(280)
font[0:4] = b"\x00\x01\x00\x00"
struct.pack_into(">H", font, 4, 3)
tables = [(b"head", 80, 54), (b"hhea", 140, 36), (b"OS/2", 180, 64)]
for index, (tag, offset, length) in enumerate(tables):
    struct.pack_into(">4sIII", font, 12 + index * 16, tag, 0, offset, length)
struct.pack_into(">H", font, 80 + 18, 2048)
struct.pack_into(">H", font, 80 + 44, 0)
struct.pack_into(">hh", font, 140 + 4, 1950, -550)
struct.pack_into(">H", font, 180 + 62, 0x20)
handle, path = tempfile.mkstemp(suffix=".ttf")
try:
    os.write(handle, font)
    os.close(handle)
    metrics = read_font_vertical_metrics(path)
    print(json.dumps(metrics.__dict__))
finally:
    if os.path.exists(path):
        os.unlink(path)
`);

  assert.deepEqual(values, {
    units_per_em: 2048,
    ascent: 1950,
    descent: 550,
    bold: true,
  });
});

test("resolves a PPTX-declared family through the render-scoped embedded index", () => {
  const values = runPython(String.raw`
import json, os, struct, sys, tempfile
from urllib.parse import quote
sys.path.insert(0, "services/document-worker/scripts")
from powerpoint_text_metrics import FontMetricResolver

font = bytearray(240)
font[0:4] = b"\x00\x01\x00\x00"
struct.pack_into(">H", font, 4, 2)
for index, (tag, offset, length) in enumerate([(b"head", 64, 54), (b"hhea", 128, 36)]):
    struct.pack_into(">4sIII", font, 12 + index * 16, tag, 0, offset, length)
struct.pack_into(">H", font, 64 + 18, 1000)
struct.pack_into(">H", font, 64 + 44, 0)
struct.pack_into(">hh", font, 128 + 4, 800, -200)
directory = tempfile.mkdtemp()
font_path = os.path.join(directory, "embedded.ttf")
index_path = os.path.join(directory, "embedded.tsv")
try:
    with open(font_path, "wb") as stream:
        stream.write(font)
    with open(index_path, "w", encoding="utf-8") as stream:
        stream.write(f"{quote('KT&G 상상제목 B', safe='')}\tregular\t{font_path}\n")
    resolved = FontMetricResolver(embedded_index_path=index_path).resolve(
        "KT&G 상상제목 B"
    )
    print(json.dumps({
        "family": resolved.resolved_family,
        "percent": resolved.metrics.baseline_shift_percent,
        "bold": resolved.metrics.bold,
    }, ensure_ascii=False))
finally:
    for path in (index_path, font_path):
        if os.path.exists(path):
            os.unlink(path)
    os.rmdir(directory)
`);

  assert.equal(values.family, "KT&G 상상제목 B");
  assert.ok(Math.abs(values.percent - 4) < 1e-12);
  assert.equal(values.bold, false);
});

test("reads UNO text properties in one sorted bulk call with a safe fallback", () => {
  const values = runPython(String.raw`
import json, sys, types
sys.path.insert(0, "services/document-worker/scripts")
sys.modules["officehelper"] = types.ModuleType("officehelper")
sys.modules["uno"] = types.ModuleType("uno")
for name in ("com", "com.sun", "com.sun.star", "com.sun.star.beans"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["com.sun.star.beans"].PropertyValue = type("PropertyValue", (), {})
import render_with_libreoffice as renderer

class Bulk:
    def __init__(self):
        self.calls = []
    def getPropertyValues(self, names):
        self.calls.append(list(names))
        return tuple({"Alpha": 1, "Beta": 2}[name] for name in names)

class FallbackInfo:
    def hasPropertyByName(self, name):
        return name == "Alpha"

class Fallback:
    def getPropertySetInfo(self):
        return FallbackInfo()
    def getPropertyValue(self, name):
        return 3

bulk = Bulk()
print(json.dumps({
    "bulk": renderer.property_values_if_available(bulk, ("Beta", "Alpha", "Beta")),
    "bulkCalls": bulk.calls,
    "fallback": renderer.property_values_if_available(Fallback(), ("Beta", "Alpha")),
}))
`);

  assert.deepEqual(values, {
    bulk: { Alpha: 1, Beta: 2 },
    bulkCalls: [["Alpha", "Beta"]],
    fallback: { Alpha: 3, Beta: null },
  });
});
