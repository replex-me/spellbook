import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(
  new URL("./build-candidate-runtime.sh", import.meta.url),
  "utf8",
);

test("keeps native tests independent from translation history", () => {
  const nativeSection = script.slice(
    script.indexOf('native_build="$SPELLBOOK_BROWSER_BUILD_ROOT/native"'),
    script.indexOf('wasm_build="$SPELLBOOK_BROWSER_BUILD_ROOT/wasm"'),
  );
  assert.match(nativeSection, /--with-lang="en-US"/u);
  assert.doesNotMatch(nativeSection, /translations/u);
});

test("fetches only the exact shallow translations gitlink for the Korean WASM build", () => {
  const shallowFetch = script.indexOf('git -C "$source_root" submodule update');
  const wasmConfigure = script.indexOf('cd "$wasm_build"');
  assert.ok(shallowFetch >= 0 && shallowFetch < wasmConfigure);
  assert.match(script, /--depth=1[\s\\]*\n[\s\\]*--recommend-shallow/u);
  assert.match(
    script,
    /translations_commit=.*rev-parse HEAD[\s\S]*translations_gitlink=.*rev-parse HEAD:translations[\s\S]*translations_commit.*translations_gitlink/u,
  );
});

test("runs the declared focused native regressions instead of the unrelated UI suite", () => {
  assert.match(
    script,
    /get sourceCandidate\.focusedCppunitTests/u,
  );
  assert.match(
    script,
    /CPPUNIT_TEST_NAME="\$\{BASH_REMATCH\[2\]\}"/u,
  );
  assert.doesNotMatch(
    script,
    /done < <\(node "\$upstream_reader" get sourceCandidate\.requiredCppunitTargets\)/u,
  );
});
