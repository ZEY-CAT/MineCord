const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const express = require('express');

const MAX_FILE_BYTES = 128 * 1024;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_FILES = 5000;
const SAFE_ROOTS = Object.freeze([
  'browser-extension',
  'desktop',
  'docs',
  'public',
  'scripts',
  'server',
  'src-tauri/capabilities',
  'src-tauri/src',
  'tests'
]);
const SAFE_ROOT_FILES = new Set(['package.json', 'README.md']);
const SAFE_EXTENSIONS = new Set([
  '.bat', '.cjs', '.css', '.html', '.js', '.jsx', '.json', '.md',
  '.mjs', '.ps1', '.py', '.rs', '.sh', '.sql', '.toml', '.ts',
  '.tsx', '.txt', '.xml', '.yaml', '.yml'
]);
const BLOCKED_EXTENSIONS = /\.(?:crt|db|key|log|pem|pfx?|sqlite(?:3)?|der|p12)(?:-(?:shm|wal))?$/i;
const SECRET_NAME = /(?:^|[._-])(?:credential|credentials|env|secret|secrets|private[-_.]?key|signing[-_.]?key|id[_-]?(?:rsa|ed25519)|token)(?:[._-]|$)/i;
const SECRET_CONTENT = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:client[_-]?secret|secret[_-]?access[_-]?key|turn[_-]?shared[_-]?secret|metered[_-]?secret[_-]?key|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*["']?[A-Za-z0-9_+/=-]{12,}/i,
  /\b(?:api[_-]?key|password|private[_-]?key|secret|signing[_-]?key)["']?\s*[:=]\s*["']?[A-Za-z0-9_+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
];

class HubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isProtectedSegment(segment) {
  return segment.startsWith('.')
    || /^(?:backups?|data|database|db|logs?|private|secrets?|storage|uploads?)$/i.test(segment)
    || /^data\.json$/i.test(segment)
    || /^\.?env(?:\..*)?$/i.test(segment)
    || BLOCKED_EXTENSIONS.test(segment)
    || SECRET_NAME.test(segment);
}

function safeSegments(value) {
  if (typeof value !== 'string' || value.length > 500 || value.includes('\\') || value.includes('\0')) {
    throw new HubError(400, 'Invalid file path.');
  }
  if (value === '') return [];
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment) || isProtectedSegment(segment))) {
    throw new HubError(404, 'File not found.');
  }
  return segments;
}

function safeRepositoryPath(value, directory = false) {
  const segments = safeSegments(value);
  if (!segments.length) return directory;
  const normalized = segments.join('/');
  const isRoot = SAFE_ROOTS.includes(normalized);
  const isInsideRoot = SAFE_ROOTS.some(root => normalized.startsWith(`${root}/`));
  if (directory) return isRoot || isInsideRoot;
  if (SAFE_ROOT_FILES.has(normalized)) return true;
  if (!isInsideRoot || !SAFE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) return false;
  if (segments[0] === 'server' && path.posix.extname(normalized).toLowerCase() !== '.js') return false;
  return true;
}

function isSecretContent(content) {
  return SECRET_CONTENT.some(pattern => pattern.test(content));
}

function userWorkspaceId(user) {
  return crypto.createHash('sha256').update(user.id).digest('hex');
}

function isApprovedDeveloper(user, approvedUserIds) {
  return Boolean(user && ['owner', 'developer'].includes(user.role) && approvedUserIds.has(user.id));
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let current = path.parse(directory).root;
  for (const segment of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = fs.lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new HubError(500, 'Workspace storage is unavailable.');
  }
}

function readWorkspaceFile(file) {
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function atomicWrite(file, content) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}

function createDeveloperHubRouter({
  repositoryRoot,
  workspaceRoot,
  approvedUserIds,
  authenticate,
  originAllowed = () => false,
  audit = () => {}
}) {
  const root = fs.realpathSync(repositoryRoot);
  const workspaceBase = path.resolve(workspaceRoot);
  const workspaceFromRoot = path.relative(root, workspaceBase);
  const rootFromWorkspace = path.relative(workspaceBase, root);
  const overlapsRepository = relative => relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  if (overlapsRepository(workspaceFromRoot) || overlapsRepository(rootFromWorkspace)) {
    throw new Error('Developer workspace storage must be outside the repository.');
  }
  const approvals = approvedUserIds instanceof Set ? approvedUserIds : new Set(approvedUserIds || []);
  const router = express.Router();
  const rateLimits = new Map();

  function getSourceFile(relativePath) {
    if (!safeRepositoryPath(relativePath)) throw new HubError(404, 'File not found.');
    const absolute = path.resolve(root, ...safeSegments(relativePath));
    if (!absolute.startsWith(`${root}${path.sep}`)) throw new HubError(404, 'File not found.');
    let current = root;
    for (const segment of safeSegments(relativePath)) {
      current = path.join(current, segment);
      let info;
      try { info = fs.lstatSync(current); } catch (error) {
        if (error.code === 'ENOENT') throw new HubError(404, 'File not found.');
        throw error;
      }
      if (info.isSymbolicLink()) throw new HubError(404, 'File not found.');
      if (current !== absolute && !info.isDirectory()) throw new HubError(404, 'File not found.');
    }
    const info = fs.lstatSync(absolute);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) {
      if (info.isFile()) throw new HubError(413, 'File exceeds the 128 KB viewing limit.');
      throw new HubError(404, 'File not found.');
    }
    let content;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(absolute));
    } catch {
      throw new HubError(404, 'File not found.');
    }
    if (content.includes('\0') || isSecretContent(content)) throw new HubError(404, 'File not found.');
    return content;
  }

  function workspacePaths(user, relativePath) {
    const userRoot = path.join(workspaceBase, userWorkspaceId(user));
    const segments = safeSegments(relativePath);
    const file = path.resolve(userRoot, ...segments);
    const base = path.resolve(userRoot, '.base', ...segments);
    if (!file.startsWith(`${userRoot}${path.sep}`) || !base.startsWith(`${userRoot}${path.sep}`)) {
      throw new HubError(404, 'File not found.');
    }
    return { userRoot, file, base };
  }

  function checkRateLimit(req, res, next) {
    const now = Date.now();
    const key = `${req.minecordUser.id}:${req.method}`;
    let entry = rateLimits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + 60_000 };
      rateLimits.set(key, entry);
    }
    entry.count += 1;
    const maximum = req.method === 'GET' ? 120 : 30;
    if (entry.count > maximum) return res.status(429).json({ error: 'Developer Portal rate limit exceeded. Try again shortly.' });
    next();
  }

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.use(authenticate);
  router.use((req, res, next) => {
    const user = req.minecordUser;
    if (!user) return res.status(401).json({ error: 'Please sign in again.' });
    if (!isApprovedDeveloper(user, approvals)) {
      return res.status(403).json({ error: 'Developer Portal access is not enabled for this account.' });
    }
    if (req.method !== 'GET' && (!req.headers.origin || !originAllowed(req))) {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
    next();
  });
  router.use(checkRateLimit);

  router.get('/', (req, res) => {
    const user = req.minecordUser;
    const { userRoot } = workspacePaths(user, 'README.md');
    const files = listWorkspaceFiles(userRoot);
    res.json({
      developer: { username: user.username, role: user.role },
      workspace: { modifiedFiles: files },
      github: { connected: false },
      codespaces: { connected: false }
    });
  });

  router.get('/files', (req, res) => {
    const requested = typeof req.query.path === 'string' ? req.query.path : '';
    const entries = listDirectory(root, requested);
    res.json({ path: requested, entries });
  });

  router.get('/search', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    if (query.length < 2 || query.length > 64) {
      throw new HubError(400, 'Search must be between 2 and 64 characters.');
    }
    const results = [];
    let visited = 0;
    let truncated = false;
    function walk(relativeDirectory, depth) {
      if (depth > 8 || visited >= MAX_SEARCH_FILES || results.length >= MAX_SEARCH_RESULTS) {
        truncated = true;
        return;
      }
      for (const entry of listDirectory(root, relativeDirectory)) {
        if (entry.type === 'directory') walk(entry.path, depth + 1);
        else {
          visited += 1;
          if (entry.name.toLowerCase().includes(query)) results.push(entry);
          if (visited >= MAX_SEARCH_FILES || results.length >= MAX_SEARCH_RESULTS) {
            truncated = true;
            return;
          }
        }
      }
    }
    for (const rootPath of SAFE_ROOTS) {
      if (!fs.existsSync(path.join(root, rootPath))) continue;
      walk(rootPath, 0);
      if (truncated) break;
    }
    res.json({ results, truncated });
  });

  router.get('/file', (req, res) => {
    const relativePath = typeof req.query.path === 'string' ? req.query.path : '';
    const originalContent = getSourceFile(relativePath);
    const paths = workspacePaths(req.minecordUser, relativePath);
    const savedContent = readWorkspaceFile(paths.file);
    const baseContent = savedContent === null ? originalContent : (readWorkspaceFile(paths.base) ?? originalContent);
    const content = savedContent ?? originalContent;
    res.json({ path: relativePath, content, originalContent: baseContent, modified: savedContent !== null });
  });

  router.get('/workspace', (req, res) => {
    const { userRoot } = workspacePaths(req.minecordUser, 'README.md');
    res.json({ modifiedFiles: listWorkspaceFiles(userRoot) });
  });

  router.put('/file', (req, res) => {
    const relativePath = req.body?.path;
    const content = req.body?.content;
    if (typeof relativePath !== 'string' || !safeRepositoryPath(relativePath) || typeof content !== 'string') {
      throw new HubError(400, 'Provide an authorized file path and text content.');
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES || content.includes('\0')) {
      throw new HubError(413, 'File must be valid text no larger than 128 KB.');
    }
    if (isSecretContent(content)) throw new HubError(400, 'Potential secret material is blocked from the workspace.');
    const originalContent = getSourceFile(relativePath);
    const paths = workspacePaths(req.minecordUser, relativePath);
    if (content === originalContent) {
      removeWorkspaceFile(paths.file);
      removeWorkspaceFile(paths.base);
    } else {
      if (readWorkspaceFile(paths.base) === null) atomicWrite(paths.base, originalContent);
      atomicWrite(paths.file, content);
    }
    audit({ actor: userWorkspaceId(req.minecordUser).slice(0, 16), action: content === originalContent ? 'workspace_file_reset' : 'workspace_file_saved', path: relativePath });
    res.json({ ok: true, path: relativePath, modified: content !== originalContent });
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HubError) return res.status(error.status).json({ error: error.message });
    console.error('[dev-portal] Source request failed:', error.message);
    res.status(500).json({ error: 'Developer Portal request failed.' });
  });

  return router;
}

function listDirectory(root, relativeDirectory) {
  const segments = safeSegments(relativeDirectory);
  if (!safeRepositoryPath(relativeDirectory, true)) throw new HubError(404, 'Directory not found.');
  const absolute = path.resolve(root, ...segments);
  if (!absolute.startsWith(root) || (absolute !== root && !absolute.startsWith(`${root}${path.sep}`))) {
    throw new HubError(404, 'Directory not found.');
  }
  if (segments.length === 0) {
    return [
      ...SAFE_ROOTS.filter(value => {
        try {
          const info = fs.lstatSync(path.join(root, value));
          return info.isDirectory() && !info.isSymbolicLink();
        } catch (error) {
          if (error.code === 'ENOENT') return false;
          throw error;
        }
      })
        .map(value => ({ name: value, path: value, type: 'directory' })),
      ...[...SAFE_ROOT_FILES].flatMap(value => {
        try {
          const info = fs.lstatSync(path.join(root, value));
          return info.isFile() && !info.isSymbolicLink()
            ? [{ name: value, path: value, type: 'file', size: info.size }]
            : [];
        } catch (error) {
          if (error.code === 'ENOENT') return [];
          throw error;
        }
      })
    ].sort((a, b) => a.name.localeCompare(b.name));
  }
  let real;
  try { real = fs.realpathSync(absolute); } catch (error) {
    if (error.code === 'ENOENT') throw new HubError(404, 'Directory not found.');
    throw error;
  }
  if (real !== absolute || !fs.statSync(real).isDirectory()) throw new HubError(404, 'Directory not found.');
  return fs.readdirSync(absolute, { withFileTypes: true })
    .filter(entry => !entry.isSymbolicLink() && !isProtectedSegment(entry.name))
    .map(entry => {
      const childPath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        return safeRepositoryPath(childPath, true) ? { name: entry.name, path: childPath, type: 'directory' } : null;
      }
      if (!entry.isFile() || !safeRepositoryPath(childPath)) return null;
      const size = fs.statSync(path.join(absolute, entry.name)).size;
      return { name: entry.name, path: childPath, type: 'file', size };
    })
    .filter(Boolean)
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

function listWorkspaceFiles(userRoot) {
  const files = [];
  function walk(directory, relativeDirectory = '') {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === '.base' || isProtectedSegment(entry.name)) continue;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute, relativePath);
      else if (entry.isFile() && safeRepositoryPath(relativePath)) files.push(relativePath);
    }
  }
  walk(userRoot);
  return files.sort();
}

function removeWorkspaceFile(file) {
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new HubError(500, 'Workspace storage is unavailable.');
    fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  MAX_FILE_BYTES,
  createDeveloperHubRouter,
  isApprovedDeveloper,
  isProtectedSegment,
  isSecretContent,
  safeRepositoryPath
};
