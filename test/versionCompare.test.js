const test = require("node:test");
const assert = require("node:assert/strict");
const { compareSemverVersions } = require("../dist/openclaw-studio");

test("returns 0 when versions match", () => {
  assert.equal(compareSemverVersions("0.0.10", "0.0.10"), 0);
});

test("returns -1 when latest is newer", () => {
  assert.equal(compareSemverVersions("0.0.10", "0.0.11"), -1);
  assert.equal(compareSemverVersions("0.9.0", "1.0.0"), -1);
});

test("returns 1 when current is newer", () => {
  assert.equal(compareSemverVersions("1.2.0", "1.1.9"), 1);
});

test("treats prerelease as older than stable", () => {
  assert.equal(compareSemverVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareSemverVersions("1.0.0", "1.0.0-beta.1"), 1);
});

test("returns null for invalid semver strings", () => {
  assert.equal(compareSemverVersions("abc", "1.0.0"), null);
  assert.equal(compareSemverVersions("1.0.0", "latest"), null);
});
