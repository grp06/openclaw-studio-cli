#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import * as tar from "tar";

export type ParsedArgs =
  | { action: "help" }
  | { action: "version" }
  | { action: "run" }
  | { action: "error"; message: string };

export function parseArgs(args: string[]): ParsedArgs {
  if (args.includes("-h") || args.includes("--help")) {
    return { action: "help" };
  }

  if (args.includes("-v") || args.includes("--version")) {
    return { action: "version" };
  }

  if (args.length > 0) {
    return { action: "error", message: `Unknown argument: ${args.join(" ")}` };
  }

  return { action: "run" };
}

const pkgPath = path.resolve(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };

function printHelp(): void {
  console.log(
    "OpenClaw Studio Installer\n\nUsage:\n  openclaw-studio\n\nOptions:\n  -h, --help     Show help\n  -v, --version  Show version"
  );
}

// ----------------------------
// Installer implementation
// ----------------------------

export const DEFAULT_SOURCE_REPO = "git@github.com:grp06/openclaw-studio.git";

export function parseGitHubOwnerRepo(sourceRepoUrl: string): { owner: string; repo: string } {
  const trimmed = String(sourceRepoUrl || "").trim();
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  throw new Error(
    `Unsupported repo URL "${sourceRepoUrl}". Expected https://github.com/<owner>/<repo>(.git) or git@github.com:<owner>/<repo>(.git).`
  );
}

export function getGitHubTarballUrl(owner: string, repo: string): string {
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/main`;
}

function resolveSourceRepo(): string {
  return process.env.OPENCLAW_STUDIO_SOURCE_REPO || DEFAULT_SOURCE_REPO;
}

export function validateTargetDir(destDir: string): void {
  if (fs.existsSync(destDir)) {
    throw new Error(`Destination directory already exists: ${destDir}`);
  }
}

export async function downloadToTempFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error(`Failed to download ${url}: empty response body`);
  }

  const tmpPath = path.join(os.tmpdir(), `openclaw-studio-${crypto.randomUUID()}.tar.gz`);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(tmpPath));
  return tmpPath;
}

async function extractTarball(tarPath: string, destDir: string): Promise<void> {
  await tar.x({
    file: tarPath,
    cwd: destDir,
    strip: 1
  });
}

function runNpmInstall(destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install"], {
      cwd: destDir,
      stdio: "inherit"
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start npm install: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`npm install exited with signal ${signal}`));
        return;
      }
      reject(new Error(`npm install failed with exit code ${code}`));
    });
  });
}

function getConfigCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.OPENCLAW_CONFIG_PATH) {
    candidates.push(process.env.OPENCLAW_CONFIG_PATH);
  }
  if (process.env.OPENCLAW_STATE_DIR) {
    candidates.push(path.join(process.env.OPENCLAW_STATE_DIR, "openclaw.json"));
  }
  const home = os.homedir();
  candidates.push(path.join(home, ".openclaw", "openclaw.json"));
  candidates.push(path.join(home, ".moltbot", "openclaw.json"));
  candidates.push(path.join(home, ".clawdbot", "openclaw.json"));
  return candidates;
}

function warnIfMissingConfig(): void {
  const candidates = getConfigCandidates();
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) {
    return;
  }

  console.warn(
    "OpenClaw config not found. Run `openclaw onboard` or set OPENCLAW_CONFIG_PATH to a valid openclaw.json."
  );
  console.warn("Checked:");
  for (const candidate of candidates) {
    console.warn(`  ${candidate}`);
  }
}

export async function runInstaller(): Promise<void> {
  const destDir = path.resolve(process.cwd(), "openclaw-studio");
  validateTargetDir(destDir);

  const sourceRepoUrl = resolveSourceRepo();
  const { owner, repo } = parseGitHubOwnerRepo(sourceRepoUrl);
  const tarballUrl = getGitHubTarballUrl(owner, repo);

  console.log("Downloading OpenClaw Studio...");
  const tarPath = await downloadToTempFile(tarballUrl);

  await fsp.mkdir(destDir, { recursive: false });

  console.log("Extracting archive...");
  try {
    await extractTarball(tarPath, destDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to extract archive: ${message}`);
  }

  await fsp.unlink(tarPath).catch(() => {});

  console.log("Installing dependencies...");
  await runNpmInstall(destDir);

  warnIfMissingConfig();

  console.log("");
  console.log("Next steps:");
  console.log("  cd openclaw-studio");
  console.log("  npm run dev");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (parsed.action === "help") {
    printHelp();
    return;
  }

  if (parsed.action === "version") {
    console.log(pkg.version || "0.0.0");
    return;
  }

  if (parsed.action === "error") {
    console.error(parsed.message);
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    await runInstaller();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
