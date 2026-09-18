const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, runDefaults, validateRunOptions, DEFAULTS } = require('../src/config');

test('loadConfig uses defaults when nothing is set', () => {
  assert.deepEqual(loadConfig({}), DEFAULTS);
});

test('loadConfig reads environment variables', () => {
  const config = loadConfig({
    SCREENSHOT_WIDTH: '1920',
    HEADLESS_MODE: 'false',
    TIMEOUT: '5000',
    CSV_FILE: 'list.csv',
    OUTPUT_DIR: 'out',
    PORT: '8080',
  });
  assert.deepEqual(config, { width: 1920, headless: false, timeout: 5000, csvFile: 'list.csv', outputDir: 'out', port: 8080 });
});

test('loadConfig is headless unless HEADLESS_MODE is exactly "false"', () => {
  assert.equal(loadConfig({ HEADLESS_MODE: 'true' }).headless, true);
  assert.equal(loadConfig({ HEADLESS_MODE: 'yes' }).headless, true);
  assert.equal(loadConfig({ HEADLESS_MODE: 'false' }).headless, false);
});

test('runDefaults keeps in-range settings', () => {
  assert.deepEqual(runDefaults(loadConfig({ SCREENSHOT_WIDTH: '1920', TIMEOUT: '5000', HEADLESS_MODE: 'false' })), {
    width: 1920, timeout: 5000, headless: false,
  });
});

test('runDefaults pulls out-of-range settings into the web UI range', () => {
  const tooBig = runDefaults(loadConfig({ SCREENSHOT_WIDTH: '5000', TIMEOUT: '600000' }));
  assert.deepEqual(tooBig, { width: 3840, timeout: 300000, headless: true });
  const tooSmall = runDefaults(loadConfig({ SCREENSHOT_WIDTH: '100', TIMEOUT: '-5' }));
  assert.deepEqual(tooSmall, { width: 320, timeout: 1000, headless: true });
  assert.deepEqual(validateRunOptions(undefined, tooBig).errors, []);
});

test('validateRunOptions fills in defaults', () => {
  const { options, errors } = validateRunOptions(undefined, DEFAULTS);
  assert.deepEqual(errors, []);
  assert.deepEqual(options, { width: 1440, timeout: 60000, headless: true });
});

test('validateRunOptions accepts values in range', () => {
  const { options, errors } = validateRunOptions({ width: 390, timeout: 1000, headless: false }, DEFAULTS);
  assert.deepEqual(errors, []);
  assert.deepEqual(options, { width: 390, timeout: 1000, headless: false });
});

test('validateRunOptions rejects bad values', () => {
  const { errors } = validateRunOptions({ width: 100, timeout: '60000', headless: 'yes' }, DEFAULTS);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /Width/);
  assert.match(errors[1], /Timeout/);
  assert.match(errors[2], /Headless/);
  assert.equal(validateRunOptions({ width: 1440.5 }, DEFAULTS).errors.length, 1);
});
