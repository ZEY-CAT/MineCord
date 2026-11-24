const { workerData } = require('node:worker_threads');
const { Client, types } = require('pg');
const { resolvePostgresUrl } = require('./database-config');

const { port, signal } = workerData;
types.setTypeParser(types.builtins.INT8, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds JavaScript precision.');
  return number;
});

async function connect() {
  const url = new URL(resolvePostgresUrl());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowLocalPlaintext = local && !process.env.RENDER_EXTERNAL_URL && url.searchParams.get('sslmode') === 'disable';
  for (const parameter of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) {
    url.searchParams.delete(parameter);
  }
  const client = new Client({
    connectionString: url.href,
    ssl: allowLocalPlaintext ? false : { rejectUnauthorized: true },
    connectionTimeoutMillis: 8000,
    statement_timeout: 20000,
    application_name: 'MineCord'
  });
  client.on('error', () => console.error('MineCord PostgreSQL connection closed unexpectedly.'));
  await client.connect();
  await client.query('SET search_path TO minecord');
  return client;
}

let connection;
port.on('message', async ({ sql, values }) => {
  let response;
  try {
    connection ||= connect();
    const client = await connection;
    const result = await client.query(sql, values);
    response = { rows: result.rows, rowCount: result.rowCount };
  } catch (error) {
    const code = String(error.code || '');
    response = { error: 'MineCord PostgreSQL operation failed' + (/^[A-Z0-9_]{3,24}$/.test(code) ? ' (' + code + ')' : '') + '.' };
  }
  port.postMessage(response);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
