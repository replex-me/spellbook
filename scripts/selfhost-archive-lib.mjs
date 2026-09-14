import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const BACKUP_FORMAT_VERSION = 1;

export function parseNamedArguments(argv, allowed) {
  const result = {};
  for (const argument of argv) {
    if (argument === "--") continue;
    if (!argument.startsWith("--"))
      throw new Error(`Unexpected positional argument: ${argument}`);
    const separator = argument.indexOf("=");
    const key = argument.slice(2, separator === -1 ? undefined : separator);
    if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
    result[key] = separator === -1 ? true : argument.slice(separator + 1);
  }
  return result;
}

export function validateProjectName(value) {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value))
    throw new Error(
      "Project name must contain only lowercase letters, digits, _ or -.",
    );
  return value;
}

export function requiredStringOption(options, key, fallback) {
  const value = options[key] ?? fallback;
  if (typeof value !== "string" || !value)
    throw new Error(`--${key} requires a non-empty value.`);
  return value;
}

export function booleanOption(options, key) {
  const value = options[key];
  if (value === undefined) return false;
  if (value !== true) throw new Error(`--${key} does not accept a value.`);
  return true;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    stdio: options.stdio ?? "inherit",
    encoding: options.encoding,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}`,
    );
  return result;
}

export function capture(command, args, options = {}) {
  return run(command, args, {
    ...options,
    encoding: "utf8",
    stdio: "pipe",
  }).stdout.trim();
}

export function compose(project, args, options = {}) {
  return run("docker", ["compose", "-p", project, ...args], options);
}

export function composeCapture(project, args, options = {}) {
  return capture("docker", ["compose", "-p", project, ...args], options);
}

export function resolveComposeVolume(project, logicalName) {
  const names = capture("docker", [
    "volume",
    "ls",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    `label=com.docker.compose.volume=${logicalName}`,
    "--format",
    "{{.Name}}",
  ])
    .split("\n")
    .filter(Boolean);
  if (names.length !== 1)
    throw new Error(
      `Expected one ${logicalName} volume for ${project}; found ${names.length}.`,
    );
  return names[0];
}

export function ensureComposeVolume(project, logicalName) {
  const names = capture("docker", [
    "volume",
    "ls",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    `label=com.docker.compose.volume=${logicalName}`,
    "--format",
    "{{.Name}}",
  ])
    .split("\n")
    .filter(Boolean);
  if (names.length > 1)
    throw new Error(
      `Expected at most one ${logicalName} volume for ${project}; found ${names.length}.`,
    );
  if (names.length === 1) return names[0];
  return capture("docker", [
    "volume",
    "create",
    "--label",
    `com.docker.compose.project=${project}`,
    "--label",
    `com.docker.compose.volume=${logicalName}`,
    `${project}_${logicalName}`,
  ]);
}

export function archiveVolume({ image, volume, destination, fileName }) {
  run("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "tar",
    "--mount",
    `type=volume,src=${volume},dst=/source,readonly`,
    "--mount",
    `type=bind,src=${destination},dst=/backup`,
    image,
    "-czf",
    `/backup/${fileName}`,
    "-C",
    "/source",
    ".",
  ]);
  fs.chmodSync(path.join(destination, fileName), 0o600);
}

export function restoreVolume({ image, volume, source, fileName }) {
  run("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    "--mount",
    `type=volume,src=${volume},dst=/target`,
    "--mount",
    `type=bind,src=${source},dst=/backup,readonly`,
    image,
    "-ec",
    'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- "{}" +; tar -xzf "/backup/$1" -C /target',
    "restore-volume",
    fileName,
  ]);
}

export function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function writeBackupManifest(directory, metadata, relativeFiles) {
  const files = relativeFiles.map((relativePath) => {
    const absolutePath = safeBackupPath(directory, relativePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile())
      throw new Error(`Backup member is not a file: ${relativePath}`);
    return {
      path: relativePath,
      bytes: stat.size,
      sha256: sha256File(absolutePath),
    };
  });
  const manifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    ...metadata,
    files,
  };
  const destination = path.join(directory, "manifest.json");
  fs.writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return manifest;
}

export function verifyBackupManifest(directory) {
  const manifestPath = path.join(directory, "manifest.json");
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile())
    throw new Error("Backup manifest is not a regular file.");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION)
    throw new Error(`Unsupported backup format: ${manifest.formatVersion}`);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0)
    throw new Error("Backup manifest has no files.");
  const memberPaths = new Set();
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.bytes !== "number" ||
      typeof file.sha256 !== "string"
    )
      throw new Error("Backup manifest contains an invalid file record.");
    if (memberPaths.has(file.path))
      throw new Error(
        `Backup manifest contains duplicate member: ${file.path}`,
      );
    memberPaths.add(file.path);
    const absolutePath = safeBackupPath(directory, file.path);
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile())
      throw new Error(`Backup member is not a regular file: ${file.path}`);
    if (stat.size !== file.bytes || sha256File(absolutePath) !== file.sha256)
      throw new Error(
        `Backup member failed integrity verification: ${file.path}`,
      );
  }
  return manifest;
}

export function requireBackupMembers(manifest, requiredPaths) {
  const memberPaths = new Set(manifest.files.map((file) => file.path));
  for (const requiredPath of requiredPaths) {
    if (!memberPaths.has(requiredPath))
      throw new Error(`Backup is missing required member: ${requiredPath}`);
  }
}

export function safeBackupPath(directory, relativePath) {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes("..")
  )
    throw new Error(`Unsafe backup path: ${relativePath}`);
  const root = `${path.resolve(directory)}${path.sep}`;
  const resolved = path.resolve(directory, relativePath);
  if (!resolved.startsWith(root))
    throw new Error(`Unsafe backup path: ${relativePath}`);
  return resolved;
}

export function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function readEnvironment(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

export function copyPrivateFile(source, destination) {
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o600);
}
