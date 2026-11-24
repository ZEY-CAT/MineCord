const fs = require('node:fs');
const path = require('node:path');
const { createDatabaseBackup, setPrivateDirectoryPermissions } = require('./migrate-private-data');

async function main() {
  const [sourceArg, outputArg] = process.argv.slice(2);
  if (process.argv.length !== 4 || !path.isAbsolute(sourceArg) || !path.isAbsolute(outputArg)) {
    throw new Error('Provide an absolute SQLite source path and an absolute private backup parent directory.');
  }
  const source = fs.realpathSync(sourceArg);
  const parent = fs.realpathSync(outputArg);
  const checkout = fs.realpathSync(path.join(__dirname, '..'));
  const relative = path.relative(checkout, parent);
  if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) {
    throw new Error('The backup directory must be outside the repository.');
  }
  if (!fs.statSync(source).isFile()) throw new Error('The SQLite source must be a file.');
  const directory = fs.mkdtempSync(path.join(parent, 'minecord-sqlite-backup-'));
  setPrivateDirectoryPermissions(directory);
  const output = path.join(directory, 'minecord.sqlite');
  await createDatabaseBackup(source, output);
  if (process.platform !== 'win32') fs.chmodSync(output, 0o600);
  console.log('Verified SQLite backup saved to ' + output);
}

main().catch(() => {
  console.error('SQLite backup failed. Use absolute paths to an existing SQLite file and a writable private directory outside the repository. Keep the source and retry with writes paused.');
  process.exitCode = 1;
});
