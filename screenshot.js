const { loadConfig } = require('./src/config');
const { readSitesFromCsvFile, InputError } = require('./src/sites');
const { captureSites } = require('./src/capture');

// Command-line capture: read sites from CSV_FILE and save screenshots to
// OUTPUT_DIR. Exits with code 1 if anything failed.
async function main() {
  const config = loadConfig();
  const { sites, skipped } = await readSitesFromCsvFile(config.csvFile);

  for (const entry of skipped) {
    console.warn(`Skipping ${entry.where} (${entry.input}): ${entry.reason}`);
  }
  if (sites.length === 0) {
    console.log(`No valid websites found in ${config.csvFile}. Add rows with a "url" column (see websites.example.csv).`);
    return 0;
  }

  const { saved, failed } = await captureSites(sites, {
    outputDir: config.outputDir,
    width: config.width,
    timeout: config.timeout,
    headless: config.headless,
    onEvent: (event) => {
      if (event.type === 'site-start') console.log(`Capturing: ${event.name} - ${event.url}`);
      if (event.type === 'site-done') console.log(`Saved: ${event.path}`);
      if (event.type === 'site-failed') console.error(`Failed to capture ${event.name}: ${event.error}`);
    },
  });

  if (failed === 0) {
    console.log("All screenshots captured!");
    return 0;
  }
  console.log(`Finished: ${saved} saved, ${failed} failed.`);
  return 1;
}

if (require.main === module) {
  require('dotenv').config();
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error("Error:", error instanceof InputError ? error.message : error);
      process.exitCode = 1;
    });
}
