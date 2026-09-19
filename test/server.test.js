const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createApp } = require('../server');
const { RunManager } = require('../src/runs');
const { DEFAULTS } = require('../src/config');
const { makeTempDir, request, listen, waitFor } = require('./helpers');

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function fakeCapture(gate) {
  return async (sites, { outputDir, onEvent, signal }) => {
    for (const [index] of sites.entries()) {
      if (signal.aborted) break;
      onEvent({ type: 'site-start', index });
      if (gate) await gate.promise;
      if (signal.aborted) break;
      fs.writeFileSync(path.join(outputDir, `${index}.png`), 'fake png');
      onEvent({ type: 'site-done', index, file: `${index}.png`, durationMs: 1 });
    }
    return { cancelled: signal.aborted };
  };
}

async function startServer(t, { gate, config = {}, capture = fakeCapture(gate) } = {}) {
  const dir = makeTempDir(t);
  const runs = new RunManager({ outputDir: dir, capture });
  const server = http.createServer(createApp({ config: { ...DEFAULTS, ...config }, runs }));
  const port = await listen(server);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { port, runs, dir };
}

const START_BODY = { source: 'urls', text: 'github.com\nReact, https://react.dev', options: {} };

async function startRun(port, body = START_BODY) {
  return request(port, { method: 'POST', path: '/api/runs', body });
}

async function waitForStatus(port, id, status) {
  return waitFor(async () => {
    const res = await request(port, { path: `/api/runs/${id}` });
    return res.json.run.status === status && res.json.run;
  });
}

test('serves the web UI', async (t) => {
  const { port } = await startServer(t);
  const res = await request(port, { path: '/' });
  assert.equal(res.status, 200);
  assert.match(res.text, /<title>ScreenShooter<\/title>/);
});

test('refuses requests addressed to other hostnames', async (t) => {
  const { port } = await startServer(t);
  for (const host of ['evil.example', `evil.example:${port}`, `localhost.evil.example:${port}`, `127.0.0.1.nip.io:${port}`]) {
    const res = await request(port, { path: '/api/runs', headers: { Host: host } });
    assert.equal(res.status, 403, host);
  }
  for (const host of [`127.0.0.1:${port}`, `[::1]:${port}`, 'localhost']) {
    const res = await request(port, { path: '/api/config', headers: { Host: host } });
    assert.equal(res.status, 200, host);
  }
});

test('reports defaults and limits', async (t) => {
  const { port } = await startServer(t);
  const res = await request(port, { path: '/api/config' });
  assert.deepEqual(res.json.defaults, { width: 1440, timeout: 60000, headless: true });
  assert.deepEqual(res.json.limits.width, { min: 320, max: 3840 });
});

test('out-of-range settings from .env still give the UI valid defaults', async (t) => {
  const { port } = await startServer(t, { config: { width: 5000, timeout: 600000 } });

  const config = await request(port, { path: '/api/config' });
  assert.deepEqual(config.json.defaults, { width: 3840, timeout: 300000, headless: true });

  const res = await startRun(port, { source: 'urls', text: 'github.com' });
  assert.equal(res.status, 202, res.text);
  assert.deepEqual(res.json.run.options, { width: 3840, timeout: 300000, headless: true });
});

test('refuses web runs over the site limit', async (t) => {
  const { port, runs } = await startServer(t);
  const text = Array.from({ length: 1001 }, (_, i) => `site${i}.example`).join('\n');

  const res = await startRun(port, { source: 'urls', text });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /That's 1,001 sites\. The web app captures up to 1,000 per run/);
  assert.deepEqual(runs.list(), []);
});

test('POSTs must be JSON from a localhost origin', async (t) => {
  const { port } = await startServer(t);

  const plain = await request(port, {
    method: 'POST', path: '/api/runs', body: 'source=urls', headers: { 'Content-Type': 'text/plain' },
  });
  assert.equal(plain.status, 415);

  for (const origin of ['https://evil.example', 'null']) {
    const res = await request(port, { method: 'POST', path: '/api/runs', body: START_BODY, headers: { Origin: origin } });
    assert.equal(res.status, 403, origin);
  }

  const broken = await request(port, { method: 'POST', path: '/api/runs', body: '{not json' });
  assert.equal(broken.status, 400);
  assert.equal(broken.json.error, 'Request body is not valid JSON');

  const fromLocal = await request(port, {
    method: 'POST', path: '/api/runs', body: START_BODY, headers: { Origin: `http://localhost:${port}` },
  });
  assert.equal(fromLocal.status, 202);
});

test('validates the request before starting a run', async (t) => {
  const { port, runs } = await startServer(t);

  const badSource = await startRun(port, { source: 'ftp', text: 'x' });
  assert.equal(badSource.status, 400);

  const arrayBody = await startRun(port, '[]');
  assert.equal(arrayBody.status, 400);
  assert.equal(arrayBody.json.error, 'Expected a JSON object');

  const badText = await startRun(port, { source: 'urls', text: 42 });
  assert.equal(badText.status, 400);

  const badOptions = await startRun(port, { ...START_BODY, options: { width: 10, timeout: 1 } });
  assert.equal(badOptions.status, 400);
  assert.match(badOptions.json.error, /Width.*Timeout/);

  const nothingValid = await startRun(port, { source: 'urls', text: 'not a url\nfile:///etc/passwd' });
  assert.equal(nothingValid.status, 400);
  assert.equal(nothingValid.json.error, 'No valid URLs found');
  assert.equal(nothingValid.json.skipped.length, 2);

  const badCsv = await startRun(port, { source: 'csv', text: 'site,link\nGitHub,github.com' });
  assert.equal(badCsv.status, 400);
  assert.match(badCsv.json.error, /needs a "url" column/);

  assert.deepEqual(runs.list(), []);
});

test('runs a capture and serves its screenshots and history', async (t) => {
  const { port } = await startServer(t);

  const res = await startRun(port, {
    source: 'csv',
    filename: 'websites.csv',
    text: 'name,url\nGitHub,github.com\n,https://react.dev\nBad,javascript:alert(1)\n',
    options: { width: 1280, timeout: 30000, headless: false },
  });
  assert.equal(res.status, 202);
  const { id } = res.json.run;

  const run = await waitForStatus(port, id, 'completed');
  assert.deepEqual(run.options, { width: 1280, timeout: 30000, headless: false });
  assert.deepEqual(run.source, { type: 'csv', filename: 'websites.csv' });
  assert.deepEqual(run.sites.map((s) => [s.name, s.status]), [['GitHub', 'saved'], ['react.dev', 'saved']]);
  assert.equal(run.skipped.length, 1);

  const image = await request(port, { path: `/screenshots/${id}/0.png` });
  assert.equal(image.status, 200);
  assert.equal(image.text, 'fake png');

  const list = await request(port, { path: '/api/runs' });
  assert.deepEqual(list.json.runs.map((r) => r.id), [id]);
  assert.equal(list.json.activeRunId, null);
});

test('a second run is refused while one is in progress', async (t) => {
  const gate = deferred();
  const { port, runs } = await startServer(t, { gate });

  const first = await startRun(port);
  const second = await startRun(port);
  assert.equal(second.status, 409);
  assert.equal(second.json.activeRunId, first.json.run.id);

  const list = await request(port, { path: '/api/runs' });
  assert.equal(list.json.activeRunId, first.json.run.id);

  const ended = new Promise((resolve) => runs.once('end', resolve));
  gate.resolve();
  await ended;
});

test('cancels a running capture', async (t) => {
  const gate = deferred();
  const { port } = await startServer(t, { gate });

  const { id } = (await startRun(port)).json.run;
  assert.equal((await request(port, { method: 'POST', path: '/api/runs/20000101-000000-abcd/cancel', body: {} })).status, 404);

  const cancel = await request(port, { method: 'POST', path: `/api/runs/${id}/cancel`, body: {} });
  assert.equal(cancel.status, 202);
  gate.resolve();

  const run = await waitForStatus(port, id, 'cancelled');
  assert.ok(run.sites.every((s) => s.status === 'cancelled'));

  const again = await request(port, { method: 'POST', path: `/api/runs/${id}/cancel`, body: {} });
  assert.equal(again.status, 409);
});

test('retries failed sites of a finished run', async (t) => {
  // The first attempt at react.dev fails; later attempts succeed
  let attempts = 0;
  const capture = async (sites, { outputDir, onEvent }) => {
    sites.forEach((site, index) => {
      onEvent({ type: 'site-start', index });
      if (site.url === 'https://react.dev/' && attempts++ === 0) {
        onEvent({ type: 'site-failed', index, status: 'failed', error: 'net::ERR_TIMED_OUT', durationMs: 1 });
        return;
      }
      const file = `${site.name}.png`;
      fs.writeFileSync(path.join(outputDir, file), 'fake png');
      onEvent({ type: 'site-done', index, file, durationMs: 1 });
    });
    return { cancelled: false };
  };
  const { port } = await startServer(t, { capture });

  const { id } = (await startRun(port)).json.run;
  const first = await waitForStatus(port, id, 'completed');
  assert.deepEqual(first.sites.map((s) => s.status), ['saved', 'failed']);

  const retry = await request(port, { method: 'POST', path: `/api/runs/${id}/retry`, body: { sites: [1] } });
  assert.equal(retry.status, 202, retry.text);
  assert.deepEqual(retry.json.run.sites.map((s) => s.status), ['saved', 'pending']);

  const done = await waitForStatus(port, id, 'completed');
  assert.deepEqual(done.sites.map((s) => [s.status, s.file]), [['saved', 'github.com.png'], ['saved', 'React.png']]);

  const nothingLeft = await request(port, { method: 'POST', path: `/api/runs/${id}/retry`, body: {} });
  assert.equal(nothingLeft.status, 400);
  assert.equal(nothingLeft.json.error, 'There are no failed sites to retry');
});

test('validates retry requests', async (t) => {
  const gate = deferred();
  const { port, runs } = await startServer(t, { gate });
  const { id } = (await startRun(port)).json.run;

  const busy = await request(port, { method: 'POST', path: `/api/runs/${id}/retry`, body: {} });
  assert.equal(busy.status, 409);
  assert.equal(busy.json.activeRunId, id);

  const ended = new Promise((resolve) => runs.once('end', resolve));
  gate.resolve();
  await ended;

  // A body that isn't a JSON object must not be read as "retry everything"
  for (const body of ['[]', 'null', '42', '"sites"']) {
    const res = await request(port, { method: 'POST', path: `/api/runs/${id}/retry`, body });
    assert.equal(res.status, 400, body);
  }
  const noBody = await request(port, { method: 'POST', path: `/api/runs/${id}/retry`, headers: { 'Content-Type': 'application/json' } });
  assert.equal(noBody.status, 400);

  for (const sites of ['1', [1.5], [null], {}]) {
    const res = await request(port, { method: 'POST', path: `/api/runs/${id}/retry`, body: { sites } });
    assert.equal(res.status, 400, JSON.stringify(sites));
  }
  const saved = await request(port, { method: 'POST', path: `/api/runs/${id}/retry`, body: { sites: [0] } });
  assert.equal(saved.status, 400);
  assert.match(saved.json.error, /doesn't need a retry/);

  assert.equal((await request(port, { method: 'POST', path: '/api/runs/20000101-000000-abcd/retry', body: {} })).status, 404);
  const plain = await request(port, {
    method: 'POST', path: `/api/runs/${id}/retry`, body: 'x', headers: { 'Content-Type': 'text/plain' },
  });
  assert.equal(plain.status, 415);
});

test('deletes a finished run', async (t) => {
  const { port, dir } = await startServer(t);
  const { id } = (await startRun(port)).json.run;
  await waitForStatus(port, id, 'completed');

  // No body and no Content-Type needed
  const res = await request(port, { method: 'DELETE', path: `/api/runs/${id}` });
  assert.equal(res.status, 204, res.text);
  assert.equal(res.text, '');
  assert.equal(fs.existsSync(path.join(dir, id)), false);

  assert.equal((await request(port, { path: `/api/runs/${id}` })).status, 404);
  assert.equal((await request(port, { path: `/screenshots/${id}/0.png` })).status, 404);
  assert.deepEqual((await request(port, { path: '/api/runs' })).json.runs, []);
});

test('deleting an unknown or malformed run is a 404', async (t) => {
  const { port, dir } = await startServer(t);
  const { id } = (await startRun(port)).json.run;
  await waitForStatus(port, id, 'completed');
  assert.equal((await request(port, { method: 'DELETE', path: `/api/runs/${id}` })).status, 204);

  for (const urlPath of [`/api/runs/${id}`, '/api/runs/20000101-000000-abcd', '/api/runs/not-a-run', '/api/runs/..%2F..', '/api/runs/%2e%2e']) {
    const res = await request(port, { method: 'DELETE', path: urlPath });
    assert.equal(res.status, 404, urlPath);
    assert.equal(res.json.error, 'Run not found', urlPath);
  }
  assert.ok(fs.existsSync(dir));
});

test('refuses to delete the run in progress', async (t) => {
  const gate = deferred();
  const { port, runs, dir } = await startServer(t, { gate });
  const { id } = (await startRun(port)).json.run;

  const busy = await request(port, { method: 'DELETE', path: `/api/runs/${id}` });
  assert.equal(busy.status, 409);
  assert.equal(busy.json.activeRunId, id);
  assert.match(busy.json.error, /still capturing/);
  assert.ok(fs.existsSync(path.join(dir, id)));

  const ended = new Promise((resolve) => runs.once('end', resolve));
  gate.resolve();
  await ended;
  assert.equal((await request(port, { method: 'DELETE', path: `/api/runs/${id}` })).status, 204);
});

test('DELETEs must come from a localhost origin', async (t) => {
  const { port, dir } = await startServer(t);
  const { id } = (await startRun(port)).json.run;
  await waitForStatus(port, id, 'completed');

  for (const origin of ['https://evil.example', 'null']) {
    const res = await request(port, { method: 'DELETE', path: `/api/runs/${id}`, headers: { Origin: origin } });
    assert.equal(res.status, 403, origin);
  }
  assert.ok(fs.existsSync(path.join(dir, id, 'run.json')));

  const fromLocal = await request(port, {
    method: 'DELETE', path: `/api/runs/${id}`, headers: { Origin: `http://localhost:${port}` },
  });
  assert.equal(fromLocal.status, 204);
});

test('streams progress as server-sent events', async (t) => {
  const gate = deferred();
  const { port } = await startServer(t, { gate });
  const { id } = (await startRun(port)).json.run;

  const body = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `/api/runs/${id}/events`, headers: { Host: `localhost:${port}` } }, (res) => {
      assert.equal(res.headers['content-type'], 'text/event-stream');
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        if (data.includes('event: run')) gate.resolve();
      });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });

  const events = body.trim().split('\n\n').map((block) => {
    const [eventLine, dataLine] = block.split('\n');
    return { event: eventLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) };
  });
  assert.equal(events.at(-1).event, 'end');
  const runs = events.filter((e) => e.event === 'run').map((e) => e.data);
  assert.ok(runs.length >= 3);
  assert.equal(runs.at(-1).status, 'completed');

  // A finished run replays its final state and ends immediately
  const replay = await request(port, { path: `/api/runs/${id}/events` });
  assert.match(replay.text, /^event: run\n.*\n\nevent: end\n/s);
});

test('stops listening for progress when the browser disconnects', async (t) => {
  const gate = deferred();
  const { port, runs } = await startServer(t, { gate });
  const { id } = (await startRun(port)).json.run;

  const req = http.get({ host: '127.0.0.1', port, path: `/api/runs/${id}/events`, headers: { Host: `localhost:${port}` } });
  const res = await new Promise((resolve) => req.on('response', resolve));
  await new Promise((resolve) => res.once('data', resolve));
  assert.equal(runs.listenerCount('update'), 1);

  req.destroy();
  await waitFor(() => runs.listenerCount('update') === 0 && runs.listenerCount('end') === 0);

  const ended = new Promise((resolve) => runs.once('end', resolve));
  gate.resolve();
  await ended;
});

test('rejects unknown and malformed run IDs', async (t) => {
  const { port } = await startServer(t);
  for (const urlPath of ['/api/runs/not-a-run', '/api/runs/..%2F..%2Fetc', '/api/runs/20000101-000000-abcd', '/api/runs/x/events']) {
    const res = await request(port, { path: urlPath });
    assert.equal(res.status, 404, urlPath);
  }
  assert.equal((await request(port, { path: '/api/nope' })).status, 404);
});

test('screenshot files cannot escape the output folder', async (t) => {
  const { port } = await startServer(t);
  for (const urlPath of ['/screenshots/../package.json', '/screenshots/%2e%2e/package.json', '/screenshots/..%2fpackage.json']) {
    const res = await request(port, { path: urlPath });
    assert.notEqual(res.status, 200, urlPath);
    assert.doesNotMatch(res.text, /"name": "screenshooter"/, urlPath);
  }
});
