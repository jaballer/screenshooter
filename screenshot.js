require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Load environment variables
const SCREENSHOT_WIDTH = parseInt(process.env.SCREENSHOT_WIDTH) || 1440;
const HEADLESS_MODE = process.env.HEADLESS_MODE !== 'false';
const TIMEOUT = parseInt(process.env.TIMEOUT) || 60000;
const CSV_FILE = process.env.CSV_FILE || 'websites.csv';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'screenshots';

// Ensure the screenshots directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Sanitize a CSV name into a safe filename
function sanitizeFilename(name) {
  return name
    .replace(/[\/\\]/g, '-')           // path separators → dash
    .replace(/[<>:"|?*\x00-\x1f]/g, '-') // other dangerous/reserved chars → dash
    .replace(/\.{2,}/g, '-')           // collapse .. to prevent path traversal
    .replace(/-{2,}/g, '-')            // collapse runs of dashes
    .replace(/^[\s-]+|[\s-]+$/g, '')   // strip leading/trailing whitespace and dashes
    || 'unnamed';                       // fallback if everything was stripped
}

// Function to read URLs from CSV
function readWebsitesFromCSV(filePath) {
  return new Promise((resolve, reject) => {
    const websites = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        if (row.name && row.url) {
          websites.push({ name: row.name.trim(), url: row.url.trim() });
        }
      })
      .on('end', () => resolve(websites))
      .on('error', (error) => reject(error));
  });
}

// Function to capture screenshots
async function captureScreenshots(websites) {
  const browser = await puppeteer.launch({ headless: HEADLESS_MODE });
  const usedFilenames = new Set(); // track emitted filenames to handle collisions

  for (const site of websites) {
    const page = await browser.newPage();
    console.log(`Capturing: ${site.name} - ${site.url}`);

    try {
      await page.setViewport({ width: SCREENSHOT_WIDTH, height: 1 });
      await page.goto(site.url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

      // Adjust height dynamically based on content
      const bodyHandle = await page.$('body');
      const { height } = await bodyHandle.boundingBox();
      await bodyHandle.dispose();
      await page.setViewport({ width: SCREENSHOT_WIDTH, height: Math.ceil(height) });

      // Sanitize the name into a safe filename and resolve collisions by
      // probing for the first candidate that hasn't already been emitted.
      // Keys are lowercased since Windows and default macOS filesystems
      // treat filenames case-insensitively.
      const baseName = sanitizeFilename(site.name);
      let filename = `${baseName}.png`;
      let count = 1;
      while (usedFilenames.has(filename.toLowerCase())) {
        filename = `${baseName}-${count}.png`;
        count += 1;
      }
      usedFilenames.add(filename.toLowerCase());
      const screenshotPath = path.join(OUTPUT_DIR, filename);

      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Saved: ${screenshotPath}`);
    } catch (error) {
      console.error(`Failed to capture ${site.name}:`, error);
    }

    await page.close();
  }

  await browser.close();
  console.log("All screenshots captured!");
}

// Main Execution
(async () => {
  try {
    const websites = await readWebsitesFromCSV(CSV_FILE);
    if (websites.length === 0) {
      console.log("No valid websites found in CSV.");
      return;
    }
    await captureScreenshots(websites);
  } catch (error) {
    console.error("Error:", error);
  }
})();
