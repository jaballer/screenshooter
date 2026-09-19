const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshooter-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A stand-in for puppeteer.launch that records what happened. `goto` can be
// overridden per URL to simulate slow or failing sites.
function createFakeLaunch({ goto } = {}) {
  const state = { launchOptions: null, browserClosed: false, pagesOpened: 0, pagesClosed: 0, viewports: [], screenshots: [] };

  const launch = async (options) => {
    state.launchOptions = options;
    return {
      async newPage() {
        state.pagesOpened += 1;
        return {
          async setViewport(viewport) {
            state.viewports.push(viewport);
          },
          async goto(url) {
            if (goto) await goto(url);
          },
          async screenshot(screenshotOptions) {
            state.screenshots.push(screenshotOptions);
            fs.writeFileSync(screenshotOptions.path, 'fake png');
          },
          async close() {
            state.pagesClosed += 1;
          },
        };
      },
      async close() {
        state.browserClosed = true;
      },
    };
  };

  return { launch, state };
}

// Raw HTTP request, so tests can set headers fetch won't let you (like Host)
function request(port, { method = 'GET', path: urlPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: {
        Host: `localhost:${port}`,
        ...(payload !== undefined && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text: data, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// Wait until check() returns something truthy, polling briefly
async function waitFor(check, { timeout = 5000, interval = 20 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('Timed out waiting for condition');
}

module.exports = { makeTempDir, createFakeLaunch, request, listen, waitFor };
