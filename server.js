const http = require('http');
const path = require('path');
const express = require('express');
const { loadConfig, runDefaults, validateRunOptions, LIMITS, MAX_SITES_PER_RUN } = require('./src/config');
const { parseUrlList, parseCsv, InputError } = require('./src/sites');
const { RunManager, RunInProgressError, InvalidRetryError } = require('./src/runs');

const LOCAL_HOST_HEADER = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocalOrigin(origin) {
  if (!origin) return true; // same-origin requests and non-browser clients
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function describeSource(type, filename) {
  if (type === 'csv' && typeof filename === 'string' && filename.trim()) {
    return { type, filename: filename.trim().slice(0, 200) };
  }
  return { type };
}

function createApp({ config, runs }) {
  const defaults = runDefaults(config);
  const app = express();
  app.disable('x-powered-by');

  // Only answer requests addressed to this machine by name. This blocks DNS
  // rebinding, where a web page points its own hostname at 127.0.0.1.
  app.use((req, res, next) => {
    if (LOCAL_HOST_HEADER.test(req.headers.host || '')) return next();
    res.status(403).type('text').send('ScreenShooter only accepts requests to localhost');
  });

  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/screenshots', express.static(runs.outputDir, { index: false }));

  const api = express.Router();

  // Requests that change state must come from a localhost page, and POSTs
  // must be JSON. Browsers won't send cross-site JSON or a DELETE without a
  // CORS preflight, which this server never approves. A DELETE has no body.
  api.use((req, res, next) => {
    if (req.method !== 'POST' && req.method !== 'DELETE') return next();
    if (!isLocalOrigin(req.headers.origin)) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    }
    if (req.method === 'POST' && !req.is('application/json')) {
      return res.status(415).json({ error: 'Expected a JSON request body' });
    }
    next();
  });
  // Room for a 5 MB CSV (the UI's limit) once it's escaped into JSON
  api.use(express.json({ limit: '10mb' }));
  // Every POST takes a JSON object. An array or an empty body would otherwise
  // read as "no fields given", which for a retry means "retry everything".
  api.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Expected a JSON object' });
    }
    next();
  });

  api.get('/config', (req, res) => {
    res.json({ defaults, limits: LIMITS });
  });

  api.get('/runs', (req, res) => {
    res.json({ runs: runs.list(), activeRunId: runs.active ? runs.active.run.id : null });
  });

  api.post('/runs', async (req, res) => {
    const { source, text, filename, options } = req.body;
    if (source !== 'urls' && source !== 'csv') {
      return res.status(400).json({ error: 'source must be "urls" or "csv"' });
    }
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'text must be a string' });
    }

    const { options: runOptions, errors } = validateRunOptions(options, defaults);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('. ') });
    }

    let parsed;
    try {
      parsed = source === 'csv' ? await parseCsv(text) : parseUrlList(text);
    } catch (error) {
      if (error instanceof InputError) return res.status(400).json({ error: error.message });
      throw error;
    }
    if (parsed.sites.length === 0) {
      return res.status(400).json({ error: 'No valid URLs found', skipped: parsed.skipped });
    }
    if (parsed.sites.length > MAX_SITES_PER_RUN) {
      const count = parsed.sites.length.toLocaleString('en-US');
      const max = MAX_SITES_PER_RUN.toLocaleString('en-US');
      return res.status(400).json({
        error: `That's ${count} sites. The web app captures up to ${max} per run, so split the list or use the command line (npm run capture) for bigger batches.`,
      });
    }

    try {
      const run = runs.start({
        sites: parsed.sites,
        skipped: parsed.skipped,
        options: runOptions,
        source: describeSource(source, filename),
      });
      res.status(202).json({ run });
    } catch (error) {
      if (error instanceof RunInProgressError) {
        return res.status(409).json({ error: error.message, activeRunId: error.runId });
      }
      throw error;
    }
  });

  api.get('/runs/:id', (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json({ run });
  });

  // Capture failed or cancelled sites of a finished run again. `sites` lists
  // their positions in the run; leave it out to retry all of them.
  api.post('/runs/:id/retry', (req, res) => {
    const { sites } = req.body;
    if (sites !== undefined && !(Array.isArray(sites) && sites.every(Number.isInteger))) {
      return res.status(400).json({ error: 'sites must be a list of site numbers' });
    }
    try {
      const run = runs.retry(req.params.id, sites);
      if (!run) return res.status(404).json({ error: 'Run not found' });
      res.status(202).json({ run });
    } catch (error) {
      if (error instanceof RunInProgressError) {
        return res.status(409).json({ error: error.message, activeRunId: error.runId });
      }
      if (error instanceof InvalidRetryError) return res.status(400).json({ error: error.message });
      throw error;
    }
  });

  api.post('/runs/:id/cancel', (req, res) => {
    if (!runs.get(req.params.id)) return res.status(404).json({ error: 'Run not found' });
    if (!runs.cancel(req.params.id)) return res.status(409).json({ error: 'That run is not running' });
    res.status(202).json({ ok: true });
  });

  // Delete a finished run's folder and screenshots for good
  api.delete('/runs/:id', (req, res) => {
    try {
      if (!runs.delete(req.params.id)) return res.status(404).json({ error: 'Run not found' });
      res.status(204).end();
    } catch (error) {
      if (error instanceof RunInProgressError) {
        return res.status(409).json({ error: error.message, activeRunId: error.runId });
      }
      // run.json is removed last, so the run is still listed and can be deleted again
      console.error(`Could not delete run ${req.params.id}:`, error);
      res.status(500).json({ error: "Some of this run's files couldn't be removed. Close any that are open in another app, then try again." });
    }
  });

  // Live progress as Server-Sent Events: the full run on connect and after
  // every change, then an "end" event once the run finishes
  api.get('/runs/:id/events', (req, res) => {
    const { id } = req.params;
    const run = runs.get(id);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    send('run', run);
    if (run.status !== 'running') {
      send('end', {});
      return res.end();
    }

    const onUpdate = (updated) => {
      if (updated.id === id) send('run', updated);
    };
    const onEnd = (ended) => {
      if (ended.id !== id) return;
      send('end', {});
      stop();
      res.end();
    };
    const stop = () => {
      runs.off('update', onUpdate);
      runs.off('end', onEnd);
    };
    runs.on('update', onUpdate);
    runs.on('end', onEnd);
    res.on('close', stop); // the browser closed the tab or navigated away
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));

  api.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body is not valid JSON' });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large' });
    }
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  });

  app.use('/api', api);
  return app;
}

if (require.main === module) {
  require('dotenv').config();
  const config = loadConfig();
  const runs = new RunManager({ outputDir: config.outputDir });

  const defaults = runDefaults(config);
  for (const [key, envVar] of [['width', 'SCREENSHOT_WIDTH'], ['timeout', 'TIMEOUT']]) {
    if (defaults[key] !== config[key]) {
      console.warn(`${envVar}=${config[key]} is outside the web app's range, so web runs will default to ${defaults[key]}.`);
    }
  }
  const server = http.createServer(createApp({ config, runs }));

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Set PORT in .env to use another port.`);
      process.exit(1);
    }
    throw error;
  });

  // Bound to 127.0.0.1 so other devices on your network can't reach it
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`ScreenShooter is running at http://localhost:${config.port}`);
    console.log(`Screenshots are saved under ${runs.outputDir}`);
  });
}

module.exports = { createApp };
