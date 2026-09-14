#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "The official host-driven Collabora source build requires Linux." >&2
  exit 1
fi
if [[ "$EUID" -eq 0 ]]; then
  echo "LibreOffice refuses root compilation. Run this script as a regular user with Docker socket access." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "The build user cannot reach the Docker daemon. Grant that user Docker socket access without running the compiler as root." >&2
  exit 1
fi

# Release-candidate boundary only. Patch development belongs in
# A failed source candidate must return to a persistent incremental worktree;
# one counterexample should not trigger another complete Online image build.

spellbook_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
upstream_reader="$spellbook_repo_root/services/office-editor/libreoffice/upstream.mjs"
source_ref="${SPELLBOOK_COLLABORA_SOURCE_REF:-$(node "$upstream_reader" get source.ref)}"
source_commit="${SPELLBOOK_COLLABORA_SOURCE_COMMIT:-$(node "$upstream_reader" get source.commit)}"
source_repository="$(node "$upstream_reader" get source.repository)"
patch_level="$(node "$upstream_reader" get patchLevel)"
expected_patch_series_sha256="$(node "$upstream_reader" get patchSeriesSha256)"
actual_patch_series_sha256="$(node "$upstream_reader" patch-series-sha256)"
source_patch_series_ready="$(node "$upstream_reader" get sourcePatchSeriesReady)"
if [[ "$source_patch_series_ready" != "true" ]]; then
  echo "The Collabora patch series has not passed exact clean-source admission; sourcePatchSeriesReady must be true before a full image build." >&2
  exit 1
fi
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
cppunit_targets=()
while IFS= read -r value; do cppunit_targets+=("$value"); done \
  < <(node "$upstream_reader" get requiredCppunitTargets)
image_repository="${SPELLBOOK_COLLABORA_ENGINE_REPOSITORY:-spellbook-collabora-engine}"
image_tag="${SPELLBOOK_COLLABORA_ENGINE_TAG:-$(node "$upstream_reader" get engineImageTag)}"
if [[ -n "${SPELLBOOK_COLLABORA_BUILD_ROOT:-}" ]]; then
  # Cloud Build uses one stable path so compiler-cache keys survive between
  # otherwise isolated builds. Keep the accepted target exact: this script
  # removes it before and after use.
  build_root="$SPELLBOOK_COLLABORA_BUILD_ROOT"
  if [[ "$build_root" != "/workspace/.spellbook-collabora-build" ]]; then
    echo "SPELLBOOK_COLLABORA_BUILD_ROOT must be /workspace/.spellbook-collabora-build." >&2
    exit 1
  fi
  rm -rf -- "$build_root"
  mkdir -p "$build_root"
else
  build_root="$(mktemp -d /tmp/spellbook-collabora-build.XXXXXX)"
fi

cleanup() {
  if [[ "$build_root" == /tmp/spellbook-collabora-build.* || "$build_root" == "/workspace/.spellbook-collabora-build" ]]; then
    rm -rf -- "$build_root"
  fi
}
trap cleanup EXIT

source_root="$build_root/source"
patched_repository="$build_root/patched.git"
git clone --quiet --depth=1 --branch "$source_ref" "$source_repository" "$source_root"
actual_commit="$(git -C "$source_root" rev-parse HEAD)"
if [[ "$actual_commit" != "$source_commit" ]]; then
  echo "Expected Collabora $source_ref at $source_commit, got $actual_commit." >&2
  exit 1
fi

# Apply the declared patch series cumulatively. Later patches are allowed to
# extend code and tests introduced by earlier patches, so validating every
# patch against the pristine checkout would reject a valid ordered series.
for patch_path in "${patch_paths[@]}"; do
  git -C "$source_root" apply --check --whitespace=error-all \
    --directory=engine "$patch_path"
  git -C "$source_root" apply --whitespace=error-all \
    --directory=engine "$patch_path"
done
git -C "$source_root" diff --check
git -C "$source_root" -c user.name=Spellbook -c user.email=build@invalid.example \
  commit --quiet --all --message="Apply Spellbook Impress compatibility patch series"
git -C "$source_root" branch "spellbook-$patch_level"
git clone --quiet --bare "$source_root" "$patched_repository"

export COLLABORA_ONLINE_REPO="file://$patched_repository"
export COLLABORA_ONLINE_BRANCH="spellbook-$patch_level"
export DOCKER_HUB_REPO="$image_repository"
export DOCKER_HUB_TAG="$image_tag"
export ENGINE_BUILD_TARGET="-j$(nproc)"
bash "$source_root/docker/from-source/build.sh"

# The image is not a release candidate unless the engine tests that exercise
# every patched Undo/identity path pass in the exact tree used for packaging.
# Run these after the full build so all shared test dependencies already exist.
engine_build_root="$source_root/docker/from-source/builddir/online/engine"
make -C "$engine_build_root" "${cppunit_targets[@]}"

docker image inspect "$image_repository:$image_tag" >/dev/null
echo "Built and engine-tested $image_repository:$image_tag from $source_ref with the verified patch series."
