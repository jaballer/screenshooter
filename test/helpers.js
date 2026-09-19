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
  const state = { launchOptions: null, browserClosed: false, pagesOpened: 0, pagesClosed: 0 };

  const launch = async (options) => {
    state.launchOptions = options;
    return {
      async newPage() {
        state.pagesOpened += 1;
        return {
          async setViewport() {},
          async goto(url) {
            if (goto) await goto(url);
          },
          async $() {
            return { async boundingBox() { return { height: 480.4 }; }, async dispose() {} };
          },
          async screenshot({ path: file }) {
            fs.writeFileSync(file, 'fake png');
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

// Put a file in `dir` that can't be removed, standing in for a screenshot
// that's open in another app on Windows: it sits in a read-only folder.
// Returns a function that makes it removable again. Root ignores folder
// permissions and Windows doesn't use them, so check canMakeStuckFiles first.
const canMakeStuckFiles = process.platform !== 'win32' && process.getuid?.() !== 0;

function addStuckFile(dir) {
  const stuck = path.join(dir, 'stuck');
  fs.mkdirSync(stuck);
  fs.writeFileSync(path.join(stuck, 'open.png'), 'in use');
  fs.chmodSync(stuck, 0o555);
  return () => fs.chmodSync(stuck, 0o755);
}

module.exports = { makeTempDir, createFakeLaunch, request, listen, waitFor, canMakeStuckFiles, addStuckFile };
