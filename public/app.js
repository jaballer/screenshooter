'use strict';

const MAX_CSV_BYTES = 5 * 1024 * 1024;

const state = {
  runs: [],
  currentRunId: null,
  stream: null,
  source: 'urls',
  csv: null,
};

const $ = (selector) => document.querySelector(selector);

// Build DOM nodes. Children are appended as text, never parsed as HTML, so
// site names and error messages can't inject markup.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

// Formatting

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function sourceLabel(source) {
  if (source?.type === 'csv') return source.filename || 'CSV upload';
  return 'Pasted URLs';
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function displayUrl(href) {
  try {
    const url = new URL(href);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return href;
  }
}

function screenshotUrl(runId, file) {
  return `/screenshots/${encodeURIComponent(runId)}/${encodeURIComponent(file)}`;
}

function summarize(run) {
  const count = (status) => run.sites.filter((site) => site.status === status).length;
  return {
    id: run.id,
    status: run.status,
    source: run.source,
    startedAt: run.startedAt,
    total: run.sites.length,
    saved: count('saved'),
    failed: count('failed'),
  };
}

const RUN_STATUS_LABELS = {
  running: 'Capturing',
  completed: 'Done',
  cancelled: 'Cancelled',
  error: 'Error',
  interrupted: 'Interrupted',
};

const SITE_STATUS_LABELS = {
  pending: 'Waiting',
  capturing: 'Capturing',
  saved: 'Saved',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

// Views and routing (#/new, #/runs/<id>)

function showView(name) {
  for (const view of ['new-run', 'run', 'missing']) {
    $(`#${view}-view`).hidden = view !== name;
  }
  window.scrollTo(0, 0);
}

function closeStream() {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
}

function route() {
  const match = location.hash.match(/^#\/runs\/([\w-]+)$/);
  if (match) {
    showRun(match[1]);
  } else {
    showNewRun();
  }
}

function showNewRun() {
  closeStream();
  state.currentRunId = null;
  showView('new-run');
  renderRunList();
}

async function showRun(id) {
  closeStream();
  state.currentRunId = id;
  renderRunList();

  let run;
  try {
    ({ run } = await api(`/runs/${encodeURIComponent(id)}`));
  } catch {
    if (state.currentRunId === id) showView('missing');
    return;
  }
  if (state.currentRunId !== id) return; // navigated away while loading

  showView('run');
  renderRun(run);
  if (run.status === 'running') openStream(id);
}

function openStream(id) {
  const stream = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
  state.stream = stream;
  stream.addEventListener('run', (event) => {
    if (state.currentRunId !== id) return;
    const run = JSON.parse(event.data);
    renderRun(run);
    updateRunSummary(run);
  });
  stream.addEventListener('end', () => {
    if (state.stream === stream) closeStream();
  });
  // On a dropped connection EventSource reconnects by itself
}

// History sidebar

async function refreshRunList() {
  const { runs } = await api('/runs');
  state.runs = runs;
  renderRunList();
}

function updateRunSummary(run) {
  const summary = summarize(run);
  const index = state.runs.findIndex((item) => item.id === run.id);
  if (index === -1) state.runs.unshift(summary);
  else state.runs[index] = summary;
  renderRunList();
}

function renderRunList() {
  const list = $('#run-list');
  if (state.runs.length === 0) {
    list.replaceChildren(h('li', { class: 'empty' }, 'No captures yet'));
    return;
  }
  list.replaceChildren(...state.runs.map((run) => {
    const dotClass = run.status === 'completed' && run.failed > 0 ? 'has-failures' : run.status;
    const counts = run.status === 'running'
      ? `${run.saved + run.failed} of ${run.total}`
      : `${plural(run.saved, 'shot')}${run.failed ? ` · ${run.failed} failed` : ''}`;
    return h('li', {},
      h('a', { class: 'run-link', href: `#/runs/${run.id}`, 'aria-current': run.id === state.currentRunId ? 'page' : null },
        h('span', { class: `dot ${dotClass}`, title: RUN_STATUS_LABELS[run.status] || run.status }),
        h('span', { class: 'run-link-text' },
          h('span', { class: 'run-link-title' }, sourceLabel(run.source)),
          h('span', { class: 'run-link-meta' }, `${formatDate(run.startedAt)} · ${counts}`))));
  }));
}

// Run view

function renderRun(run) {
  const done = run.sites.filter((site) => !['pending', 'capturing'].includes(site.status)).length;
  const saved = run.sites.filter((site) => site.status === 'saved').length;
  const failed = run.sites.filter((site) => site.status === 'failed').length;
  const running = run.status === 'running';

  $('#run-title').textContent = sourceLabel(run.source);
  $('#run-meta').textContent = [
    formatDate(run.startedAt),
    plural(run.sites.length, 'site'),
    `${run.options.width}px wide`,
    run.options.headless ? 'headless' : 'browser visible',
  ].join(' · ');

  const status = $('#run-status');
  status.textContent = RUN_STATUS_LABELS[run.status] || run.status;
  status.className = `badge ${run.status}`;

  const cancel = $('#cancel-button');
  cancel.hidden = !running;
  cancel.disabled = Boolean(run.cancelRequested);
  cancel.textContent = run.cancelRequested ? 'Cancelling…' : 'Cancel';
  cancel.dataset.runId = run.id;

  $('#progress-bar').style.width = `${run.sites.length ? (done / run.sites.length) * 100 : 0}%`;
  $('#progress-text').textContent = running
    ? `${done} of ${run.sites.length} done · ${saved} saved${failed ? ` · ${failed} failed` : ''}`
    : `${saved} saved${failed ? ` · ${failed} failed` : ''}${run.finishedAt ? ` · finished ${formatDate(run.finishedAt)}` : ''}`;

  const runError = $('#run-error');
  runError.hidden = !run.error;
  runError.textContent = run.error ? `The run stopped: ${run.error}` : '';

  renderSkipped($('#skipped'), run.skipped);
  renderSites(run);
}

function renderSkipped(details, skipped = []) {
  details.hidden = skipped.length === 0;
  if (skipped.length === 0) return;
  details.querySelector('summary').textContent = `${skipped.length} ${skipped.length === 1 ? 'entry' : 'entries'} skipped`;
  details.querySelector('ul').replaceChildren(...skipped.map(skippedItem));
}

function skippedItem(entry) {
  return h('li', {}, `${entry.where}: ${entry.reason} — `, h('code', {}, entry.input));
}

// Update cards in place so finished screenshots don't reload on every event
function renderSites(run) {
  const grid = $('#site-grid');
  if (grid.dataset.runId !== run.id) {
    grid.replaceChildren();
    grid.dataset.runId = run.id;
  }
  run.sites.forEach((site, index) => {
    const key = [site.status, site.file, site.error].join('|');
    const existing = grid.children[index];
    if (existing && existing.dataset.key === key) return;
    const card = siteCard(run.id, site);
    card.dataset.key = key;
    if (existing) existing.replaceWith(card);
    else grid.append(card);
  });
}

function siteCard(runId, site) {
  let thumb;
  if (site.status === 'saved') {
    const src = screenshotUrl(runId, site.file);
    thumb = h('a', { class: 'thumb', href: src, target: '_blank', rel: 'noopener', title: 'Open full-size screenshot' },
      h('img', { src, alt: `Screenshot of ${site.name}`, loading: 'lazy' }));
  } else {
    const label = {
      pending: 'Waiting…',
      capturing: 'Capturing…',
      failed: 'Couldn’t capture',
      cancelled: 'Cancelled',
    }[site.status];
    thumb = h('div', { class: 'thumb placeholder' },
      h('span', {}, site.status === 'capturing' && h('span', { class: 'spinner', 'aria-hidden': 'true' }), label));
  }

  const safeHref = /^https?:\/\//i.test(site.url) ? site.url : null;
  return h('li', { class: 'card', dataset: { status: site.status } },
    thumb,
    h('div', { class: 'card-body' },
      h('div', { class: 'card-title-row' },
        h('p', { class: 'card-title', title: site.name }, site.name),
        h('span', { class: `pill ${site.status}` }, SITE_STATUS_LABELS[site.status] || site.status)),
      h('a', { class: 'card-url', href: safeHref, target: '_blank', rel: 'noopener noreferrer', title: site.url }, displayUrl(site.url)),
      site.error && h('p', { class: 'card-error' }, site.error)));
}

// New capture form

function setSource(source) {
  state.source = source;
  for (const tab of document.querySelectorAll('[data-source]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.source === source));
  }
  $('#panel-urls').hidden = source !== 'urls';
  $('#panel-csv').hidden = source !== 'csv';
  hideFormError();
}

async function loadCsvFile(file) {
  if (!file) return;
  hideFormError();
  if (file.size > MAX_CSV_BYTES) {
    state.csv = null;
    $('#csv-summary').hidden = true;
    showFormError(new Error('That file is larger than 5 MB.'));
    return;
  }
  const text = await file.text();
  state.csv = { name: file.name, text };
  const rows = text.split(/\r?\n/).filter((line) => line.trim()).length - 1;
  const summary = $('#csv-summary');
  summary.textContent = `${file.name} · ${plural(Math.max(rows, 0), 'row')}`;
  summary.hidden = false;
}

function hideFormError() {
  $('#form-error').hidden = true;
}

function showFormError(error) {
  const box = $('#form-error');
  box.replaceChildren(h('p', {}, error.message));
  const skipped = error.data?.skipped;
  if (skipped?.length) {
    box.append(h('ul', {}, skipped.map(skippedItem)));
  }
  if (error.status === 409 && error.data?.activeRunId) {
    box.append(h('p', {}, h('a', { href: `#/runs/${error.data.activeRunId}` }, 'View the capture in progress')));
  }
  box.hidden = false;
}

async function startCapture(event) {
  event.preventDefault();
  hideFormError();

  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const text = state.source === 'urls' ? $('#urls').value : state.csv?.text;
  if (!text || !text.trim()) {
    showFormError(new Error(state.source === 'urls' ? 'Paste at least one URL.' : 'Choose a CSV file first.'));
    return;
  }

  const button = $('#start-button');
  button.disabled = true;
  button.textContent = 'Starting…';
  try {
    const { run } = await api('/runs', {
      method: 'POST',
      body: {
        source: state.source,
        text,
        filename: state.source === 'csv' ? state.csv.name : undefined,
        options: {
          width: Number($('#width').value),
          timeout: Math.round(Number($('#timeout').value) * 1000),
          headless: $('#headless').checked,
        },
      },
    });
    updateRunSummary(run);
    location.hash = `#/runs/${run.id}`;
  } catch (error) {
    showFormError(error);
  } finally {
    button.disabled = false;
    button.textContent = 'Start capture';
  }
}

async function cancelRun() {
  const button = $('#cancel-button');
  button.disabled = true;
  button.textContent = 'Cancelling…';
  try {
    await api(`/runs/${encodeURIComponent(button.dataset.runId)}/cancel`, { method: 'POST', body: {} });
  } catch {
    // The run most likely finished on its own; the stream will say so
  }
}

function bindForm({ defaults, limits }) {
  const width = $('#width');
  width.min = limits.width.min;
  width.max = limits.width.max;
  width.value = defaults.width;

  const timeout = $('#timeout');
  timeout.min = limits.timeout.min / 1000;
  timeout.max = limits.timeout.max / 1000;
  timeout.value = Math.round(defaults.timeout / 1000);

  $('#headless').checked = defaults.headless;

  for (const tab of document.querySelectorAll('[data-source]')) {
    tab.addEventListener('click', () => setSource(tab.dataset.source));
  }

  $('#csv-file').addEventListener('change', (event) => loadCsvFile(event.target.files[0]));

  const dropzone = $('#dropzone');
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('dragging');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragging');
    loadCsvFile(event.dataTransfer.files[0]);
  });

  $('#new-run-form').addEventListener('submit', startCapture);
  $('#cancel-button').addEventListener('click', cancelRun);
}

async function init() {
  const [config, { runs }] = await Promise.all([api('/config'), api('/runs')]);
  bindForm(config);
  state.runs = runs;
  window.addEventListener('hashchange', route);
  route();
}

init().catch((error) => {
  document.querySelector('main').replaceChildren(
    h('section', { class: 'view' },
      h('h1', {}, 'Couldn’t load ScreenShooter'),
      h('p', { class: 'muted' }, `${error.message}. Is the server still running?`)));
});

// Keep the history fresh when coming back to the tab
document.addEventListener('visibilitychange', () => {
  // Best effort: if the server is down, the list just stays as it was
  if (document.visibilityState === 'visible') refreshRunList().catch(() => {});
});
