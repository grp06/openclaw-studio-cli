const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("build output does not contain stale dist/installer.js", () => {
  const installerPath = path.join(__dirname, "..", "dist", "installer.js");
  assert.equal(
    fs.existsSync(installerPath),
    false,
    "dist/installer.js should not exist; build should clean dist/ before compiling"
  );
});
