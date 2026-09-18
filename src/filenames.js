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

module.exports = { sanitizeFilename, createFilenameAllocator };
