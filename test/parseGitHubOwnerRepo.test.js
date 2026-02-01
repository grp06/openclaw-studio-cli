const test = require("node:test");
const assert = require("node:assert/strict");
const { installer } = require("../dist/openclaw-studio");

test("supports https://github.com/o/r", () => {
  assert.deepStrictEqual(installer.parseGitHubOwnerRepo("https://github.com/o/r"), {
    owner: "o",
    repo: "r"
  });
});

test("supports https://github.com/o/r.git", () => {
  assert.deepStrictEqual(installer.parseGitHubOwnerRepo("https://github.com/o/r.git"), {
    owner: "o",
    repo: "r"
  });
});

test("supports https://github.com/o/r/ with whitespace", () => {
  assert.deepStrictEqual(installer.parseGitHubOwnerRepo("  https://github.com/o/r/  "), {
    owner: "o",
    repo: "r"
  });
});

test("supports git@github.com:o/r", () => {
  assert.deepStrictEqual(installer.parseGitHubOwnerRepo("git@github.com:o/r"), {
    owner: "o",
    repo: "r"
  });
});

test("supports git@github.com:o/r.git", () => {
  assert.deepStrictEqual(installer.parseGitHubOwnerRepo("git@github.com:o/r.git"), {
    owner: "o",
    repo: "r"
  });
});

test("rejects unsupported repo URLs", () => {
  assert.throws(() => installer.parseGitHubOwnerRepo("https://example.com/o/r"), {
    message: /Unsupported repo URL/
  });
});

test("builds tarball url for main branch", () => {
  assert.equal(
    installer.getGitHubTarballUrl("openclaw", "studio"),
    "https://codeload.github.com/openclaw/studio/tar.gz/main"
  );
});
