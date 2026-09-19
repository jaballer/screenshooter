'use strict';

// Writes a run's sites back out as lines for the Paste URLs box, so "Run
// again" can fill in the form. It's the reverse of parseUrlList in
// src/sites.js, and test/url-list.test.js checks that the lines read back as
// the same sites. The page loads this as a plain script; the tests require() it.

// Same as deriveName in src/sites.js: the name a line with only a URL gets
function deriveName(href) {
  const url = new URL(href);
  const host = url.host.replace(/^www\./, '');
  return `${host}${url.pathname.replace(/\/+$/, '')}`;
}

// Whether "name, url" reads back as exactly this name and URL. The parser
// splits a line at its last comma, tab or space, and only if what comes
// before it isn't a URL.
function canWriteName(name, url) {
  return typeof name === 'string' && name !== '' && name === name.trim()
    && !url.includes(',') // the line would split inside the URL instead
    && !name.endsWith(',') // the comma would be taken as the separator
    && !name.startsWith('#') // the line would be a comment
    && !name.includes('://') // a URL in the name stops the line from being split
    && !/[\r\n\u2028\u2029]/.test(name); // it would break the line in two
}

// One line per site: just the URL when the name is the one the URL would get
// anyway, otherwise "Name, URL". Sites whose names can't be written come back
// in `renamed`; their lines hold only the URL, so they'll be named after it.
function formatUrlList(sites) {
  const renamed = [];
  const lines = sites.map((site) => {
    if (site.name === deriveName(site.url)) return site.url;
    if (canWriteName(site.name, site.url)) return `${site.name}, ${site.url}`;
    renamed.push(site);
    return site.url;
  });
  return { text: lines.join('\n'), renamed };
}

if (typeof module === 'object') module.exports = { formatUrlList };
