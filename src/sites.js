const fs = require('fs');
const { Readable } = require('stream');
const csv = require('csv-parser');

// An error caused by the user's input (bad CSV, missing file) rather than a bug
class InputError extends Error {}

// Hosts that usually serve plain http: loopback, private networks, dev TLDs
const LOCAL_HOSTNAME = /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|\[::1\])$|\.(localhost|test|local)$/i;

// A leading "scheme:" — but not "host:port" such as localhost:3000
const SCHEME_PREFIX = /^([a-z][a-z0-9+.-]*):(?!\d)/i;

// Turn user input into an absolute http(s) URL, or explain why it can't be one.
// Bare hosts get a scheme added: http for local addresses, https otherwise.
function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, reason: 'Missing URL' };

  let candidate = raw;
  const scheme = raw.match(SCHEME_PREFIX);
  if (scheme) {
    const protocol = scheme[1].toLowerCase();
    if (protocol !== 'http' && protocol !== 'https') {
      return { ok: false, reason: `Unsupported URL scheme "${protocol}:" (only http and https)` };
    }
  } else {
    // Without a scheme, require something host-like so stray words aren't
    // treated as hostnames
    const host = raw.split(/[/?#]/, 1)[0];
    if (!/[.:]/.test(host) && host.toLowerCase() !== 'localhost') {
      return { ok: false, reason: 'Not a valid URL' };
    }
    const hostname = host.replace(/:\d+$/, '');
    candidate = `${LOCAL_HOSTNAME.test(hostname) ? 'http' : 'https'}://${raw}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: 'Not a valid URL' };
  }
  if (!url.hostname) return { ok: false, reason: 'Not a valid URL' };
  return { ok: true, url: url.href };
}

// Readable name for a URL without one, e.g. "github.com/features/actions"
function deriveName(href) {
  const url = new URL(href);
  const host = url.host.replace(/^www\./, '');
  return `${host}${url.pathname.replace(/\/+$/, '')}`;
}

function toSite(name, url) {
  const result = normalizeUrl(url);
  if (!result.ok) return result;
  const cleanName = String(name ?? '').trim();
  return { ok: true, site: { name: cleanName || deriveName(result.url), url: result.url } };
}

// A pasted line is either "url" or "name, url" (comma, tab or space separated).
// Only split when the tail is a usable URL and the head isn't itself a URL, so
// commas inside URLs survive.
function splitNameAndUrl(line) {
  const match = line.match(/^(.*[^\s,])(?:\s*[,\t]\s*|\s+)(\S+)$/);
  if (match && !match[1].includes('://') && normalizeUrl(match[2]).ok) {
    return { name: match[1], url: match[2] };
  }
  return { name: '', url: line };
}

// Parse the web UI's pasted list: one site per line; blank lines and lines
// starting with # are ignored.
function parseUrlList(text) {
  const sites = [];
  const skipped = [];
  String(text ?? '').split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const { name, url } = splitNameAndUrl(line);
    const result = toSite(name, url);
    if (result.ok) {
      sites.push(result.site);
    } else {
      skipped.push({ where: `Line ${index + 1}`, input: line, reason: result.reason });
    }
  });
  return { sites, skipped };
}

// Parse CSV text with a "url" column and an optional "name" column. Headers are
// matched case-insensitively and a leading byte-order mark is ignored.
function parseCsv(text) {
  return new Promise((resolve, reject) => {
    const sites = [];
    const skipped = [];
    let headers = null;
    let rowNumber = 0;

    Readable.from([String(text ?? '')])
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim().toLowerCase() }))
      .on('headers', (parsed) => { headers = parsed; })
      .on('data', (row) => {
        rowNumber += 1;
        const name = (row.name ?? '').trim();
        const url = (row.url ?? '').trim();
        if (!name && !url) return;
        const result = toSite(name, url);
        if (result.ok) {
          sites.push(result.site);
        } else {
          skipped.push({ where: `Row ${rowNumber}`, input: [name, url].filter(Boolean).join(', '), reason: result.reason });
        }
      })
      .on('end', () => {
        if (headers && !headers.includes('url')) {
          reject(new InputError(`CSV needs a "url" column (found: ${headers.join(', ')})`));
          return;
        }
        resolve({ sites, skipped });
      })
      .on('error', reject);
  });
}

async function readSitesFromCsvFile(filePath) {
  let text;
  try {
    text = await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new InputError(`CSV file not found: ${filePath} (copy websites.example.csv to get started, or set CSV_FILE in .env)`);
    }
    throw error;
  }
  return parseCsv(text);
}

module.exports = { InputError, normalizeUrl, deriveName, parseUrlList, parseCsv, readSitesFromCsvFile };
