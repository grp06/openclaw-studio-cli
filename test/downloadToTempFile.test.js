const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { installer } = require("../dist/openclaw-studio");

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

test("downloadToTempFile writes response body to a temp file", async (t) => {
  const payload = Buffer.from("openclaw");
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": payload.length
    });
    res.end(payload);
  });

  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  const filePath = await installer.downloadToTempFile(`${url}/archive.tar.gz`);
  t.after(() => fs.rmSync(filePath, { force: true }));

  const stored = fs.readFileSync(filePath);
  assert.deepStrictEqual(stored, payload);
});

test("downloadToTempFile rejects non-ok responses", async (t) => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("nope");
  });

  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  await assert.rejects(
    () => installer.downloadToTempFile(`${url}/fail.tar.gz`),
    /Failed to download .*: 500/
  );
});

test("downloadToTempFile rejects empty response bodies", async (t) => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(204);
    res.end();
  });

  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  await assert.rejects(
    () => installer.downloadToTempFile(`${url}/empty.tar.gz`),
    /empty response body/
  );
});
