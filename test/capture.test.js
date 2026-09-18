const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { captureSites } = require('../src/capture');
const { makeTempDir, createFakeLaunch } = require('./helpers');

const SITES = [
  { name: 'One', url: 'https://one.example/' },
  { name: 'Two', url: 'https://two.example/' },
  { name: 'Three', url: 'https://three.example/' },
];

function baseOptions(outputDir, launch, extra = {}) {
  return { outputDir, width: 1440, timeout: 1000, headless: true, launch, ...extra };
}

test('captures every site and reports progress in order', async (t) => {
  const dir = path.join(makeTempDir(t), 'nested', 'out');
  const { launch, state } = createFakeLaunch();
  const events = [];

  const summary = await captureSites(SITES, baseOptions(dir, launch, { onEvent: (e) => events.push(e) }));

  assert.equal(summary.saved, 3);
  assert.equal(summary.failed, 0);
  assert.equal(summary.cancelled, false);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['One.png', 'Three.png', 'Two.png']);
  assert.deepEqual(events.map((e) => e.type), [
    'start', 'site-start', 'site-done', 'site-start', 'site-done', 'site-start', 'site-done', 'done',
  ]);
  assert.equal(events[2].file, 'One.png');
  assert.equal(events[2].path, path.join(dir, 'One.png'));
  assert.deepEqual(state.launchOptions, { headless: true });
  assert.equal(state.pagesClosed, 3);
  assert.equal(state.browserClosed, true);
});

test('a failing site is recorded and the run continues', async (t) => {
  const dir = makeTempDir(t);
  const { launch, state } = createFakeLaunch({
    goto: async (url) => {
      if (url === SITES[1].url) throw new Error('net::ERR_NAME_NOT_RESOLVED');
    },
  });
  const events = [];

  const summary = await captureSites(SITES, baseOptions(dir, launch, { onEvent: (e) => events.push(e) }));

  assert.equal(summary.saved, 2);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.results.map((r) => r.status), ['saved', 'failed', 'saved']);
  const failure = events.find((e) => e.type === 'site-failed');
  assert.equal(failure.name, 'Two');
  assert.equal(failure.error, 'net::ERR_NAME_NOT_RESOLVED');
  assert.equal(state.pagesClosed, 3);
  assert.equal(state.browserClosed, true);
});

test('duplicate names get unique filenames, and failed sites do not use one up', async (t) => {
  const dir = makeTempDir(t);
  const sites = [
    { name: 'Docs', url: 'https://a.example/' },
    { name: 'Docs', url: 'https://broken.example/' },
    { name: 'docs', url: 'https://c.example/' },
  ];
  const { launch } = createFakeLaunch({
    goto: async (url) => {
      if (url.includes('broken')) throw new Error('boom');
    },
  });

  const summary = await captureSites(sites, baseOptions(dir, launch));

  assert.deepEqual(summary.results.map((r) => r.file), ['Docs.png', undefined, 'docs-1.png']);
});

test('reserved filenames are left alone', async (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, 'One.png'), 'earlier screenshot');
  const { launch } = createFakeLaunch();

  const summary = await captureSites(SITES.slice(0, 1), baseOptions(dir, launch, { reservedFilenames: ['One.png'] }));

  assert.equal(summary.results[0].file, 'One-1.png');
  assert.equal(fs.readFileSync(path.join(dir, 'One.png'), 'utf8'), 'earlier screenshot');
});

test('a very long name still produces a file the filesystem accepts', async (t) => {
  const dir = makeTempDir(t);
  const { launch } = createFakeLaunch();
  const url = `https://example.com/${'deep-path/'.repeat(40)}`;
  const sites = [{ name: `example.com/${'deep-path/'.repeat(40)}`, url }];

  const summary = await captureSites(sites, baseOptions(dir, launch));

  assert.equal(summary.saved, 1, summary.results[0].error);
  assert.ok(fs.existsSync(summary.results[0].path));
});

test('aborting stops the run, closes the browser and marks the site in progress', async (t) => {
  const dir = makeTempDir(t);
  const controller = new AbortController();
  const { launch, state } = createFakeLaunch({
    goto: async (url) => {
      if (url === SITES[1].url) {
        controller.abort();
        throw new Error('Target closed');
      }
    },
  });

  const summary = await captureSites(SITES, baseOptions(dir, launch, { signal: controller.signal }));

  assert.equal(summary.cancelled, true);
  assert.deepEqual(summary.results.map((r) => [r.name, r.status]), [['One', 'saved'], ['Two', 'cancelled']]);
  assert.equal(state.pagesOpened, 2);
  assert.equal(state.browserClosed, true);
});

test('an already-aborted signal captures nothing', async (t) => {
  const dir = makeTempDir(t);
  const controller = new AbortController();
  controller.abort();
  const { launch, state } = createFakeLaunch();

  const summary = await captureSites(SITES, baseOptions(dir, launch, { signal: controller.signal }));

  assert.equal(summary.results.length, 0);
  assert.equal(summary.cancelled, true);
  assert.equal(state.browserClosed, true);
});

test('a throwing progress listener does not fail the capture', async (t) => {
  const dir = makeTempDir(t);
  const { launch } = createFakeLaunch();
  t.mock.method(console, 'error', () => {});

  const summary = await captureSites(SITES.slice(0, 1), baseOptions(dir, launch, {
    onEvent: () => { throw new Error('listener bug'); },
  }));

  assert.equal(summary.saved, 1);
});

test('a browser that fails to launch rejects the run', async (t) => {
  const dir = makeTempDir(t);
  const launch = async () => { throw new Error('Could not find Chrome'); };
  await assert.rejects(captureSites(SITES, baseOptions(dir, launch)), /Could not find Chrome/);
});
