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

// Web runs rewrite run.json and stream the whole run on every change, so the
// cost grows with the square of the site count. The CLI has no such limit.
const MAX_SITES_PER_RUN = 1000;

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

// The web UI's starting options: the configured values, pulled into the range
// the UI accepts so an unusual .env can't make every web run invalid
function runDefaults(config) {
  const clamp = (value, { min, max }) => Math.min(Math.max(value, min), max);
  return {
    width: clamp(config.width, LIMITS.width),
    timeout: clamp(config.timeout, LIMITS.timeout),
    headless: config.headless,
  };
}

// Validate per-run options sent by the web UI. Missing fields fall back to
// `defaults` (see runDefaults); anything present must be the right type and in range.
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

module.exports = { DEFAULTS, LIMITS, MAX_SITES_PER_RUN, loadConfig, runDefaults, validateRunOptions };
