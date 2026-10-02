# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — web app at http://localhost:5055 (bound to 127.0.0.1 only)
- `npm run capture` — CLI mode: reads URLs from `CSV_FILE` (default `websites.csv`) and writes to `OUTPUT_DIR`
- `npm test` — whole suite (`node --test`, no extra framework, no lint/build step)
- Single file: `node --test test/runs.test.js`; single test: `node --test --test-name-pattern="<name>" test/runs.test.js`

Config comes from `.env` (see `.env.example`), read by `src/config.js`. Node >= 18; CI runs Node 22 and 24.

## Architecture

Plain CommonJS Node app, no bundler. Express 5 backend, vanilla-JS frontend, Puppeteer for capture.

- `src/capture.js` — `captureSites(sites, options)`: the single Puppeteer routine, shared by CLI and web. Captures sequentially, reports progress via `onEvent`, and a failing site is recorded rather than aborting the run. Aborting `signal` closes the browser. `launch` is injectable (tests pass a fake). Pages use a fixed 900px viewport height with `fullPage` screenshots.
- `src/runs.js` — `RunManager`: runs one web capture at a time (throws `RunInProgressError` otherwise). Each run lives in `screenshots/<run-id>/` with a `run.json` manifest rewritten (tmp file + rename) on every event; the manifest *is* the history store, so there is no database. `run.json` marked `running` but not active in-process is reported as `interrupted`. `retry()` re-captures failed/cancelled sites into the same folder, mapping events back to original site indexes and reserving existing filenames. Emits `update`/`end`.
- `server.js` — `createApp({ config, runs })` (exported for tests; listens only under `require.main`). Serves `public/`, `/screenshots`, and the JSON API under `/api`. Live progress is Server-Sent Events at `/api/runs/:id/events`. Security is deliberate: Host-header check against DNS rebinding, POSTs must be JSON from a localhost origin (no CORS), run IDs validated by regex before touching the filesystem.
- `src/sites.js` (URL list / CSV parsing, `InputError`), `src/filenames.js` (unique filename allocation), `src/config.js` (defaults, `LIMITS`, `MAX_SITES_PER_RUN`, per-run option validation) — pure helpers.
- `public/` — static frontend. `app.js` builds DOM through its `h()` helper (text only, never innerHTML) and follows a run through the SSE stream; `url-list.js` is browser-side URL-list logic that is also unit-tested from Node.
- `screenshot.js` — thin CLI wrapper over `captureSites`.

## Testing notes

- `test/helpers.js` provides `makeTempDir`, `createFakeLaunch` (fake Puppeteer), and `listen`/`request`/`waitFor` for server tests. Most tests use fakes.
- `test/browser.test.js` drives real headless Chrome against local fixture pages (needs Puppeteer's Chrome; slower).

## Conventions

- Commits follow conventional-commit style (`feat:`, `fix:`, `ci:`) with PR number suffix, e.g. `fix: ... (#51)`.
- `screenshots/`, `.env`, and `websites.csv` are user data; `websites.example.csv` is the tracked template.
