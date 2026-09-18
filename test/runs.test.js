const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RunManager, RunInProgressError, isValidRunId, createRunId } = require('../src/runs');
const { makeTempDir } = require('./helpers');

const SITES = [
  { name: 'One', url: 'https://one.example/' },
  { name: 'Two', url: 'https://two.example/' },
];
const OPTIONS = { width: 1440, timeout: 1000, headless: true };

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

// Stand-in for captureSites that "saves" each site, optionally pausing at a gate
function fakeCapture({ gate } = {}) {
  return async (sites, { outputDir, onEvent, signal }) => {
    for (const [index] of sites.entries()) {
      if (signal.aborted) break;
      onEvent({ type: 'site-start', index });
      if (gate) await gate.promise;
      if (signal.aborted) {
        onEvent({ type: 'site-cancelled', index, status: 'cancelled', error: 'Target closed', durationMs: 1 });
        break;
      }
      const file = `${index}.png`;
      fs.writeFileSync(path.join(outputDir, file), 'x');
      onEvent({ type: 'site-done', index, file, durationMs: 1 });
    }
    return { cancelled: signal.aborted };
  };
}

const nextEnd = (runs) => new Promise((resolve) => runs.once('end', resolve));
const readManifest = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, id, 'run.json'), 'utf8'));

test('run IDs have the expected shape', () => {
  const id = createRunId(new Date(2026, 8, 17, 18, 30, 12));
  assert.match(id, /^20260917-183012-[0-9a-f]{4}$/);
  assert.ok(isValidRunId(id));
  for (const bad of ['', '../etc', '20260917-183012-ZZZZ', '20260917-183012-a1b2/..', null, 42]) {
    assert.equal(isValidRunId(bad), false, String(bad));
  }
});

test('a run captures into its own folder and records the result', async (t) => {
  const dir = makeTempDir(t);
  const runs = new RunManager({ outputDir: dir, capture: fakeCapture() });
  const updates = [];
  runs.on('update', (run) => updates.push(run.sites.map((s) => s.status).join(',')));

  const ended = nextEnd(runs);
  const run = runs.start({ sites: SITES, options: OPTIONS, source: { type: 'urls' } });
  assert.equal(run.status, 'running');
  assert.equal(readManifest(dir, run.id).status, 'running');
  await ended;

  const saved = readManifest(dir, run.id);
  assert.equal(saved.status, 'completed');
  assert.ok(saved.finishedAt);
  // Saved via a temporary file that is renamed into place
  assert.deepEqual(fs.readdirSync(path.join(dir, run.id)).sort(), ['0.png', '1.png', 'run.json']);
  assert.deepEqual(saved.sites.map((s) => [s.status, s.file]), [['saved', '0.png'], ['saved', '1.png']]);
  assert.ok(fs.existsSync(path.join(dir, run.id, '0.png')));
  assert.deepEqual(updates.slice(0, 2), ['capturing,pending', 'saved,pending']);
  assert.equal(runs.active, null);
});

test('only one run at a time', async (t) => {
  const dir = makeTempDir(t);
  const gate = deferred();
  const runs = new RunManager({ outputDir: dir, capture: fakeCapture({ gate }) });

  const ended = nextEnd(runs);
  const first = runs.start({ sites: SITES, options: OPTIONS, source: { type: 'urls' } });
  assert.throws(
    () => runs.start({ sites: SITES, options: OPTIONS, source: { type: 'urls' } }),
    (error) => error instanceof RunInProgressError && error.runId === first.id,
  );

  gate.resolve();
  await ended;
  const second = runs.start({ sites: SITES, options: OPTIONS, source: { type: 'urls' } });
  assert.notEqual(second.id, first.id);
  await nextEnd(runs);
});

test('cancelling stops the run and marks unreached sites', async (t) => {
  const dir = makeTempDir(t);
  const gate = deferred();
  const runs = new RunManager({ outputDir: dir, capture: fakeCapture({ gate }) });

  const ended = nextEnd(runs);
  const run = runs.start({ sites: SITES, options: OPTIONS, source: { type: 'urls' } });
  assert.equal(runs.cancel('20000101-000000-0000'), false);
  assert.equal(runs.cancel(run.id), true);
  assert.equal(run.cancelRequested, true);
  gate.resolve();
  await ended;

  const saved = readManifest(dir, run.id);
  assert.equal(saved.status, 'cancelled');
  assert.deepEqual(saved.sites.map((s) => s.status), ['cancelled', 'cancelled']);
  assert.equal(runs.cancel(run.id), false);
});

test('a run whose browser fails to start is recorded as an error', async (t) => {
  const dir = makeTempDir(t);
  const runs = new RunManager({
    outputDir: dir,
    capture: async () => { throw new Error('Could not find Chrome'); },
  });

  const ended = nextEnd(runs);
  const run = runs.start({ sites: SITES, options: OPTIONS, source: { type: 'urls' } });
  await ended;

  const saved = runs.get(run.id);
  assert.equal(saved.status, 'error');
  assert.equal(saved.error, 'Could not find Chrome');
  assert.deepEqual(saved.sites.map((s) => [s.status, s.error]), [
    ['failed', 'Could not find Chrome'],
    ['failed', 'Could not find Chrome'],
  ]);
});

test('get rejects bad IDs and reports runs left running as interrupted', (t) => {
  const dir = makeTempDir(t);
  const runs = new RunManager({ outputDir: dir, capture: fakeCapture() });
  assert.equal(runs.get('../../etc'), null);
  assert.equal(runs.get('20260101-000000-abcd'), null);

  const id = '20260101-000000-abcd';
  fs.mkdirSync(path.join(dir, id));
  fs.writeFileSync(path.join(dir, id, 'run.json'), JSON.stringify({
    id,
    status: 'running',
    source: { type: 'urls' },
    startedAt: '2026-01-01T00:00:00.000Z',
    sites: [
      { name: 'Done', status: 'saved', file: 'Done.png', error: null },
      { name: 'Midway', status: 'capturing', file: null, error: null },
      { name: 'Queued', status: 'pending', file: null, error: null },
    ],
  }));

  const run = runs.get(id);
  assert.equal(run.status, 'interrupted');
  assert.deepEqual(run.sites.map((s) => s.status), ['saved', 'failed', 'failed']);
  assert.equal(run.sites[1].error, 'The server stopped before this site was captured');
  assert.deepEqual(runs.list().map((r) => [r.status, r.saved, r.failed]), [['interrupted', 1, 2]]);
});

test('list returns run folders newest first and ignores everything else', async (t) => {
  const dir = makeTempDir(t);
  const runs = new RunManager({ outputDir: dir, capture: fakeCapture() });
  fs.writeFileSync(path.join(dir, 'GitHub.png'), 'old flat screenshot');
  fs.mkdirSync(path.join(dir, 'not-a-run'));
  fs.mkdirSync(path.join(dir, '20260101-000000-dead')); // no run.json
  fs.mkdirSync(path.join(dir, '20260101-000000-beef'));
  fs.writeFileSync(path.join(dir, '20260101-000000-beef', 'run.json'), '{"id":"20260101-000000-beef"}'); // no sites
  for (const id of ['20260101-090000-aaaa', '20260102-090000-bbbb']) {
    fs.mkdirSync(path.join(dir, id));
    fs.writeFileSync(path.join(dir, id, 'run.json'), JSON.stringify({
      id,
      status: 'completed',
      source: { type: 'urls' },
      startedAt: '2026-01-01T09:00:00.000Z',
      sites: [{ status: 'saved' }, { status: 'failed' }],
    }));
  }

  const list = runs.list();
  assert.deepEqual(list.map((r) => r.id), ['20260102-090000-bbbb', '20260101-090000-aaaa']);
  assert.deepEqual({ total: list[0].total, saved: list[0].saved, failed: list[0].failed }, { total: 2, saved: 1, failed: 1 });
});

test('list is empty when the output folder does not exist yet', (t) => {
  const dir = path.join(makeTempDir(t), 'missing');
  assert.deepEqual(new RunManager({ outputDir: dir }).list(), []);
});
