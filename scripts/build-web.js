const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'public');
const outputDir = path.join(root, 'dist', 'web');
const indexPath = path.join(sourceDir, 'index.html');

if (!fs.existsSync(indexPath)) throw new Error('Frontend entry point public/index.html is missing.');

const html = fs.readFileSync(indexPath, 'utf8');
const localReferences = [
  ...html.matchAll(/<script\b[^>]*\bsrc=["']\/([^"'?#]*)/gi),
  ...html.matchAll(/<link\b[^>]*\bhref=["']\/([^"'?#]*)/gi)
].map(match => `/${match[1]}`);
for (const reference of localReferences) {
  const relativePath = path.posix.normalize(reference.slice(1));
  if (relativePath.startsWith('..') || !fs.existsSync(path.join(sourceDir, relativePath))) {
    throw new Error(`Frontend asset referenced by index.html is missing: ${reference}`);
  }
}

for (const [, inlineScript] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  if (inlineScript.trim()) new vm.Script(inlineScript, { filename: 'public/index.html' });
}
new vm.Script(fs.readFileSync(path.join(sourceDir, 'features.js'), 'utf8'), { filename: 'public/features.js' });

const countFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).reduce(
  (count, entry) => count + (entry.isDirectory() ? countFiles(path.join(directory, entry.name)) : 1),
  0
);

fs.mkdirSync(outputDir, { recursive: true });
fs.cpSync(sourceDir, outputDir, { recursive: true, force: true });
if (fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8') !== html) {
  throw new Error('Frontend output verification failed: built index.html differs from source.');
}
console.log(`Built static frontend (${countFiles(sourceDir)} files) to ${path.relative(root, outputDir)}.`);
