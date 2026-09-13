#!/usr/bin/env bash
set -euo pipefail

spellbook_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
upstream_reader="$spellbook_repo_root/services/office-editor/libreoffice/upstream.mjs"
source_ref="$(node "$upstream_reader" get source.ref)"
source_commit="$(node "$upstream_reader" get source.commit)"
source_repository="$(node "$upstream_reader" get source.repository)"
expected_patch_series_sha256="$(node "$upstream_reader" get patchSeriesSha256)"
actual_patch_series_sha256="$(node "$upstream_reader" patch-series-sha256)"
if [[ "$actual_patch_series_sha256" != "$expected_patch_series_sha256" ]]; then
  echo "Expected Collabora patch series $expected_patch_series_sha256, got $actual_patch_series_sha256." >&2
  exit 1
fi
patch_files=()
while IFS= read -r value; do patch_files+=("$value"); done \
  < <(node "$upstream_reader" get patches)
patch_paths=()
for relative_patch in "${patch_files[@]}"; do
  patch_paths+=("$spellbook_repo_root/services/office-editor/libreoffice/$relative_patch")
done
provided_source="${1:-}"
temporary_root=""
verification_root=""

cleanup() {
  if [[ -n "$temporary_root" && "$temporary_root" == /tmp/spellbook-collabora-patch.* ]]; then
    rm -rf -- "$temporary_root"
  fi
  if [[ -n "$verification_root" && "$verification_root" == /tmp/spellbook-collabora-patch-series.* ]]; then
    rm -rf -- "$verification_root"
  fi
}
trap cleanup EXIT

if [[ -z "$provided_source" ]]; then
  temporary_root="$(mktemp -d /tmp/spellbook-collabora-patch.XXXXXX)"
  provided_source="$temporary_root/source"
  git clone --quiet --depth=1 --branch "$source_ref" "$source_repository" "$provided_source"
fi

actual_commit="$(git -C "$provided_source" rev-parse HEAD)"
if [[ "$actual_commit" != "$source_commit" ]]; then
  echo "Expected Collabora $source_ref at $source_commit, got $actual_commit." >&2
  exit 1
fi
if [[ ! -d "$provided_source/engine" ]]; then
  echo "Expected the Collabora monorepo engine directory at $provided_source/engine." >&2
  exit 1
fi

# Later patches may deliberately build on symbols or tests introduced by an
# earlier patch. Verify the declared series cumulatively in an isolated clone;
# checking every patch against the pristine tree rejects valid dependencies
# and does not prove the release ordering itself.
verification_root="$(mktemp -d /tmp/spellbook-collabora-patch-series.XXXXXX)"
verification_source="$verification_root/source"
git clone --quiet --shared --no-checkout "$provided_source" "$verification_source"
git -C "$verification_source" checkout --quiet --detach "$source_commit"
for patch_path in "${patch_paths[@]}"; do
  git -C "$verification_source" apply --check --whitespace=error-all \
    --directory=engine "$patch_path"
  git -C "$verification_source" apply --whitespace=error-all \
    --directory=engine "$patch_path"
done
git -C "$verification_source" diff --check
expected_uno_count="$(node "$upstream_reader" get impressUiUnoCommandCount)"
observed_uno_count="$(
  rg --only-matching --no-filename '\.uno:[A-Za-z0-9_]+' \
    "$provided_source/engine/sd/uiconfig/simpress" \
    "$provided_source/browser/src/control/Control.NotebookbarImpress.js" \
    | sort --unique \
    | wc -l \
    | tr -d ' '
)"
if [[ "$observed_uno_count" != "$expected_uno_count" ]]; then
  echo "Expected $expected_uno_count unique Impress UI UNO commands, got $observed_uno_count." >&2
  exit 1
fi
echo "Patch series $actual_patch_series_sha256 applies exactly to Collabora $source_ref ($source_commit); $observed_uno_count UI UNO commands inventoried."
