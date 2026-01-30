const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../dist/cli");

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
  assert.deepStrictEqual(parseArgs([]), { action: "run" });
});
