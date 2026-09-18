const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeFilename, createFilenameAllocator, MAX_BASENAME_BYTES } = require('../src/filenames');

test('sanitizeFilename keeps ordinary names', () => {
  assert.equal(sanitizeFilename('VS Code'), 'VS Code');
  assert.equal(sanitizeFilename('Vue.js'), 'Vue.js');
});

test('sanitizeFilename replaces path separators so names cannot escape the folder', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'etc-passwd');
  assert.equal(sanitizeFilename('a\\b/c'), 'a-b-c');
  assert.equal(sanitizeFilename('..'), 'unnamed');
});

test('sanitizeFilename replaces reserved and control characters', () => {
  assert.equal(sanitizeFilename('What? <Yes>: "no" | *'), 'What- -Yes- -no');
  assert.equal(sanitizeFilename('tab\there'), 'tab-here');
});

test('sanitizeFilename never produces a hidden file', () => {
  assert.equal(sanitizeFilename('.homepage'), 'homepage');
  assert.equal(sanitizeFilename(' . env'), 'env');
  assert.equal(sanitizeFilename('.'), 'unnamed');
});

test('sanitizeFilename falls back when nothing is left', () => {
  assert.equal(sanitizeFilename('///'), 'unnamed');
  assert.equal(sanitizeFilename('   '), 'unnamed');
});

test('sanitizeFilename caps long names below the filesystem limit', () => {
  assert.equal(sanitizeFilename('a'.repeat(300)), 'a'.repeat(MAX_BASENAME_BYTES));
  // Multi-byte characters are counted in bytes and never split
  assert.equal(sanitizeFilename('é'.repeat(150)), 'é'.repeat(100));
  assert.equal(sanitizeFilename('📸'.repeat(60)), '📸'.repeat(50));
  // A dot left at the end by the cut is dropped
  assert.equal(sanitizeFilename(`${'a'.repeat(199)}.b`), 'a'.repeat(199));
});

test('allocator suffixes stay under 255 bytes for long names', () => {
  const allocate = createFilenameAllocator();
  allocate('x'.repeat(400));
  const second = allocate('x'.repeat(400));
  assert.equal(second, `${'x'.repeat(MAX_BASENAME_BYTES)}-1.png`);
  assert.ok(Buffer.byteLength(second) <= 255);
});

test('allocator suffixes duplicate names', () => {
  const allocate = createFilenameAllocator();
  assert.equal(allocate('GitHub'), 'GitHub.png');
  assert.equal(allocate('GitHub'), 'GitHub-1.png');
  assert.equal(allocate('GitHub'), 'GitHub-2.png');
});

test('allocator treats names differing only by case as duplicates', () => {
  const allocate = createFilenameAllocator();
  assert.equal(allocate('GitHub'), 'GitHub.png');
  assert.equal(allocate('github'), 'github-1.png');
});

test('allocator never reuses a name that already looks like a suffix', () => {
  const allocate = createFilenameAllocator();
  assert.equal(allocate('foo'), 'foo.png');
  assert.equal(allocate('foo-1'), 'foo-1.png');
  assert.equal(allocate('foo'), 'foo-2.png');
});

test('allocator never hands out a reserved filename', () => {
  const allocate = createFilenameAllocator(['Docs.png', 'GITHUB.PNG']);
  assert.equal(allocate('Docs'), 'Docs-1.png');
  assert.equal(allocate('github'), 'github-1.png');
  assert.equal(allocate('React'), 'React.png');
});

test('each allocator is independent', () => {
  assert.equal(createFilenameAllocator()('a'), 'a.png');
  assert.equal(createFilenameAllocator()('a'), 'a.png');
});
