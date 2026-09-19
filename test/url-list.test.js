const test = require('node:test');
const assert = require('node:assert/strict');
const { formatUrlList } = require('../public/url-list');
const { deriveName, parseUrlList, parseCsv } = require('../src/sites');

test('formatUrlList writes pasted sites back as lines that read the same', () => {
  const { sites } = parseUrlList([
    'github.com',
    'React, https://react.dev',
    'Ruby on Rails\thttps://rubyonrails.org/',
    'Acme, Inc, acme.com',
    'Next.js https://nextjs.org/',
    'https://example.com/?ids=1,2',
    'localhost:3000',
    'Docs, example.com/a?b=1, docs.example.com',
  ].join('\n'));
  const { text, renamed } = formatUrlList(sites);
  assert.deepEqual(renamed, []);
  assert.deepEqual(parseUrlList(text), { sites, skipped: [] });
});

test('formatUrlList writes only the URL when the name is the one it would get anyway', () => {
  const { sites } = parseUrlList('github.com\nwww.github.com/features/actions/\nlocalhost:3000\ngithub.com, https://github.com');
  assert.equal(formatUrlList(sites).text, [
    'https://github.com/',
    'https://www.github.com/features/actions/',
    'http://localhost:3000/',
    'https://github.com/',
  ].join('\n'));
});

test('formatUrlList keeps names with commas, tabs and other characters', () => {
  const sites = [
    { name: 'Acme, Inc', url: 'https://acme.com/' },
    { name: 'A, B, C', url: 'https://abc.com/' },
    { name: ', leading comma', url: 'https://abc.com/' },
    { name: 'Foo ,Bar', url: 'https://abc.com/' },
    { name: 'Tab\tinside', url: 'https://abc.com/' },
    { name: 'C# docs', url: 'https://learn.microsoft.com/dotnet/csharp/' },
    { name: 'react.dev', url: 'https://nextjs.org/' },
    { name: 'mailto:hi', url: 'https://abc.com/' },
    { name: 'Café 😀 “quoted”', url: 'https://abc.com/x?y=1#frag' },
  ];
  const { text, renamed } = formatUrlList(sites);
  assert.deepEqual(renamed, []);
  assert.deepEqual(parseUrlList(text), { sites, skipped: [] });
});

test('formatUrlList falls back to the URL for names a line can’t hold', async () => {
  // All of these can come from a CSV
  const { sites } = await parseCsv([
    'name,url',
    '"Two\nlines",https://a.com',
    '"Trailing,",https://b.com',
    '#1 Pick,https://c.com',
    'Moved to https://d.com,https://d.com',
    'Maps,"https://www.google.com/maps/@37.7,-122.4,12z"',
    'Kept,https://e.com',
  ].join('\n'));
  const { text, renamed } = formatUrlList(sites);
  assert.deepEqual(renamed.map((site) => site.name), ['Two\nlines', 'Trailing,', '#1 Pick', 'Moved to https://d.com', 'Maps']);

  const readBack = parseUrlList(text);
  assert.deepEqual(readBack.skipped, []);
  assert.deepEqual(readBack.sites, [
    { name: 'a.com', url: 'https://a.com/' },
    { name: 'b.com', url: 'https://b.com/' },
    { name: 'c.com', url: 'https://c.com/' },
    { name: 'd.com', url: 'https://d.com/' },
    { name: 'google.com/maps/@37.7,-122.4,12z', url: 'https://www.google.com/maps/@37.7,-122.4,12z' },
    { name: 'Kept', url: 'https://e.com/' },
  ]);
});

// Every pairing of awkward names and URLs: each line reads back as its site,
// or, for a site reported as renamed, as its URL with the URL's own name
test('formatUrlList lines always read back as the same URLs, and the same names unless reported', () => {
  const names = [
    'Acme', 'Acme, Inc', 'A,B', 'a  b   c', 'Tab\there', 'x', '1', ', x', 'C# docs', 'http', 'a:b',
    'github.com', 'www.github.com', 'localhost:3000', 'react.dev', 'Émoji 😀', 'Ends with.',
    'Name,', 'Name ,', '#hash', 'see https://x.com', 'Two\nlines', 'Carriage\rreturn', 'Line\u2028separator',
  ];
  const urls = [
    'https://github.com/', 'https://www.github.com/', 'https://github.com/features/actions/',
    'http://localhost:3000/', 'http://[::1]:5173/app', 'https://example.com/?ids=1,2',
    'https://example.com/a,b', 'https://example.com/path#frag', 'https://xn--caf-dma.com/',
    'https://example.com/with%20space',
  ];
  const sites = names.flatMap((name) => urls.map((url) => ({ name, url })));

  const { text, renamed } = formatUrlList(sites);
  const readBack = parseUrlList(text);
  assert.deepEqual(readBack.skipped, []);
  assert.equal(readBack.sites.length, sites.length);
  sites.forEach((site, index) => {
    const expected = renamed.includes(site) ? { name: deriveName(site.url), url: site.url } : site;
    assert.deepEqual(readBack.sites[index], expected, JSON.stringify(site));
  });
  // Only names that can't be written, or named sites with commas in the URL
  for (const site of renamed) {
    assert.ok(/^#|,$|:\/\/|[\r\n\u2028]/.test(site.name) || site.url.includes(','), JSON.stringify(site));
  }
});
