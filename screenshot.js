require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Load environment variables
const SCREENSHOT_WIDTH = parseInt(process.env.SCREENSHOT_WIDTH) || 1440;
const HEADLESS_MODE = process.env.HEADLESS_MODE === 'true';
const TIMEOUT = parseInt(process.env.TIMEOUT) || 60000;
const CSV_FILE = process.env.CSV_FILE || 'websites.csv';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'screenshots';

// Ensure the screenshots directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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

      const screenshotPath = path.join(OUTPUT_DIR, `${site.name}.png`);
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
