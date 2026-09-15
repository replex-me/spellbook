import { execFileSync } from "node:child_process";

export function readRepositoryIdentity(repositoryRoot) {
  const run = (args) =>
    execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
  const revision = run(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(revision))
    throw new Error("Browser verification source revision is not immutable.");
  return {
    revision,
    dirty:
      run(["status", "--porcelain=v1", "--untracked-files=normal"]).length > 0,
  };
}
