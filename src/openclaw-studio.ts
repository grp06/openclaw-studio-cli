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
import { createInterface } from "node:readline/promises";
import * as tar from "tar";
import JSON5 from "json5";
import { formatCheckLine, term } from "./term";

export type InstallerOptions = {
  writeStudioSettings: boolean;
  gatewayUrl?: string;
  gatewayToken?: string;
};

export type DoctorOptions = {
  mode: "check" | "fix";
  writeStudioSettings: boolean;
  gatewayUrl?: string;
  gatewayToken?: string;
};

export type ParsedArgs =
  | { action: "help" }
  | { action: "version" }
  | { action: "run"; options: InstallerOptions }
  | { action: "doctor"; options: DoctorOptions }
  | { action: "error"; message: string };

export function parseArgs(args: string[]): ParsedArgs {
  const command = args[0] === "doctor" ? "doctor" : "run";
  const commandArgs = command === "doctor" ? args.slice(1) : args;

  const options: InstallerOptions = {
    writeStudioSettings: true,
  };

  const doctor: DoctorOptions = {
    mode: "check",
    writeStudioSettings: true,
  };

  const expectValue = (flag: string, value: string | undefined) => {
    if (!value) {
      return { action: "error" as const, message: `Missing value for ${flag}` };
    }
    return null;
  };

  const applyCommonArg = (
    arg: string,
    next: string | undefined,
    target: { writeStudioSettings: boolean; gatewayUrl?: string; gatewayToken?: string }
  ): { consumed: number; result?: ParsedArgs } => {
    if (arg === "--no-write-settings") {
      target.writeStudioSettings = false;
      return { consumed: 1 };
    }

    if (arg === "--gateway-url") {
      const err = expectValue("--gateway-url", next);
      if (err) return { consumed: 0, result: err };
      target.gatewayUrl = String(next);
      return { consumed: 2 };
    }

    if (arg.startsWith("--gateway-url=")) {
      const value = arg.slice("--gateway-url=".length);
      const err = expectValue("--gateway-url", value);
      if (err) return { consumed: 0, result: err };
      target.gatewayUrl = value;
      return { consumed: 1 };
    }

    if (arg === "--gateway-token") {
      const err = expectValue("--gateway-token", next);
      if (err) return { consumed: 0, result: err };
      target.gatewayToken = String(next);
      return { consumed: 2 };
    }

    if (arg.startsWith("--gateway-token=")) {
      const value = arg.slice("--gateway-token=".length);
      const err = expectValue("--gateway-token", value);
      if (err) return { consumed: 0, result: err };
      target.gatewayToken = value;
      return { consumed: 1 };
    }

    return { consumed: 0 };
  };

  for (let i = 0; i < commandArgs.length; ) {
    const arg = commandArgs[i] ?? "";
    const next = commandArgs[i + 1];

    if (arg === "-h" || arg === "--help") return { action: "help" };
    if (arg === "-v" || arg === "--version") return { action: "version" };

    if (command === "doctor" && (arg === "--check" || arg === "--fix")) {
      doctor.mode = arg === "--fix" ? "fix" : "check";
      i += 1;
      continue;
    }

    const applied = applyCommonArg(arg, next, command === "doctor" ? doctor : options);
    if (applied.result) return applied.result;
    if (applied.consumed > 0) {
      i += applied.consumed;
      continue;
    }

    return { action: "error", message: `Unknown argument: ${commandArgs.join(" ")}` };
  }

  if (command === "doctor") {
    return { action: "doctor", options: doctor };
  }

  return { action: "run", options };
}

const pkgPath = path.resolve(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };

function printHelp(): void {
  console.log(
    [
      term.bold("OpenClaw Studio Installer / Doctor"),
      "",
      "Usage:",
      "  openclaw-studio [options]",
      "  openclaw-studio doctor [--check|--fix] [options]",
      "",
      "Options:",
      "  -h, --help                 Show help",
      "  -v, --version              Show version",
      "  --gateway-url <ws(s)://>   Gateway WebSocket URL (overrides config)",
      "  --gateway-token <token>    Gateway token (overrides config)",
      "  --no-write-settings        Do not write Studio settings.json",
      "  --check                    (doctor) Diagnosis only (default)",
      "  --fix                      (doctor) Safe fixes (writes Studio settings)",
    ].join("\n")
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

function warnIfNodeTooOldForOpenClaw(): void {
  const [majorRaw, minorRaw] = process.versions.node.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const shortVersion =
    Number.isFinite(major) && Number.isFinite(minor)
      ? `${major}.${minor}`
      : process.versions.node;
  if (Number.isFinite(major) && major < 22) {
    console.log(
      formatCheckLine(
        `You have Node ${shortVersion} (we recommend >= 22)`,
        "warn"
      )
    );
  } else {
    console.log(
      formatCheckLine(
        `You have Node ${shortVersion} (we recommend >= 22)`,
        "ok"
      )
    );
  }
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

function hasCommand(command: string): boolean {
  const locator = process.platform === "win32" ? "where" : "which";
  const located = spawnSync(locator, [command], { stdio: "ignore" });
  if (located.status === 0) return true;

  const fallback = spawnSync(command, ["--version"], { stdio: "ignore" });
  return fallback.status === 0 && !fallback.error;
}

type GatewayReachability = "reachable" | "unreachable" | "unknown";

async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function promptText(question: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function parseGatewayUrlHint(options: InstallerOptions, fallback: string): string {
  const explicit = options.gatewayUrl?.trim();
  if (explicit) return explicit;
  const hint = process.env.NEXT_PUBLIC_GATEWAY_URL?.trim();
  return hint ? hint : fallback;
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

type OpenClawConfigGateway = {
  port?: number;
  mode?: "local" | "remote";
  bind?: string;
  auth?: {
    mode?: "token" | "password";
    token?: string;
    password?: string;
  };
  remote?: {
    url?: string;
    transport?: "ssh" | "direct";
    token?: string;
    password?: string;
    sshTarget?: string;
    sshIdentity?: string;
  };
};

type OpenClawConfig = {
  gateway?: OpenClawConfigGateway;
};

const coerceString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const coerceNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function loadOpenClawConfig(configPath: string): { config: OpenClawConfig | null; error?: string } {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON5.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { config: null };
    return { config: parsed as OpenClawConfig };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { config: null, error: message };
  }
}

function resolveGatewayPort(cfg: OpenClawConfig | null): number {
  const configured = coerceNumber(cfg?.gateway?.port);
  return configured ?? 18789;
}

function resolveLocalGatewayUrl(port: number): string {
  return `ws://127.0.0.1:${port}`;
}

function normalizeWsUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

function readStudioSettingsSummary(
  settingsPath: string
): { url: string; hasToken: boolean } | null {
  if (!fs.existsSync(settingsPath)) return null;
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const gateway = (parsed as Record<string, unknown>).gateway;
    if (!gateway || typeof gateway !== "object") return null;
    const url = coerceString((gateway as Record<string, unknown>).url);
    const token = coerceString((gateway as Record<string, unknown>).token);
    if (!url) return null;
    return { url, hasToken: Boolean(token) };
  } catch {
    return null;
  }
}

function resolveRemoteGatewayUrl(cfg: OpenClawConfig | null): string | null {
  const raw = coerceString(cfg?.gateway?.remote?.url);
  return raw ? normalizeWsUrl(raw) : null;
}

function resolveGatewayToken(cfg: OpenClawConfig | null): { token: string; source: string } {
  const remoteToken = coerceString(cfg?.gateway?.remote?.token);
  if (remoteToken) return { token: remoteToken, source: "config gateway.remote.token" };
  const authToken = coerceString(cfg?.gateway?.auth?.token);
  if (authToken) return { token: authToken, source: "config gateway.auth.token" };
  return { token: "", source: "missing" };
}

function resolveStateDirFromConfigPath(configPath: string | null): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  if (configPath) return path.dirname(configPath);
  return path.join(os.homedir(), ".openclaw");
}

function resolveStudioSettingsPath(stateDir: string): string {
  return path.join(stateDir, "openclaw-studio", "settings.json");
}

async function maybeWriteStudioSettings(params: {
  options: Pick<InstallerOptions, "writeStudioSettings">;
  stateDir: string;
  gatewayUrl: string;
  token: string;
}): Promise<{ wrote: boolean; path: string; skippedBecauseExists: boolean }> {
  const settingsPath = resolveStudioSettingsPath(params.stateDir);
  if (!params.options.writeStudioSettings) {
    return { wrote: false, path: settingsPath, skippedBecauseExists: false };
  }

  const exists = fs.existsSync(settingsPath);
  if (exists) {
    return { wrote: false, path: settingsPath, skippedBecauseExists: true };
  }

  await fsp.mkdir(path.dirname(settingsPath), { recursive: true });

  let existing: unknown = null;
  if (exists) {
    const raw = await fsp.readFile(settingsPath, "utf8");
    try {
      existing = JSON.parse(raw) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse existing Studio settings: ${settingsPath} (${message})`);
    }
  }

  const existingRecord =
    existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};

  const next = {
    version: 1,
    gateway: { url: params.gatewayUrl, token: params.token },
    focused:
      existingRecord.focused && typeof existingRecord.focused === "object"
        ? existingRecord.focused
        : {},
    avatars:
      existingRecord.avatars && typeof existingRecord.avatars === "object"
        ? existingRecord.avatars
        : {},
  };

  await fsp.writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { wrote: true, path: settingsPath, skippedBecauseExists: false };
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
      const child = spawn("npm", ["install", "--no-audit", "--no-fund"], {
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
    const legacyConfigNames = ["clawdbot.json", "moltbot.json", "moldbot.json"];
    if (process.env.OPENCLAW_CONFIG_PATH) {
      candidates.push(resolveUserPath(process.env.OPENCLAW_CONFIG_PATH));
    }
    if (process.env.OPENCLAW_STATE_DIR) {
      const dir = resolveUserPath(process.env.OPENCLAW_STATE_DIR);
      candidates.push(path.join(dir, "openclaw.json"));
      for (const name of legacyConfigNames) {
        candidates.push(path.join(dir, name));
      }
    }
    const home = os.homedir();
    candidates.push(path.join(home, ".openclaw", "openclaw.json"));
    for (const name of legacyConfigNames) {
      candidates.push(path.join(home, ".openclaw", name));
    }
    candidates.push(path.join(home, ".moltbot", "openclaw.json"));
    for (const name of legacyConfigNames) {
      candidates.push(path.join(home, ".moltbot", name));
    }
    candidates.push(path.join(home, ".clawdbot", "openclaw.json"));
    for (const name of legacyConfigNames) {
      candidates.push(path.join(home, ".clawdbot", name));
    }
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

  async runInstaller(options: InstallerOptions): Promise<void> {
    console.log(term.bold("OpenClaw Studio Installer"));
    console.log("");

    requireNode18OrNewer();

    const destDir = path.resolve(process.cwd(), "openclaw-studio");
    installer.validateTargetDir(destDir);

    const npmOk = hasCommand("npm");
    const openclawOk = hasCommand("openclaw");
    const configPath = installer.resolveExistingConfigPath();
    const { config: cfg, error: configLoadError } = configPath
      ? loadOpenClawConfig(configPath)
      : { config: null as OpenClawConfig | null, error: undefined as string | undefined };

    const port = resolveGatewayPort(cfg);
    const localGatewayUrl = resolveLocalGatewayUrl(port);
    const remoteGatewayUrl = resolveRemoteGatewayUrl(cfg);
    const stateDir = resolveStateDirFromConfigPath(configPath ?? null);
    const settingsPath = resolveStudioSettingsPath(stateDir);
    const settingsSummary = readStudioSettingsSummary(settingsPath);
    const settingsGatewayUrl =
      settingsSummary?.url ? normalizeWsUrl(settingsSummary.url) : null;

    const fallbackHint = remoteGatewayUrl ?? localGatewayUrl;
    const gatewayUrlHint = parseGatewayUrlHint(options, fallbackHint);
    const explicitGatewayUrlRaw = options.gatewayUrl?.trim() ?? "";
    const envGatewayUrlRaw = process.env.NEXT_PUBLIC_GATEWAY_URL?.trim() ?? "";

    const localReachability = await checkGatewayReachable(localGatewayUrl, 800);
    const remoteReachability =
      remoteGatewayUrl && remoteGatewayUrl !== localGatewayUrl
        ? await checkGatewayReachable(remoteGatewayUrl, 800)
        : null;

    const explicitGatewayUrl = explicitGatewayUrlRaw
      ? normalizeWsUrl(explicitGatewayUrlRaw)
      : null;
    if (explicitGatewayUrlRaw && !explicitGatewayUrl) {
      throw new Error(
        `Invalid --gateway-url "${explicitGatewayUrlRaw}". Expected ws:// or wss://`
      );
    }

    const envGatewayUrl = envGatewayUrlRaw ? normalizeWsUrl(envGatewayUrlRaw) : null;
    if (envGatewayUrlRaw && !envGatewayUrl) {
      console.log(
        term.yellow(
          `Note: ignoring NEXT_PUBLIC_GATEWAY_URL=${envGatewayUrlRaw} (expected ws:// or wss://)`
        )
      );
      console.log("");
    }

    let selectedGatewayUrl =
      explicitGatewayUrl ??
      envGatewayUrl ??
      settingsGatewayUrl ??
      (localReachability === "reachable" ? localGatewayUrl : null) ??
      (remoteReachability === "reachable" ? remoteGatewayUrl : null) ??
      remoteGatewayUrl ??
      localGatewayUrl;

    let selectedReachability =
      selectedGatewayUrl === localGatewayUrl
        ? localReachability
        : remoteGatewayUrl && selectedGatewayUrl === remoteGatewayUrl
          ? remoteReachability ?? "unknown"
          : await checkGatewayReachable(selectedGatewayUrl, 800);

    console.log(term.bold("Preflight checks"));
    warnIfNodeTooOldForOpenClaw();
    console.log(
      formatCheckLine("npm is available in your PATH", npmOk ? "ok" : "fail")
    );
    console.log(
      formatCheckLine(
        "openclaw CLI is available in your PATH (recommended)",
        openclawOk ? "ok" : "warn"
      )
    );
    console.log(
      formatCheckLine(
        configPath ? "Found your OpenClaw config" : "No OpenClaw config found",
        configPath ? "ok" : "warn",
        configPath ? configPath : "run `openclaw onboard` to create one"
      )
    );
    if (configLoadError) {
      console.log(formatCheckLine("OpenClaw config parse", "warn", configLoadError));
    }
    console.log(
      formatCheckLine(
        `Local gateway at ${localGatewayUrl} is reachable`,
        localReachability === "reachable" ? "ok" : "warn",
        localReachability === "reachable"
          ? "connection successful"
          : localReachability === "unknown"
            ? "unable to check"
            : "not reachable right now"
      )
    );
    if (remoteGatewayUrl && remoteReachability) {
      console.log(
        formatCheckLine(
          `Remote gateway at ${remoteGatewayUrl} is reachable`,
          remoteReachability === "reachable" ? "ok" : "warn",
          remoteReachability === "reachable"
            ? "connection successful"
            : remoteReachability === "unknown"
              ? "unable to check"
              : "not reachable right now"
        )
      );
    }
    if (selectedGatewayUrl !== localGatewayUrl && selectedGatewayUrl !== remoteGatewayUrl) {
      console.log(
        formatCheckLine(
          `Gateway at ${selectedGatewayUrl} is reachable`,
          selectedReachability === "reachable" ? "ok" : "warn",
          selectedReachability === "reachable"
            ? "connection successful"
            : selectedReachability === "unknown"
              ? "unable to check"
              : "not reachable right now"
        )
      );
    }
    console.log(
      formatCheckLine(
        `Studio will target ${selectedGatewayUrl}`,
        selectedReachability === "reachable" ? "ok" : "warn",
        selectedReachability === "reachable" ? "reachable now" : "not reachable right now"
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
          "OpenClaw CLI is not installed (or not in PATH), so there is no local gateway to connect Studio to yet."
        )
      );
      console.log(term.dim("Install OpenClaw CLI: npm install -g openclaw@latest"));
      console.log(term.dim("Set it up with `openclaw onboard --install-daemon`"));
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

    if (
      selectedReachability !== "reachable" &&
      !explicitGatewayUrlRaw &&
      !envGatewayUrlRaw &&
      !remoteGatewayUrl &&
      process.stdin.isTTY
    ) {
      console.log(term.bold("Gateway setup"));
      console.log(
        term.dim(
          "If you're using a remote gateway (EC2, Tailscale, SSH tunnel), you can set it now so Studio is pre-configured."
        )
      );
      const wantsRemote = await promptYesNo("Configure a remote gateway URL now? (y/N) ");
      if (wantsRemote) {
        const url = await promptText("Gateway URL (ws:// or wss://): ");
        const normalized = normalizeWsUrl(url);
        if (!normalized) {
          console.log(term.red(`Invalid gateway url "${url}". Expected ws:// or wss://`));
        } else {
          selectedGatewayUrl = normalized;
          selectedReachability = await checkGatewayReachable(selectedGatewayUrl, 1200);
          const token = await promptText("Gateway token (optional, press enter to skip): ");
          if (token.trim()) {
            options.gatewayToken = token.trim();
          }
          console.log(
            formatCheckLine(
              `Gateway reachable (${selectedGatewayUrl})`,
              selectedReachability === "reachable" ? "ok" : "warn",
              selectedReachability === "reachable" ? "port open" : "not reachable right now"
            )
          );
          console.log("");
        }
      }
    }

    if (selectedReachability !== "reachable") {
      console.log(
        term.yellow(
          `Note: couldn't reach a gateway at ${selectedGatewayUrl}. That's OK during install, but Studio won't show anything until a gateway is running and reachable.`
        )
      );
      console.log(
        term.dim(
          `Start a local gateway: openclaw gateway run --bind loopback --port ${port} --verbose`
        )
      );
      if (!explicitGatewayUrlRaw && !envGatewayUrlRaw) {
        console.log(
          term.dim(
            `Or use: npx openclaw-studio --gateway-url wss://your-host:18789 --gateway-token <token>`
          )
        );
      }
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

    const tokenFromConfig = resolveGatewayToken(cfg);
    const token = options.gatewayToken?.trim()
      ? options.gatewayToken.trim()
      : tokenFromConfig.token;

    const authMode = coerceString(cfg?.gateway?.auth?.mode);
    const hasPassword =
      Boolean(coerceString(cfg?.gateway?.auth?.password)) ||
      Boolean(coerceString(cfg?.gateway?.remote?.password));

    const settingsWrite = await maybeWriteStudioSettings({
      options,
      stateDir,
      gatewayUrl: selectedGatewayUrl,
      token,
    });

    if (selectedReachability !== "reachable") {
      console.log("");
      console.log(term.bold("Gateway required"));
      console.log(
        term.yellow("You need to start your gateway to run OpenClaw Studio.")
      );
      console.log(term.dim(`Local: openclaw gateway run --bind loopback --port ${port} --verbose`));
      if (remoteGatewayUrl) {
        const transport = coerceString(cfg?.gateway?.remote?.transport);
        const sshTarget = coerceString(cfg?.gateway?.remote?.sshTarget);
        if (transport === "ssh" && sshTarget) {
          console.log(
            term.dim(
              `Remote (ssh tunnel): ssh -L ${port}:127.0.0.1:${port} ${sshTarget}`
            )
          );
          console.log(term.dim(`Then use: ${localGatewayUrl}`));
        }
      }
      console.log("");
    }

    console.log(term.dim(`Gateway URL: ${selectedGatewayUrl}`));
    if (token) {
      console.log(term.dim(`Token: configured (${options.gatewayToken?.trim() ? "installer flag" : tokenFromConfig.source})`));
    } else if (authMode === "password" || hasPassword) {
      console.log(
        term.yellow(
          "Note: your OpenClaw config appears to use password auth. Studio currently prompts for a token. If you can't connect, switch gateway.auth.mode to token (and set gateway.auth.token), then retry."
        )
      );
    } else {
      console.log(
        term.yellow(
          "Note: gateway token not detected. If your gateway requires auth, set gateway.auth.token (or OPENCLAW_GATEWAY_TOKEN) and retry."
        )
      );
    }
    if (settingsWrite.wrote) {
      console.log(term.dim(`Studio settings written: ${settingsWrite.path}`));
    } else if (settingsWrite.skippedBecauseExists) {
      console.log(term.dim(`Studio settings exists (not overwritten): ${settingsWrite.path}`));
    }

    console.log("");
    console.log(term.bold("Starting Studio"));
    const child = spawn("npm", ["run", "dev"], {
      cwd: destDir,
      stdio: "inherit",
      env: {
        ...process.env,
        NEXT_PUBLIC_GATEWAY_URL: selectedGatewayUrl,
      },
    });
    await new Promise<void>((resolve, reject) => {
      child.on("error", (error) => {
        reject(new Error(`Failed to start npm run dev: ${error.message}`));
      });
      child.on("close", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        if (signal) {
          reject(new Error(`npm run dev exited with signal ${signal}`));
          return;
        }
        reject(new Error(`npm run dev failed with exit code ${code}`));
      });
    });
  }
} as const;

async function runDoctor(options: DoctorOptions): Promise<void> {
  console.log(term.bold("OpenClaw Studio Doctor"));
  console.log("");

  requireNode18OrNewer();

  const openclawOk = hasCommand("openclaw");
  const configPath = installer.resolveExistingConfigPath();
  const { config: cfg, error: configLoadError } = configPath
    ? loadOpenClawConfig(configPath)
    : { config: null as OpenClawConfig | null, error: undefined as string | undefined };

  const port = resolveGatewayPort(cfg);
  const localGatewayUrl = resolveLocalGatewayUrl(port);
  const remoteGatewayUrl = resolveRemoteGatewayUrl(cfg);

  const explicitGatewayUrlRaw = options.gatewayUrl?.trim() ?? "";
  const envGatewayUrlRaw = process.env.NEXT_PUBLIC_GATEWAY_URL?.trim() ?? "";

  const localReachability = await checkGatewayReachable(localGatewayUrl, 800);
  const remoteReachability =
    remoteGatewayUrl && remoteGatewayUrl !== localGatewayUrl
      ? await checkGatewayReachable(remoteGatewayUrl, 800)
      : null;

  const explicitGatewayUrl = explicitGatewayUrlRaw ? normalizeWsUrl(explicitGatewayUrlRaw) : null;
  if (explicitGatewayUrlRaw && !explicitGatewayUrl) {
    throw new Error(`Invalid --gateway-url "${explicitGatewayUrlRaw}". Expected ws:// or wss://`);
  }

  const envGatewayUrl = envGatewayUrlRaw ? normalizeWsUrl(envGatewayUrlRaw) : null;
  if (envGatewayUrlRaw && !envGatewayUrl) {
    console.log(
      term.yellow(
        `Note: ignoring NEXT_PUBLIC_GATEWAY_URL=${envGatewayUrlRaw} (expected ws:// or wss://)`
      )
    );
    console.log("");
  }

  const stateDir = resolveStateDirFromConfigPath(configPath ?? null);
  const settingsPath = resolveStudioSettingsPath(stateDir);
  const settingsSummary = readStudioSettingsSummary(settingsPath);
  const settingsGatewayUrl =
    settingsSummary?.url ? normalizeWsUrl(settingsSummary.url) : null;

  const selectedGatewayUrl =
    explicitGatewayUrl ??
    envGatewayUrl ??
    settingsGatewayUrl ??
    (localReachability === "reachable" ? localGatewayUrl : null) ??
    (remoteReachability === "reachable" ? remoteGatewayUrl : null) ??
    remoteGatewayUrl ??
    localGatewayUrl;

  const selectedReachability =
    selectedGatewayUrl === localGatewayUrl
      ? localReachability
      : remoteGatewayUrl && selectedGatewayUrl === remoteGatewayUrl
        ? remoteReachability ?? "unknown"
        : await checkGatewayReachable(selectedGatewayUrl, 800);

  const tokenFromConfig = resolveGatewayToken(cfg);
  const token = options.gatewayToken?.trim() ? options.gatewayToken.trim() : tokenFromConfig.token;

  console.log(term.bold("Checks"));
  warnIfNodeTooOldForOpenClaw();
  console.log(
    formatCheckLine(
      "openclaw CLI is available in your PATH (recommended)",
      openclawOk ? "ok" : "warn"
    )
  );
  console.log(
    formatCheckLine(
      configPath ? "Found your OpenClaw config" : "No OpenClaw config found",
      configPath ? "ok" : "warn",
      configPath ? configPath : "run `openclaw onboard` to create one"
    )
  );
  if (configLoadError) {
    console.log(formatCheckLine("OpenClaw config parse", "warn", configLoadError));
  }
  console.log(
    formatCheckLine(
      `Studio settings (${settingsPath})`,
      settingsSummary ? "ok" : "warn",
      settingsSummary
        ? `gateway url: ${settingsSummary.url}`
        : "not found (will be created by installer/doctor --fix)"
    )
  );
  console.log(
    formatCheckLine(
      `Local gateway at ${localGatewayUrl} is reachable`,
      localReachability === "reachable" ? "ok" : "warn",
      localReachability === "reachable"
        ? "connection successful"
        : localReachability === "unknown"
          ? "unable to check"
          : "not reachable right now"
    )
  );
  if (remoteGatewayUrl && remoteReachability) {
    console.log(
      formatCheckLine(
        `Remote gateway at ${remoteGatewayUrl} is reachable`,
        remoteReachability === "reachable" ? "ok" : "warn",
        remoteReachability === "reachable"
          ? "connection successful"
          : remoteReachability === "unknown"
            ? "unable to check"
            : "not reachable right now"
      )
    );
  }
  console.log(
    formatCheckLine(
      `Studio will target ${selectedGatewayUrl}`,
      selectedReachability === "reachable" ? "ok" : "warn",
      selectedReachability === "reachable" ? "reachable now" : "not reachable right now"
    )
  );
  console.log(
    formatCheckLine(
      "Gateway token available",
      token ? "ok" : "warn",
      token ? (options.gatewayToken?.trim() ? "from --gateway-token" : tokenFromConfig.source) : "missing"
    )
  );
  console.log("");

  const authMode = coerceString(cfg?.gateway?.auth?.mode);
  const hasPassword =
    Boolean(coerceString(cfg?.gateway?.auth?.password)) ||
    Boolean(coerceString(cfg?.gateway?.remote?.password));

  if (!openclawOk) {
    console.log(term.yellow("OpenClaw is not installed (or not in PATH)."));
    console.log(term.dim("Fix: npm install -g openclaw@latest"));
    console.log(term.dim("Then: openclaw onboard --install-daemon"));
    console.log("");
  }

  if (selectedReachability !== "reachable") {
    console.log(term.yellow("Gateway is not reachable."));
    console.log(
      term.dim(
        `Fix (local): openclaw gateway run --bind loopback --port ${port} --verbose`
      )
    );
    if (!explicitGatewayUrlRaw && !envGatewayUrlRaw) {
      console.log(
        term.dim(
          `Fix (remote): openclaw gateway probe --url wss://your-host:${port} --token <token>`
        )
      );
    }
    console.log("");
  }

  if (!token && (authMode === "password" || hasPassword)) {
    console.log(
      term.yellow(
        "Your OpenClaw config appears to use password auth. Studio currently prompts for a token."
      )
    );
    console.log(
      term.dim(
        "Fix: switch to token auth (gateway.auth.mode=token, set gateway.auth.token), or use a token-enabled gateway."
      )
    );
    console.log("");
  }

  if (settingsSummary && settingsSummary.url !== selectedGatewayUrl) {
    console.log(term.yellow("Studio settings gateway URL does not match the selected gateway target."));
    console.log(term.dim(`Settings: ${settingsSummary.url}`));
    console.log(term.dim(`Target:   ${selectedGatewayUrl}`));
    console.log(term.dim("Fix: openclaw-studio doctor --fix"));
    console.log("");
  }

  if (options.mode === "fix") {
    const result = await maybeWriteStudioSettings({
      options,
      stateDir,
      gatewayUrl: selectedGatewayUrl,
      token,
    });
    if (result.wrote) {
      console.log(term.green(`Wrote Studio settings: ${result.path}`));
    } else if (result.skippedBecauseExists) {
      console.log(term.yellow(`Studio settings exists (not overwritten): ${result.path}`));
    } else {
      console.log(term.yellow("Did not write Studio settings (disabled by --no-write-settings)."));
    }
    console.log("");
    console.log(term.bold("Next"));
    console.log(term.dim("cd openclaw-studio"));
    console.log(term.dim("npm run dev"));
    console.log(term.dim("Open http://localhost:3000"));
  }
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
    console.error(term.red(parsed.message));
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    if (parsed.action === "doctor") {
      await runDoctor(parsed.options);
      return;
    }
    await installer.runInstaller(parsed.options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(term.red(message));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
