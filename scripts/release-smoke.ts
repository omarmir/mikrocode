import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const workspaceFiles = [
  "package.json",
  "bun.lock",
  "apps/server/package.json",
  "apps/mobile/package.json",
  "apps/marketing/package.json",
  "packages/contracts/package.json",
  "packages/shared/package.json",
  "scripts/package.json",
] as const;

const tempRoot = mkdtempSync(join(tmpdir(), "t3-release-smoke-"));

try {
  for (const relativePath of workspaceFiles) {
    const sourcePath = resolve(repoRoot, relativePath);
    const destinationPath = resolve(tempRoot, relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(sourcePath, destinationPath);
  }

  execFileSync(
    process.execPath,
    [resolve(repoRoot, "scripts/update-release-package-versions.ts"), "9.9.9-smoke.0", "--root", tempRoot],
    { cwd: repoRoot, stdio: "inherit" },
  );

  execFileSync("bun", ["install", "--lockfile-only", "--ignore-scripts"], {
    cwd: tempRoot,
    stdio: "inherit",
  });

  const lockfile = readFileSync(resolve(tempRoot, "bun.lock"), "utf8");
  if (!lockfile.includes('"version": "9.9.9-smoke.0"')) {
    throw new Error("Expected bun.lock to contain the smoke version.");
  }
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
