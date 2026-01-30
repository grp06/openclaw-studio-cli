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
