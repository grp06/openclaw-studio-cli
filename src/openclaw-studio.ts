#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { pipeline } from "node:stream/promises";
import { spawn, spawnSync } from "node:child_process";
import * as tar from "tar";
import { formatCheckLine, term } from "./term";

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
    `${term.bold("OpenClaw Studio Installer")}\n\nUsage:\n  openclaw-studio\n\nOptions:\n  -h, --help     Show help\n  -v, --version  Show version`
  );
}

function requireNode18OrNewer(): void {
  const [majorRaw] = process.versions.node.split(".");
  const major = Number(majorRaw);
  if (!Number.isFinite(major) || major < 18) {
    throw new Error(
      `Node.js 18+ is required. Detected node ${process.versions.node}.`
    );
  }
}

function hasCommand(command: string): boolean {
  const locator = process.platform === "win32" ? "where" : "which";
  const located = spawnSync(locator, [command], { stdio: "ignore" });
  if (located.status === 0) return true;

  const fallback = spawnSync(command, ["--version"], { stdio: "ignore" });
  return fallback.status === 0 && !fallback.error;
}

type GatewayReachability = "reachable" | "unreachable" | "unknown";

function parseGatewayUrlHint(): string {
  const hint = process.env.NEXT_PUBLIC_GATEWAY_URL?.trim();
  return hint ? hint : "ws://127.0.0.1:18789";
}

function getPortForProtocol(protocol: string, port: string): number | undefined {
  if (port) {
    const parsed = Number(port);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (protocol === "ws:" || protocol === "http:") return 80;
  if (protocol === "wss:" || protocol === "https:") return 443;
  return undefined;
}

function checkGatewayReachable(
  gatewayUrl: string,
  timeoutMs: number
): Promise<GatewayReachability> {
  let url: URL;
  try {
    url = new URL(gatewayUrl);
  } catch {
    return Promise.resolve("unknown");
  }

  const host = url.hostname;
  const port = getPortForProtocol(url.protocol, url.port);
  if (!host || !port) return Promise.resolve("unknown");

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("unreachable"), timeoutMs);

    const ok = () => {
      clearTimeout(timer);
      resolve("reachable");
    };

    const fail = () => {
      clearTimeout(timer);
      resolve("unreachable");
    };

    const socket =
      url.protocol === "wss:"
        ? tls.connect({ host, port, servername: host }, ok)
        : net.connect({ host, port }, ok);

    socket.on("error", fail);
    socket.on("timeout", fail);
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => socket.end());
  });
}

// ----------------------------
// Installer implementation
// ----------------------------

export const installer = {
  DEFAULT_SOURCE_REPO: "https://github.com/grp06/openclaw-studio.git",

  parseGitHubOwnerRepo(sourceRepoUrl: string): { owner: string; repo: string } {
    const trimmed = String(sourceRepoUrl || "").trim();
    const httpsMatch = trimmed.match(
      /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
    );
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
  },

  getGitHubTarballUrl(owner: string, repo: string): string {
    return `https://codeload.github.com/${owner}/${repo}/tar.gz/main`;
  },

  resolveSourceRepo(): string {
    return process.env.OPENCLAW_STUDIO_SOURCE_REPO || installer.DEFAULT_SOURCE_REPO;
  },

  validateTargetDir(destDir: string): void {
    if (fs.existsSync(destDir)) {
      throw new Error(`Destination directory already exists: ${destDir}`);
    }
  },

  async downloadToTempFile(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error(`Failed to download ${url}: empty response body`);
    }

    const tmpPath = path.join(os.tmpdir(), `openclaw-studio-${crypto.randomUUID()}.tar.gz`);
    await pipeline(
      response.body as unknown as NodeJS.ReadableStream,
      fs.createWriteStream(tmpPath)
    );
    return tmpPath;
  },

  async extractTarball(tarPath: string, destDir: string): Promise<void> {
    await tar.x({
      file: tarPath,
      cwd: destDir,
      strip: 1
    });
  },

  runNpmInstall(destDir: string): Promise<void> {
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
  },

  getConfigCandidates(): string[] {
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
  },

  resolveExistingConfigPath(): string | undefined {
    const candidates = installer.getConfigCandidates();
    return candidates.find((candidate) => fs.existsSync(candidate));
  },

  warnIfMissingConfig(): void {
    const candidates = installer.getConfigCandidates();
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
  },

  async runInstaller(): Promise<void> {
    console.log(term.bold("OpenClaw Studio Installer"));
    console.log("");

    requireNode18OrNewer();

    const destDir = path.resolve(process.cwd(), "openclaw-studio");
    installer.validateTargetDir(destDir);

    const npmOk = hasCommand("npm");
    const openclawOk = hasCommand("openclaw");
    const configPath = installer.resolveExistingConfigPath();
    const gatewayUrlHint = parseGatewayUrlHint();
    const gatewayReachability = await checkGatewayReachable(gatewayUrlHint, 800);

    console.log(term.bold("Preflight checks"));
    console.log(formatCheckLine("npm in PATH", npmOk ? "ok" : "fail"));
    console.log(
      formatCheckLine(
        "openclaw in PATH (recommended)",
        openclawOk ? "ok" : "warn"
      )
    );
    console.log(
      formatCheckLine(
        "OpenClaw config (openclaw.json)",
        configPath ? "ok" : "warn",
        configPath ? configPath : "not found"
      )
    );
    console.log(
      formatCheckLine(
        `Gateway reachable (${gatewayUrlHint})`,
        gatewayReachability === "reachable" ? "ok" : "warn",
        gatewayReachability === "reachable"
          ? "port open"
          : gatewayReachability === "unknown"
            ? "unable to check"
            : "not reachable right now"
      )
    );
    console.log("");

    if (!npmOk) {
      throw new Error(
        "npm is required to install OpenClaw Studio. Install Node.js (includes npm) and retry."
      );
    }

    if (!openclawOk) {
      console.log(
        term.yellow(
          "Note: OpenClaw Studio needs an OpenClaw Gateway to connect to. If you haven't installed OpenClaw yet, do that before trying to use Studio."
        )
      );
      console.log("");
    }

    if (!configPath) {
      console.log(
        term.yellow(
          "Note: OpenClaw config not found. Run `openclaw onboard` (recommended) or set OPENCLAW_CONFIG_PATH to a valid openclaw.json."
        )
      );
      console.log(term.dim("Checked:"));
      for (const candidate of installer.getConfigCandidates()) {
        console.log(term.dim(`  ${candidate}`));
      }
      console.log("");
    }

    if (gatewayReachability !== "reachable") {
      console.log(
        term.yellow(
          `Note: couldn't reach a gateway at ${gatewayUrlHint}. That's OK during install, but Studio won't show anything until a gateway is running and reachable.`
        )
      );
      console.log("");
    }

    const sourceRepoUrl = installer.resolveSourceRepo();
    const { owner, repo } = installer.parseGitHubOwnerRepo(sourceRepoUrl);
    const tarballUrl = installer.getGitHubTarballUrl(owner, repo);

    console.log(term.bold("Installing"));
    console.log(term.cyan(`Source: ${sourceRepoUrl}`));
    console.log(term.cyan(`Target: ${destDir}`));
    console.log("");

    console.log("1) Downloading OpenClaw Studio...");
    const tarPath = await installer.downloadToTempFile(tarballUrl);

    await fsp.mkdir(destDir, { recursive: false });

    console.log("2) Extracting archive...");
    try {
      await installer.extractTarball(tarPath, destDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract archive: ${message}`);
    }

    await fsp.unlink(tarPath).catch(() => {});

    console.log("3) Installing dependencies...");
    await installer.runNpmInstall(destDir);

    installer.warnIfMissingConfig();

    console.log("");
    console.log(term.bold("Next steps"));
    console.log("1) Start your OpenClaw Gateway (must be running and reachable).");
    console.log(term.dim(`   Gateway URL hint: ${gatewayUrlHint}`));
    console.log("2) Start Studio:");
    console.log(term.dim("   cd openclaw-studio"));
    console.log(term.dim("   npm run dev"));
    console.log("3) Open http://localhost:3000");
    console.log(
      term.dim(
        "   If you're using a remote gateway or a different URL/token, set it in Studio Settings."
      )
    );
  }
} as const;

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
    console.error(term.red(parsed.message));
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    await installer.runInstaller();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(term.red(message));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

