import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

export const DEFAULT_SOURCE_REPO = "git@github.com:grp06/openclaw-studio.git";

function resolveSourceRepo(): string {
  return process.env.OPENCLAW_STUDIO_SOURCE_REPO || DEFAULT_SOURCE_REPO;
}

export function validateTargetDir(destDir: string): void {
  if (fs.existsSync(destDir)) {
    throw new Error(`Destination directory already exists: ${destDir}`);
  }
}

function runGitClone(sourceRepoUrl: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["clone", sourceRepoUrl, destDir], {
      stdio: "inherit"
    });

    child.on("error", (error) => {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") {
        reject(
          new Error("git is required to install OpenClaw Studio. Install git and retry.")
        );
        return;
      }
      reject(new Error(`Failed to start git clone: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`git clone exited with signal ${signal}`));
        return;
      }
      reject(new Error(`git clone failed with exit code ${code}`));
    });
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

  console.warn("OpenClaw config not found. Run `openclaw onboard` or set OPENCLAW_CONFIG_PATH to a valid openclaw.json.");
  console.warn("Checked:");
  for (const candidate of candidates) {
    console.warn(`  ${candidate}`);
  }
}

export async function runInstaller(): Promise<void> {
  const destDir = path.resolve(process.cwd(), "openclaw-studio");
  validateTargetDir(destDir);

  const sourceRepoUrl = resolveSourceRepo();

  console.log("Cloning OpenClaw Studio...");
  await runGitClone(sourceRepoUrl, destDir);

  console.log("Installing dependencies...");
  await runNpmInstall(destDir);

  warnIfMissingConfig();

  console.log("");
  console.log("Next steps:");
  console.log("  cd openclaw-studio");
  console.log("  npm run dev");
}
