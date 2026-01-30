#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { runInstaller } from "./installer";
import { parseArgs } from "./cli";

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

main();
