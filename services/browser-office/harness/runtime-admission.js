/* SPDX-License-Identifier: MPL-2.0 */

(function installBrowserRuntimeAdmission(global) {
  // The host verifies the receipt and artifact digests before setting
  // buildReady. Browser code checks that admitted identity is intact without
  // freezing the patch revision in each consumer.
  global.spellbookBrowserRuntimeAdmitted = (runtime) =>
    runtime?.buildReady === true &&
    typeof runtime.buildCommit === "string" &&
    runtime.buildCommit === runtime.candidateCommit &&
    /^browser-undo-v[1-9][0-9]*$/u.test(runtime.patchLevel ?? "") &&
    /^[0-9a-f]{64}$/u.test(runtime.patchSeriesSha256 ?? "");
})(globalThis);
