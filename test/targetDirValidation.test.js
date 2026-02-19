const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { installer } = require("../dist/openclaw-studio");

test("validation passes when target directory does not exist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-studio-test-"));
  const target = path.join(root, "openclaw-studio");
  assert.doesNotThrow(() => installer.validateTargetDir(target));
  fs.rmSync(root, { recursive: true, force: true });
});

test("validation fails when target directory exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-studio-test-"));
  const target = path.join(root, "openclaw-studio");
  fs.mkdirSync(target, { recursive: true });
  assert.throws(() => installer.validateTargetDir(target), {
    message: /Install cancelled: ".*" already exists\./
  });
  fs.rmSync(root, { recursive: true, force: true });
});
