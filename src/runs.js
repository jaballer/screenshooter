const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { captureSites } = require('./capture');

// Run IDs double as folder names, so anything outside this exact shape is
// rejected before it gets near the filesystem.
const RUN_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const MANIFEST_FILE = 'run.json';

function isValidRunId(id) {
  return typeof id === 'string' && RUN_ID_PATTERN.test(id);
}

// e.g. 20260917-183012-a1b2 (local time, so folders sort and read naturally)
function createRunId(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${day}-${time}-${crypto.randomBytes(2).toString('hex')}`;
}

function summarize(run) {
  const count = (status) => run.sites.filter((site) => site.status === status).length;
  return {
    id: run.id,
    status: run.status,
    source: run.source,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    total: run.sites.length,
    saved: count('saved'),
    failed: count('failed'),
    cancelled: count('cancelled'),
  };
}

// Sites a finished run never got to: cancelled if the run was cancelled,
// otherwise failed with `reason`
function settleUnfinishedSites(run, reason) {
  for (const site of run.sites) {
    if (site.status !== 'pending' && site.status !== 'capturing') continue;
    if (run.status === 'cancelled') {
      site.status = 'cancelled';
    } else {
      site.status = 'failed';
      site.error = reason;
    }
  }
}

class RunInProgressError extends Error {
  constructor(runId, message = 'A capture is already running') {
    super(message);
    this.runId = runId;
  }
}

// A retry request that doesn't fit the run (wrong site, nothing failed)
class InvalidRetryError extends Error {}

// Runs web-UI captures one at a time. Each run gets its own folder under
// outputDir holding the screenshots and a run.json record that is rewritten as
// progress arrives, so history survives server restarts. Emits 'update' (run)
// on every change and 'end' (run) once a run finishes.
class RunManager extends EventEmitter {
  constructor({ outputDir, capture = captureSites }) {
    super();
    this.setMaxListeners(100); // one pair per open browser tab
    this.outputDir = path.resolve(outputDir);
    this.capture = capture;
    this.active = null;
  }

  start({ sites, skipped = [], options, source }) {
    if (this.active) throw new RunInProgressError(this.active.run.id);

    const { id } = this.createRunDir();

    const run = {
      id,
      status: 'running',
      source,
      options,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      cancelRequested: false,
      error: null,
      skipped,
      sites: sites.map((site) => ({
        name: site.name,
        url: site.url,
        status: 'pending',
        file: null,
        error: null,
        durationMs: null,
      })),
    };
    this.execute(run, run.sites.map((site, index) => index));
    return run;
  }

  // Capture some of a finished run's sites again, into the same folder. With
  // no `indexes`, retries every site that failed or was cancelled.
  retry(id, indexes) {
    if (this.active) throw new RunInProgressError(this.active.run.id);
    const run = this.get(id);
    if (!run) return null;

    const retryable = (site) => site.status === 'failed' || site.status === 'cancelled';
    const chosen = indexes === undefined
      ? run.sites.flatMap((site, index) => (retryable(site) ? [index] : []))
      : [...new Set(indexes)];
    if (chosen.length === 0) throw new InvalidRetryError('There are no failed sites to retry');
    for (const index of chosen) {
      const site = run.sites[index];
      if (!site) throw new InvalidRetryError(`This run has no site number ${index}`);
      if (!retryable(site)) throw new InvalidRetryError(`"${site.name}" doesn't need a retry (it's ${site.status})`);
    }

    for (const index of chosen) {
      Object.assign(run.sites[index], { status: 'pending', file: null, error: null, durationMs: null });
    }
    Object.assign(run, { status: 'running', finishedAt: null, cancelRequested: false, error: null });
    this.execute(run, chosen);
    return run;
  }

  // Capture run.sites at `indexes` in the run's folder, mapping progress events
  // back onto those sites, then finish the run
  execute(run, indexes) {
    const controller = new AbortController();
    this.active = { run, controller };
    this.save(run);
    this.emit('update', run);

    const sites = indexes.map((index) => ({ name: run.sites[index].name, url: run.sites[index].url }));
    // Screenshots already in the folder keep their names
    const reservedFilenames = run.sites
      .filter((site) => site.status === 'saved' && site.file)
      .map((site) => site.file);
    const onEvent = (event) => this.applyEvent(run, { ...event, index: indexes[event.index] });

    Promise.resolve()
      .then(() => this.capture(sites, {
        ...run.options,
        outputDir: path.join(this.outputDir, run.id),
        signal: controller.signal,
        reservedFilenames,
        onEvent,
      }))
      .then((summary) => {
        run.status = summary.cancelled ? 'cancelled' : 'completed';
      })
      .catch((error) => {
        run.status = controller.signal.aborted ? 'cancelled' : 'error';
        run.error = error.message;
      })
      .finally(() => this.finish(run))
      .catch((error) => console.error(`Run ${run.id} listener failed:`, error));
  }

  // Create the run's folder exclusively, so two runs can never share one even
  // if they start in the same second with the same random suffix
  createRunDir() {
    fs.mkdirSync(this.outputDir, { recursive: true });
    for (let attempt = 0; ; attempt += 1) {
      const id = createRunId();
      const runDir = path.join(this.outputDir, id);
      try {
        fs.mkdirSync(runDir);
        return { id, runDir };
      } catch (error) {
        if (error.code !== 'EEXIST' || attempt >= 5) throw error;
      }
    }
  }

  applyEvent(run, event) {
    const site = run.sites[event.index];
    if (!site) return;
    switch (event.type) {
      case 'site-start':
        site.status = 'capturing';
        break;
      case 'site-done':
        Object.assign(site, { status: 'saved', file: event.file, durationMs: event.durationMs });
        break;
      case 'site-failed':
      case 'site-cancelled':
        Object.assign(site, { status: event.status, error: event.error, durationMs: event.durationMs });
        break;
      default:
        return;
    }
    this.save(run);
    this.emit('update', run);
  }

  finish(run) {
    settleUnfinishedSites(run, run.error || 'Not captured');
    // A run is only complete once no site is left cancelled; retrying some of
    // a cancelled run's sites leaves the rest still to do
    if (run.status === 'completed' && run.sites.some((site) => site.status === 'cancelled')) {
      run.status = 'cancelled';
    }
    run.finishedAt = new Date().toISOString();
    this.active = null;
    this.save(run);
    this.emit('update', run);
    this.emit('end', run);
  }

  cancel(id) {
    if (!this.active || this.active.run.id !== id) return false;
    const { run, controller } = this.active;
    run.cancelRequested = true;
    controller.abort();
    this.save(run);
    this.emit('update', run);
    return true;
  }

  // Remove a run's folder, screenshots and all. Returns false if there is no
  // such run, and refuses the run being captured.
  delete(id) {
    if (!isValidRunId(id)) return false;
    if (this.active && this.active.run.id === id) {
      throw new RunInProgressError(id, 'This run is still capturing. Cancel it or let it finish first.');
    }
    // A folder shaped like a run but without a readable run.json isn't in the
    // history, so it isn't ours to remove
    if (!this.get(id)) return false;
    // Synchronous, so a retry can't start on this run while it's being removed
    fs.rmSync(path.join(this.outputDir, id), { recursive: true });
    return true;
  }

  get(id) {
    if (!isValidRunId(id)) return null;
    if (this.active && this.active.run.id === id) return this.active.run;

    let run;
    try {
      run = JSON.parse(fs.readFileSync(path.join(this.outputDir, id, MANIFEST_FILE), 'utf8'));
    } catch {
      return null;
    }
    // A hand-edited or truncated record shouldn't break the history list
    if (!run || !Array.isArray(run.sites)) return null;
    // Marked running on disk but not running here: the server stopped mid-run
    if (run.status === 'running') {
      run.status = 'interrupted';
      settleUnfinishedSites(run, 'The server stopped before this site was captured');
    }
    return run;
  }

  list() {
    let entries;
    try {
      entries = fs.readdirSync(this.outputDir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.isDirectory() && isValidRunId(entry.name))
      .map((entry) => this.get(entry.name))
      .filter(Boolean)
      .map(summarize)
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  // Write to a temporary file and rename it into place, so a crash mid-write
  // leaves the previous run.json intact instead of a truncated one
  save(run) {
    const file = path.join(this.outputDir, run.id, MANIFEST_FILE);
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(run, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    } catch (error) {
      console.error(`Could not save run ${run.id}:`, error.message);
    }
  }
}

module.exports = { RunManager, RunInProgressError, InvalidRetryError, isValidRunId, createRunId };
