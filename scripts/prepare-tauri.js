const fs = require('node:fs');
const path = require('node:path');
const { builtinModules, createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'tauri-resources');
const backend = path.join(output, 'backend');
const nodeModules = path.join(root, 'node_modules');
const builtinNames = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/, '')]));

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The current Tauri package configuration supports Windows x64 builds only.');
}
if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('Bundling the MINECORD backend requires Node.js 24 or later.');
}

fs.mkdirSync(path.join(backend, 'server'), { recursive: true });
fs.mkdirSync(path.join(backend, 'dist'), { recursive: true });
fs.cpSync(path.join(root, 'dist', 'web'), path.join(backend, 'dist', 'web'), { recursive: true, force: true });
for (const file of fs.readdirSync(path.join(root, 'server'), { withFileTypes: true })) {
  if (file.isFile() && file.name.endsWith('.js')) {
    fs.copyFileSync(path.join(root, 'server', file.name), path.join(backend, 'server', file.name));
  }
}

const dependencyRoots = new Set();
for (const file of fs.readdirSync(path.join(root, 'server')).filter(name => name.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(root, 'server', file), 'utf8');
  for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const specifier = match[1];
    if (specifier.startsWith('.') || specifier.startsWith('/') || builtinNames.has(specifier.replace(/^node:/, ''))) continue;
    const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    dependencyRoots.add(packageName);
  }
}

function findPackageRoot(packageName, resolver) {
  for (const modulesDirectory of resolver.resolve.paths(packageName) || []) {
    const candidate = path.join(modulesDirectory, ...packageName.split('/'));
    const manifest = path.join(candidate, 'package.json');
    if (fs.existsSync(manifest)) {
      const packageJson = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (packageJson.name === packageName) return candidate;
    }
  }
  throw new Error(`Could not locate the installed package directory for ${packageName}.`);
}

const visited = new Set();
function stageDependency(packageName, fromDirectory) {
  const resolver = createRequire(path.join(fromDirectory, 'package.json'));
  const packageRoot = findPackageRoot(packageName, resolver);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (visited.has(packageRoot)) return;
  visited.add(packageRoot);
  const relative = path.relative(nodeModules, packageRoot);
  fs.cpSync(packageRoot, path.join(backend, 'node_modules', relative), {
    recursive: true,
    force: true,
    filter: source => !/(^|[\\/])(?:\.git|test|tests|example|examples|coverage)(?:[\\/]|$)/i.test(source)
  });
  for (const child of Object.keys(manifest.dependencies || {})) stageDependency(child, packageRoot);
}

for (const dependency of dependencyRoots) stageDependency(dependency, root);

const nodeRuntime = process.execPath;
fs.copyFileSync(nodeRuntime, path.join(output, 'node.exe'));
fs.copyFileSync(path.join(root, 'assets', 'minecord.ico'), path.join(output, 'minecord.ico'));
console.log(`Prepared Windows Node sidecar and backend resources at ${path.relative(root, output)}.`);
console.log(`Backend dependencies staged: ${visited.size}.`);
