const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { createFilenameAllocator } = require('./filenames');

// Pages open in a window this tall at the chosen width, like a typical desktop
// browser. Anything sized to the window (such as a 100vh hero) is laid out at
// this height, and the screenshot still covers the whole page.
const VIEWPORT_HEIGHT = 900;

// Pages that load images and sections as they scroll into view are scrolled
// through before the shot, so the screenshot isn't full of empty placeholders.
// The scroll gives up after LAZY_LOAD_MAX_MS on endless feeds.
const LAZY_LOAD_MAX_MS = 10000;
const LAZY_LOAD_SETTLE_MS = 5000;

async function loadLazyContent(page) {
  await page.evaluate((maxMs) => new Promise((resolve) => {
    const startedAt = Date.now();
    let y = 0;
    const step = () => {
      window.scrollTo({ top: y, behavior: 'instant' });
      y += Math.max(window.innerHeight * 0.8, 200);
      if (y >= document.documentElement.scrollHeight || Date.now() - startedAt > maxMs) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        resolve();
      } else {
        setTimeout(step, 100);
      }
    };
    step();
  }), LAZY_LOAD_MAX_MS);
  // Let what the scroll triggered finish loading
  await page.waitForNetworkIdle({ idleTime: 500, timeout: LAZY_LOAD_SETTLE_MS }).catch(() => {});
}

// Capture a full-page screenshot of each site, `concurrency` at a time (one
// at a time when the browser is visible).
// Progress is reported through onEvent; a site that fails is recorded and the
// run moves on. With `lazyLoad`, each page is scrolled through first so
// lazy-loaded content is in the shot. Aborting `signal` closes the browser,
// which stops the sites in progress. Filenames in `reservedFilenames` are
// never written over.
async function captureSites(sites, options) {
  const {
    outputDir,
    width,
    timeout,
    headless,
    concurrency = 1,
    lazyLoad = true,
    signal,
    reservedFilenames = [],
    onEvent = () => {},
    launch = (launchOptions) => puppeteer.launch(launchOptions),
  } = options;

  // A broken listener must not turn into a failed capture
  const emit = (event) => {
    try {
      onEvent(event);
    } catch (error) {
      console.error('Progress listener failed:', error);
    }
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const allocateFilename = createFilenameAllocator(reservedFilenames);
  const results = [];
  emit({ type: 'start', total: sites.length });

  const browser = await launch({ headless });
  const closeBrowser = () => browser.close().catch(() => {});
  signal?.addEventListener('abort', closeBrowser, { once: true });

  const captureSite = async (site, index) => {
    const startedAt = Date.now();
    const base = { index, name: site.name, url: site.url };
    emit({ type: 'site-start', ...base });

    let page;
    try {
      page = await browser.newPage();
      await page.setViewport({ width, height: VIEWPORT_HEIGHT });
      // Pages in the background of a shared browser count as hidden, so their
      // scroll observers (lazy loading) never fire. Make each one believe it's in front.
      const client = await page.createCDPSession();
      await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await page.goto(site.url, { waitUntil: 'networkidle2', timeout });
      // Best effort: a page that resists scrolling still gets its screenshot
      if (lazyLoad) await loadLazyContent(page).catch(() => {});

      const filename = allocateFilename(site.name);
      const screenshotPath = path.join(outputDir, filename);
      // captureBeyondViewport is Puppeteer's default, set here because this
      // relies on it: the whole page is captured without resizing the window.
      // With it off, Puppeteer first grows the window to the page's height,
      // stretching anything sized to the window.
      await page.screenshot({ path: screenshotPath, fullPage: true, captureBeyondViewport: true });

      const result = { ...base, status: 'saved', file: filename, path: screenshotPath, durationMs: Date.now() - startedAt };
      results[index] = result;
      emit({ type: 'site-done', ...result });
    } catch (error) {
      const status = signal?.aborted ? 'cancelled' : 'failed';
      const result = { ...base, status, error: error.message, durationMs: Date.now() - startedAt };
      results[index] = result;
      emit({ type: status === 'cancelled' ? 'site-cancelled' : 'site-failed', ...result });
    } finally {
      if (page) await page.close().catch(() => {});
    }
  };

  // Focus emulation doesn't help a visible browser, whose background tabs
  // really are hidden, so it captures one site at a time, in the tab you're watching
  const workers = headless ? Math.max(1, Math.floor(concurrency) || 1) : 1;

  // Each worker takes the next site off the list until none are left
  let next = 0;
  const worker = async () => {
    while (next < sites.length && !signal?.aborted) {
      const index = next++;
      await captureSite(sites[index], index);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(workers, sites.length) }, worker));
  } finally {
    signal?.removeEventListener('abort', closeBrowser);
    await closeBrowser();
  }

  // Sites never started (the run was cancelled first) have no result
  const finished = results.filter(Boolean);
  const summary = {
    results: finished,
    saved: finished.filter((r) => r.status === 'saved').length,
    failed: finished.filter((r) => r.status === 'failed').length,
    cancelled: Boolean(signal?.aborted),
  };
  emit({ type: 'done', saved: summary.saved, failed: summary.failed, cancelled: summary.cancelled });
  return summary;
}

module.exports = { captureSites };
