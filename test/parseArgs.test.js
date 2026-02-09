const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../dist/openclaw-studio");

test("returns help for -h", () => {
  assert.deepStrictEqual(parseArgs(["-h"]), { action: "help" });
});

test("returns help for --help", () => {
  assert.deepStrictEqual(parseArgs(["--help"]), { action: "help" });
});

test("returns version for -v", () => {
  assert.deepStrictEqual(parseArgs(["-v"]), { action: "version" });
});

test("returns version for --version", () => {
  assert.deepStrictEqual(parseArgs(["--version"]), { action: "version" });
});

test("returns error for unknown args", () => {
  assert.deepStrictEqual(parseArgs(["--nope"]), {
    action: "error",
    message: "Unknown argument: --nope"
  });
});

test("returns run when no args", () => {
  assert.deepStrictEqual(parseArgs([]), {
    action: "run",
    options: {
      runAfterInstall: false,
      writeStudioSettings: true,
      forceStudioSettings: false
    }
  });
});

test("parses --run", () => {
  assert.deepStrictEqual(parseArgs(["--run"]), {
    action: "run",
    options: {
      runAfterInstall: true,
      writeStudioSettings: true,
      forceStudioSettings: false
    }
  });
});

test("parses --gateway-url and --gateway-token", () => {
  assert.deepStrictEqual(parseArgs(["--gateway-url", "ws://example:1", "--gateway-token", "t"]), {
    action: "run",
    options: {
      runAfterInstall: false,
      writeStudioSettings: true,
      forceStudioSettings: false,
      gatewayUrl: "ws://example:1",
      gatewayToken: "t"
    }
  });
});

test("parses --no-write-settings and --force-settings", () => {
  assert.deepStrictEqual(parseArgs(["--no-write-settings", "--force-settings"]), {
    action: "run",
    options: {
      runAfterInstall: false,
      writeStudioSettings: false,
      forceStudioSettings: true
    }
  });
});

test("parses doctor default (check)", () => {
  assert.deepStrictEqual(parseArgs(["doctor"]), {
    action: "doctor",
    options: {
      mode: "check",
      writeStudioSettings: true,
      forceStudioSettings: false
    }
  });
});

test("parses doctor --fix", () => {
  assert.deepStrictEqual(parseArgs(["doctor", "--fix"]), {
    action: "doctor",
    options: {
      mode: "fix",
      writeStudioSettings: true,
      forceStudioSettings: false
    }
  });
});

test("parses doctor --check + gateway flags", () => {
  assert.deepStrictEqual(parseArgs(["doctor", "--check", "--gateway-url", "ws://x:1", "--gateway-token=t"]), {
    action: "doctor",
    options: {
      mode: "check",
      writeStudioSettings: true,
      forceStudioSettings: false,
      gatewayUrl: "ws://x:1",
      gatewayToken: "t"
    }
  });
});
