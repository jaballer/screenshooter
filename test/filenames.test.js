const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeFilename, createFilenameAllocator } = require('../src/filenames');

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

test('sanitizeFilename falls back when nothing is left', () => {
  assert.equal(sanitizeFilename('///'), 'unnamed');
  assert.equal(sanitizeFilename('   '), 'unnamed');
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

test('each allocator is independent', () => {
  assert.equal(createFilenameAllocator()('a'), 'a.png');
  assert.equal(createFilenameAllocator()('a'), 'a.png');
});
