// Filesystems cap a filename at 255 bytes; this leaves room for a collision
// suffix and the .png extension
const MAX_BASENAME_BYTES = 200;

// Cut text to at most maxBytes of UTF-8 without splitting a character
function truncateToBytes(text, maxBytes) {
  let bytes = 0;
  let result = '';
  for (const char of text) {
    bytes += Buffer.byteLength(char);
    if (bytes > maxBytes) break;
    result += char;
  }
  return result;
}

// Sanitize a CSV name into a safe filename
function sanitizeFilename(name) {
  const safe = name
    .replace(/[\/\\]/g, '-')           // path separators → dash
    .replace(/[<>:"|?*\x00-\x1f]/g, '-') // other dangerous/reserved chars → dash
    .replace(/\.{2,}/g, '-')           // collapse .. to prevent path traversal
    .replace(/-{2,}/g, '-')            // collapse runs of dashes
    .replace(/^[\s-]+|[\s-]+$/g, '');  // strip leading/trailing whitespace and dashes
  return truncateToBytes(safe, MAX_BASENAME_BYTES)
    .replace(/[\s.-]+$/, '')           // no trailing dot/space/dash (a cut can expose one)
    || 'unnamed';                       // fallback if everything was stripped
}

// Returns a function that turns a site name into a unique PNG filename for one
// run. Collisions are resolved by probing for the first candidate that hasn't
// already been emitted. Keys are lowercased since Windows and default macOS
// filesystems treat filenames case-insensitively.
function createFilenameAllocator() {
  const usedFilenames = new Set();

  return function allocateFilename(name) {
    const baseName = sanitizeFilename(name);
    let filename = `${baseName}.png`;
    let count = 1;
    while (usedFilenames.has(filename.toLowerCase())) {
      filename = `${baseName}-${count}.png`;
      count += 1;
    }
    usedFilenames.add(filename.toLowerCase());
    return filename;
  };
}

module.exports = { sanitizeFilename, createFilenameAllocator, MAX_BASENAME_BYTES };
