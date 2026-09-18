const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizeUrl, deriveName, parseUrlList, parseCsv, readSitesFromCsvFile, InputError } = require('../src/sites');
const { makeTempDir } = require('./helpers');

test('normalizeUrl accepts http and https URLs', () => {
  assert.deepEqual(normalizeUrl('https://github.com/'), { ok: true, url: 'https://github.com/' });
  assert.deepEqual(normalizeUrl('  HTTP://Example.com/Path '), { ok: true, url: 'http://example.com/Path' });
});

test('normalizeUrl adds https to bare domains', () => {
  assert.equal(normalizeUrl('github.com').url, 'https://github.com/');
  assert.equal(normalizeUrl('github.com/features/actions').url, 'https://github.com/features/actions');
  assert.equal(normalizeUrl('example.com:8443/x').url, 'https://example.com:8443/x');
});

test('normalizeUrl adds http to local addresses', () => {
  assert.equal(normalizeUrl('localhost').url, 'http://localhost/');
  assert.equal(normalizeUrl('localhost:3000').url, 'http://localhost:3000/');
  assert.equal(normalizeUrl('127.0.0.1:8080/app').url, 'http://127.0.0.1:8080/app');
  assert.equal(normalizeUrl('192.168.1.20').url, 'http://192.168.1.20/');
  assert.equal(normalizeUrl('[::1]:5173').url, 'http://[::1]:5173/');
  assert.equal(normalizeUrl('myapp.test').url, 'http://myapp.test/');
  assert.equal(normalizeUrl('172.32.0.1').url, 'https://172.32.0.1/'); // outside the private range
});

test('normalizeUrl rejects other schemes', () => {
  for (const input of [
    'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'ftp://example.com',
    'mailto:a@b.com', 'about:blank',
    // schemes followed by digits must not pass as host:port
    'mailto:123@example.com', 'javascript:1', 'tel:5551234',
  ]) {
    const result = normalizeUrl(input);
    assert.equal(result.ok, false, input);
    assert.match(result.reason, /Unsupported URL scheme/, input);
  }
});

test('normalizeUrl rejects blanks and non-URLs', () => {
  assert.deepEqual(normalizeUrl(''), { ok: false, reason: 'Missing URL' });
  assert.deepEqual(normalizeUrl('   '), { ok: false, reason: 'Missing URL' });
  assert.deepEqual(normalizeUrl(undefined), { ok: false, reason: 'Missing URL' });
  assert.equal(normalizeUrl('hello').ok, false);
  assert.equal(normalizeUrl('2').ok, false);
  assert.equal(normalizeUrl('https://').ok, false);
  assert.equal(normalizeUrl('exa mple.com').ok, false);
});

test('deriveName builds a readable name from host and path', () => {
  assert.equal(deriveName('https://www.github.com/'), 'github.com');
  assert.equal(deriveName('https://github.com/features/actions/'), 'github.com/features/actions');
  assert.equal(deriveName('http://localhost:3000/'), 'localhost:3000');
});

test('parseUrlList reads bare URLs and "name, url" lines', () => {
  const { sites, skipped } = parseUrlList([
    'github.com',
    'React, https://react.dev',
    'Ruby on Rails\thttps://rubyonrails.org/',
    'Acme, Inc, acme.com',
    'Next.js https://nextjs.org/',
  ].join('\n'));
  assert.deepEqual(skipped, []);
  assert.deepEqual(sites, [
    { name: 'github.com', url: 'https://github.com/' },
    { name: 'React', url: 'https://react.dev/' },
    { name: 'Ruby on Rails', url: 'https://rubyonrails.org/' },
    { name: 'Acme, Inc', url: 'https://acme.com/' },
    { name: 'Next.js', url: 'https://nextjs.org/' },
  ]);
});

test('parseUrlList keeps commas that belong to the URL', () => {
  const { sites } = parseUrlList('https://example.com/?ids=1,2\nexample.org/?a=1,2');
  assert.deepEqual(sites.map((s) => s.url), ['https://example.com/?ids=1,2', 'https://example.org/?a=1,2']);
});

test('parseUrlList ignores blank and comment lines and reports bad ones', () => {
  const { sites, skipped } = parseUrlList('\n# my list\n  \ngithub.com\r\nnot a url\njavascript:alert(1)\n');
  assert.equal(sites.length, 1);
  assert.deepEqual(skipped, [
    { where: 'Line 5', input: 'not a url', reason: 'Not a valid URL' },
    { where: 'Line 6', input: 'javascript:alert(1)', reason: 'Unsupported URL scheme "javascript:" (only http and https)' },
  ]);
});

test('parseCsv reads name and url columns', async () => {
  const { sites, skipped } = await parseCsv('name,url\nVS Code,https://code.visualstudio.com/\nGitHub,https://github.com/\n');
  assert.deepEqual(skipped, []);
  assert.deepEqual(sites, [
    { name: 'VS Code', url: 'https://code.visualstudio.com/' },
    { name: 'GitHub', url: 'https://github.com/' },
  ]);
});

test('parseCsv ignores a byte-order mark and header case', async () => {
  const { sites } = await parseCsv('﻿Name, URL\nGitHub,github.com\n');
  assert.deepEqual(sites, [{ name: 'GitHub', url: 'https://github.com/' }]);
});

test('parseCsv names rows that have no name and reports rows it skips', async () => {
  const { sites, skipped } = await parseCsv('name,url\n,https://react.dev\nNo URL,\n,\nBad,file:///etc/passwd\n');
  assert.deepEqual(sites, [{ name: 'react.dev', url: 'https://react.dev/' }]);
  assert.deepEqual(skipped, [
    { where: 'Row 2', input: 'No URL', reason: 'Missing URL' },
    { where: 'Row 4', input: 'Bad, file:///etc/passwd', reason: 'Unsupported URL scheme "file:" (only http and https)' },
  ]);
});

test('parseCsv works with only a url column', async () => {
  const { sites } = await parseCsv('url\nhttps://github.com/\n');
  assert.deepEqual(sites, [{ name: 'github.com', url: 'https://github.com/' }]);
});

test('parseCsv rejects a CSV without a url column', async () => {
  await assert.rejects(parseCsv('site,link\nGitHub,https://github.com\n'), (error) => {
    assert.ok(error instanceof InputError);
    assert.match(error.message, /needs a "url" column \(found: site, link\)/);
    return true;
  });
});

test('parseCsv returns nothing for empty input', async () => {
  assert.deepEqual(await parseCsv(''), { sites: [], skipped: [] });
});

test('readSitesFromCsvFile explains a missing file', async (t) => {
  const dir = makeTempDir(t);
  await assert.rejects(readSitesFromCsvFile(path.join(dir, 'nope.csv')), (error) => {
    assert.ok(error instanceof InputError);
    assert.match(error.message, /CSV file not found/);
    return true;
  });
});

test('readSitesFromCsvFile reads the bundled example', async () => {
  const example = path.join(__dirname, '..', 'websites.example.csv');
  const rows = fs.readFileSync(example, 'utf8').trim().split('\n').length - 1;
  const { sites, skipped } = await readSitesFromCsvFile(example);
  assert.equal(sites.length, rows);
  assert.deepEqual(skipped, []);
});
