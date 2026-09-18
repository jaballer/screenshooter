const DEFAULTS = {
  width: 1440,
  timeout: 60000,
  headless: true,
  csvFile: 'websites.csv',
  outputDir: 'screenshots',
  port: 5055,
};

// Bounds for options chosen per run in the web UI
const LIMITS = {
  width: { min: 320, max: 3840 },
  timeout: { min: 1000, max: 300000 },
};

// Read settings from environment variables (normally loaded from .env)
function loadConfig(env = process.env) {
  return {
    width: parseInt(env.SCREENSHOT_WIDTH) || DEFAULTS.width,
    headless: env.HEADLESS_MODE !== 'false',
    timeout: parseInt(env.TIMEOUT) || DEFAULTS.timeout,
    csvFile: env.CSV_FILE || DEFAULTS.csvFile,
    outputDir: env.OUTPUT_DIR || DEFAULTS.outputDir,
    port: parseInt(env.PORT) || DEFAULTS.port,
  };
}

// Validate per-run options sent by the web UI. Missing fields fall back to the
// configured defaults; anything present must be the right type and in range.
function validateRunOptions(input, defaults) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = [];

  const pickInteger = (key, label) => {
    const value = source[key] ?? defaults[key];
    const { min, max } = LIMITS[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${label} must be a whole number from ${min} to ${max}`);
    }
    return value;
  };

  const width = pickInteger('width', 'Width (px)');
  const timeout = pickInteger('timeout', 'Timeout (ms)');
  const headless = source.headless ?? defaults.headless;
  if (typeof headless !== 'boolean') {
    errors.push('Headless must be true or false');
  }

  return { options: { width, timeout, headless }, errors };
}

module.exports = { DEFAULTS, LIMITS, loadConfig, validateRunOptions };
