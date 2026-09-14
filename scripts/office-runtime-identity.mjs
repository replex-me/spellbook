import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

export const digestImagePattern = /@sha256:[0-9a-f]{64}$/u;

export function loadOfficeRuntimeRelease(releasePath) {
  const bytes = fs.readFileSync(releasePath);
  const release = JSON.parse(bytes.toString("utf8"));
  requireOfficeRuntimeRelease(release);
  return {
    release,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function requireOfficeRuntimeRelease(release) {
  if (
    release?.kind !== "spellbook-office-runtime" ||
    !/^[0-9a-f]{40}$/u.test(release?.publicSource?.commit ?? "") ||
    !digestImagePattern.test(release?.runtime?.image ?? "") ||
    !digestImagePattern.test(release?.runtime?.engineImage ?? "") ||
    !/^undo-v[1-9][0-9]*$/u.test(release?.runtime?.patchLevel ?? "") ||
    !/^[0-9a-f]{64}$/u.test(release?.runtime?.patchSeriesSha256 ?? "") ||
    !/^[0-9a-f]{40}$/u.test(release?.runtime?.collaboraSourceCommit ?? "") ||
    !Array.isArray(release?.nativeVerification?.requiredCppunitTargets) ||
    release.nativeVerification.requiredCppunitTargets.length === 0
  )
    throw new Error("invalid_office_runtime_release");
  return release;
}

export function releaseEngineIdentity(release) {
  requireOfficeRuntimeRelease(release);
  return {
    patchLevel: release.runtime.patchLevel,
    publicCommit: release.publicSource.commit,
    engineImage: release.runtime.engineImage,
    patchSeriesSha256: release.runtime.patchSeriesSha256,
    collaboraSourceCommit: release.runtime.collaboraSourceCommit,
  };
}

export function assertObservedEngineIdentity(observed, release) {
  const expected = releaseEngineIdentity(release);
  if (
    !observed ||
    Object.entries(expected).some(([name, value]) => observed[name] !== value)
  )
    throw new Error("observed_engine_identity_mismatch");
  return expected;
}

export function verifyRuntimeContainerInspection(release, inspection) {
  requireOfficeRuntimeRelease(release);
  if (
    inspection?.State?.Running !== true ||
    inspection?.Config?.Image !== release.runtime.image ||
    !/^sha256:[0-9a-f]{64}$/u.test(inspection?.Image ?? "") ||
    !/^[0-9a-f]{64}$/u.test(inspection?.Id ?? "")
  )
    throw new Error("runtime_container_identity_mismatch");
  return {
    status: "passed",
    configuredImage: inspection.Config.Image,
    localImageId: inspection.Image,
    containerId: requiredString(inspection.Id, "runtime_container_id"),
  };
}

export function verifyRunningRuntimeContainer(release, containerName) {
  const name = requiredString(containerName, "runtime_container_name");
  let inspections;
  try {
    inspections = JSON.parse(
      execFileSync("docker", ["inspect", "--type=container", "--", name], {
        encoding: "utf8",
      }),
    );
  } catch (error) {
    throw new Error("runtime_container_inspection_failed", { cause: error });
  }
  if (!Array.isArray(inspections) || inspections.length !== 1)
    throw new Error("runtime_container_inspection_failed");
  return verifyRuntimeContainerInspection(release, inspections[0]);
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(name);
  return value.trim();
}
