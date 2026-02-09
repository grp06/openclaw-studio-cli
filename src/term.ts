const ANSI_RESET = "\x1b[0m";

function useColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
}

function wrap(code: string, text: string): string {
  if (!useColor()) return text;
  return `${code}${text}${ANSI_RESET}`;
}

export const term = {
  bold: (s: string) => wrap("\x1b[1m", s),
  dim: (s: string) => wrap("\x1b[2m", s),
  red: (s: string) => wrap("\x1b[31m", s),
  green: (s: string) => wrap("\x1b[32m", s),
  yellow: (s: string) => wrap("\x1b[33m", s),
  cyan: (s: string) => wrap("\x1b[36m", s)
};

export function formatCheckLine(
  label: string,
  status: "ok" | "warn" | "fail",
  detail?: string
): string {
  const tag =
    status === "ok"
      ? term.green("[OK]")
      : status === "warn"
        ? term.yellow("[WARN]")
        : term.red("[MISSING]");
  const rest = detail ? ` ${term.dim(detail)}` : "";
  return `${tag} ${label}${rest}`;
}

