const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { createFilenameAllocator } = require('./filenames');

// Pages open in a window this tall at the chosen width, like a typical desktop
// browser. Anything sized to the window (such as a 100vh hero) is laid out at
// this height, and the screenshot still covers the whole page.
const VIEWPORT_HEIGHT = 900;

// Capture a full-page screenshot of each site, one at a time. Progress is
// reported through onEvent; a site that fails is recorded and the run moves on.
// Aborting `signal` closes the browser, which stops the site in progress.
// Filenames in `reservedFilenames` are never written over.
async function captureSites(sites, options) {
  const {
    outputDir,
    width,
    timeout,
    headless,
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

  try {
    for (const [index, site] of sites.entries()) {
      if (signal?.aborted) break;

      const startedAt = Date.now();
      const base = { index, name: site.name, url: site.url };
      emit({ type: 'site-start', ...base });

      let page;
      try {
        page = await browser.newPage();
        await page.setViewport({ width, height: VIEWPORT_HEIGHT });
        await page.goto(site.url, { waitUntil: 'networkidle2', timeout });

        const filename = allocateFilename(site.name);
        const screenshotPath = path.join(outputDir, filename);
        // captureBeyondViewport is Puppeteer's default, set here because this
        // relies on it: the whole page is captured without resizing the window.
        // With it off, Puppeteer first grows the window to the page's height,
        // stretching anything sized to the window.
        await page.screenshot({ path: screenshotPath, fullPage: true, captureBeyondViewport: true });

        const result = { ...base, status: 'saved', file: filename, path: screenshotPath, durationMs: Date.now() - startedAt };
        results.push(result);
        emit({ type: 'site-done', ...result });
      } catch (error) {
        const status = signal?.aborted ? 'cancelled' : 'failed';
        const result = { ...base, status, error: error.message, durationMs: Date.now() - startedAt };
        results.push(result);
        emit({ type: status === 'cancelled' ? 'site-cancelled' : 'site-failed', ...result });
      } finally {
        if (page) await page.close().catch(() => {});
      }
    }
  } finally {
    signal?.removeEventListener('abort', closeBrowser);
    await closeBrowser();
  }

  const summary = {
    results,
    saved: results.filter((r) => r.status === 'saved').length,
    failed: results.filter((r) => r.status === 'failed').length,
    cancelled: Boolean(signal?.aborted),
  };
  emit({ type: 'done', saved: summary.saved, failed: summary.failed, cancelled: summary.cancelled });
  return summary;
}

module.exports = { captureSites };
