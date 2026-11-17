const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const configPath = process.env.MINECORD_DEV_LOGINS_PATH
  ? path.resolve(process.env.MINECORD_DEV_LOGINS_PATH)
  : path.resolve(__dirname, '..', 'DEV-LOGINS.json');
const username = process.argv[2] || '';

if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
  console.error('Usage: node scripts/bootstrap-dev-owner.js <portal-username>');
  process.exitCode = 1;
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run this command in an interactive terminal so the portal password is not echoed.');
  process.exitCode = 1;
} else {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  let password = '';
  let confirmation = '';
  let confirming = false;
  let active = true;
  process.stdout.write('Create a dedicated portal password (8–200 characters): ');
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (character, key = {}) => {
    if (!active) return;
    if (key.ctrl && key.name === 'c') {
      process.stdout.write('\nCancelled.\n');
      finish();
      process.exitCode = 1;
      return;
    }
    if (key.name === 'return' || key.name === 'enter') {
      process.stdout.write('\n');
      if (!confirming) {
        if (password.length < 8 || password.length > 200) {
          password = '';
          process.stdout.write('Password must be 8–200 characters. Try again: ');
          return;
        }
        confirming = true;
        process.stdout.write('Confirm portal password: ');
        return;
      }
      if (password !== confirmation) {
        password = '';
        confirmation = '';
        confirming = false;
        process.stdout.write('Passwords did not match. Create a portal password (8–200 characters): ');
        return;
      }
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.version !== 1 || !Array.isArray(config.users)) throw new Error('DEV-LOGINS.json is invalid.');
        if (config.users.some(user => user.role === 'owner')) throw new Error('An owner login already exists.');
        if (config.users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
          throw new Error('That portal username is already in use.');
        }
        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = crypto.scryptSync(password, salt, 64, {
          N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
        }).toString('hex');
        config.users.push({
          id: crypto.randomUUID(),
          username,
          passwordSalt: salt,
          passwordHash,
          role: 'owner',
          approved: true,
          createdAt: Date.now()
        });
        const temporary = `${configPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, configPath);
        try { fs.chmodSync(configPath, 0o600); } catch (error) {
          if (process.platform !== 'win32') throw error;
        }
        process.stdout.write(`Owner portal login "${username}" created in DEV-LOGINS.json.\n`);
        finish();
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
        finish();
      }
      return;
    }
    if (key.name === 'backspace') {
      if (confirming) confirmation = confirmation.slice(0, -1);
      else password = password.slice(0, -1);
      return;
    }
    if (character && !key.ctrl && !key.meta) {
      if (confirming) confirmation += character;
      else password += character;
    }
  });
  function finish() {
    if (!active) return;
    active = false;
    password = '';
    confirmation = '';
    process.stdin.setRawMode(false);
    prompt.close();
  }
}
