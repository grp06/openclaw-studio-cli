#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { runInstaller } from "./installer";

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
  console.log("OpenClaw Studio Installer\n\nUsage:\n  openclaw-studio\n\nOptions:\n  -h, --help     Show help\n  -v, --version  Show version");
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
