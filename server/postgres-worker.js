const { workerData } = require('node:worker_threads');
const { Client, types } = require('pg');
const { resolvePostgresUrl } = require('./database-config');

const { port, signal } = workerData;
const diagnosticCodes = new Map([
  ['ERR_INVALID_URL', 'configuration'],
  ['ECONNREFUSED', 'network'], ['ECONNRESET', 'network'],
  ['EHOSTUNREACH', 'network'], ['ENETUNREACH', 'network'],
  ['EACCES', 'network'], ['EPERM', 'network'],
  ['ENOTFOUND', 'dns'], ['EAI_AGAIN', 'dns'],
  ['ETIMEDOUT', 'timeout'],
  ['CERT_HAS_EXPIRED', 'tls'], ['CERT_NOT_YET_VALID', 'tls'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'], ['SELF_SIGNED_CERT_IN_CHAIN', 'tls'],
  ['UNABLE_TO_GET_ISSUER_CERT', 'tls'], ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'tls'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls'], ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
  ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls'],
  ['28000', 'authentication'], ['28P01', 'authentication'],
  ['3D000', 'database'], ['3F000', 'schema'], ['42P01', 'schema'],
  ['42501', 'permissions'], ['42601', 'sql'], ['0A000', 'unsupported'],
  ['53300', 'capacity'], ['57P03', 'unavailable'], ['57014', 'query-canceled'],
  ['55P03', 'lock'], ['40P01', 'lock'], ['08006', 'connection-lost'],
  ['XX000', 'server']
]);
const driverMessages = new Map([
  ['timeout expired', 'timeout'],
  ['The server does not support SSL connections', 'tls'],
  ['There was an error establishing an SSL connection', 'tls'],
  ['Connection terminated unexpectedly', 'connection-lost'],
  ['Connection terminated', 'connection-lost'],
  ['SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string', 'authentication'],
  ['SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a non-empty string', 'authentication']
]);

function diagnostic(error, phase) {
  const category = diagnosticCodes.get(error.code);
  const reason = category ? category + ': ' + error.code : driverMessages.get(error.message) || 'unknown';
  return 'MineCord PostgreSQL operation failed (' + phase + ': ' + reason + ').';
}

types.setTypeParser(types.builtins.INT8, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds JavaScript precision.');
  return number;
});

let connectionPhase = 'configuration';
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
  connectionPhase = 'connect';
  await client.connect();
  connectionPhase = 'session setup';
  await client.query('SET search_path TO minecord');
  return client;
}

let connection;
port.on('message', async ({ sql, values, operation }) => {
  let response;
  let phase;
  try {
    connection ||= connect();
    const client = await connection;
    phase = operation;
    const result = await client.query(sql, values);
    response = { rows: result.rows, rowCount: result.rowCount };
  } catch (error) {
    response = { error: diagnostic(error, phase || connectionPhase) };
  }
  port.postMessage(response);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
