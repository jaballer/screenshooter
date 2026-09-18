// End-to-end tests with a real headless Chrome against a local page, so no
// internet access is needed. Slower than the other tests (a few seconds each).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { captureSites } = require('../src/capture');
const { RunManager } = require('../src/runs');
const { createApp } = require('../server');
const { DEFAULTS } = require('../src/config');
const { makeTempDir, listen, request, waitFor } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PAGE = '<!doctype html><title>Fixture</title><body style="margin:0"><div style="height:1500px;background:#4f46e5">Hello</div></body>';

// Width and height from a PNG's IHDR chunk
function pngSize(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function startFixtureSite(t) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  const port = await listen(server);
  t.after(() => server.close());
  return `http://127.0.0.1:${port}/`;
}

function runCli(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['screenshot.js'], { cwd: ROOT, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('captures a full-page screenshot at the requested width', { timeout: 60000 }, async (t) => {
  const url = await startFixtureSite(t);
  const dir = makeTempDir(t);

  const summary = await captureSites([{ name: 'Fixture', url }], { outputDir: dir, width: 800, timeout: 15000, headless: true });

  assert.equal(summary.saved, 1, JSON.stringify(summary.results));
  const { width, height } = pngSize(path.join(dir, 'Fixture.png'));
  assert.equal(width, 800);
  assert.ok(height >= 1500, `height ${height}`);
});

test('the CLI saves screenshots and exits non-zero when a site fails', { timeout: 60000 }, async (t) => {
  const url = await startFixtureSite(t);
  const dir = makeTempDir(t);
  const out = path.join(dir, 'shots');
  const env = { OUTPUT_DIR: out, HEADLESS_MODE: 'true', TIMEOUT: '15000', SCREENSHOT_WIDTH: '1024' };

  const good = path.join(dir, 'good.csv');
  fs.writeFileSync(good, `name,url\nFixture,${url}\nnowhere,file:///etc/passwd\n`);
  const ok = await runCli({ ...env, CSV_FILE: good });
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /Capturing: Fixture - http:\/\/127\.0\.0\.1/);
  assert.match(ok.stdout, /Saved: .*Fixture\.png/);
  assert.match(ok.stdout, /All screenshots captured!/);
  assert.match(ok.stderr, /Skipping Row 2 \(nowhere, file:\/\/\/etc\/passwd\): Unsupported URL scheme/);
  assert.equal(pngSize(path.join(out, 'Fixture.png')).width, 1024);

  const mixed = path.join(dir, 'mixed.csv');
  fs.writeFileSync(mixed, `name,url\nFixture,${url}\nBroken,http://127.0.0.1:1/\n`);
  const failed = await runCli({ ...env, CSV_FILE: mixed });
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /Failed to capture Broken: net::ERR_/);
  assert.match(failed.stdout, /Finished: 1 saved, 1 failed\./);

  const missing = await runCli({ ...env, CSV_FILE: path.join(dir, 'nope.csv') });
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /CSV file not found/);
});

test('a web run captures real screenshots into its run folder', { timeout: 60000 }, async (t) => {
  const url = await startFixtureSite(t);
  const dir = makeTempDir(t);
  const runs = new RunManager({ outputDir: dir });
  const server = http.createServer(createApp({ config: { ...DEFAULTS }, runs }));
  const port = await listen(server);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const res = await request(port, {
    method: 'POST',
    path: '/api/runs',
    body: { source: 'urls', text: `Fixture, ${url}`, options: { width: 900, timeout: 15000 } },
  });
  assert.equal(res.status, 202, res.text);
  const { id } = res.json.run;

  const run = await waitFor(async () => {
    const current = (await request(port, { path: `/api/runs/${id}` })).json.run;
    return current.status !== 'running' && current;
  }, { timeout: 30000 });
  assert.equal(run.status, 'completed', JSON.stringify(run.sites));
  assert.equal(run.sites[0].file, 'Fixture.png');
  assert.equal(pngSize(path.join(dir, id, 'Fixture.png')).width, 900);

  const image = await request(port, { path: `/screenshots/${id}/Fixture.png` });
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/png');
});
