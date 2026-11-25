const { MessageChannel, Worker, receiveMessageOnPort } = require('node:worker_threads');

const timeoutMs = 30000;

// The application database API is synchronous. Keep the network client on a
// worker so its socket and TLS handshake can progress while a caller waits.
function openPostgresDatabase() {
  const { port1, port2 } = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(require.resolve('./postgres-worker'), {
    workerData: { port: port2, signal }, transferList: [port2]
  });
  worker.on('error', () => console.error('MineCord PostgreSQL worker stopped.'));
  worker.unref();
  port1.unref();
  let failed = false;

  function query(sql, values, operation = 'query') {
    if (failed) throw new Error('MineCord PostgreSQL connection requires a process restart.');
    Atomics.store(signal, 0, 0);
    port1.postMessage({ sql, values, operation });
    if (Atomics.wait(signal, 0, 0, timeoutMs) === 'timed-out') {
      failed = true;
      void worker.terminate();
      throw new Error('MineCord PostgreSQL operation timed out (' + operation + ': worker timeout).');
    }
    const { message } = receiveMessageOnPort(port1);
    if (message.error) throw new Error(message.error);
    return message;
  }

  return {
    exec(sql, operation = 'statement batch') {
      if (sql === 'BEGIN IMMEDIATE') {
        query('BEGIN; SELECT pg_advisory_xact_lock(726489031, 1);', [], 'transaction start');
      } else {
        query(sql, [], operation);
      }
    },
    prepare(sql) {
      let parameter = 0;
      let statement = sql.replaceAll('?', () => '$' + (++parameter));
      if (statement.startsWith('INSERT OR IGNORE INTO ')) {
        statement = statement.replace('INSERT OR IGNORE INTO ', 'INSERT INTO ') + ' ON CONFLICT DO NOTHING';
      }
      return {
        run: (...values) => ({ changes: query(statement, values).rowCount }),
        get: (...values) => query(statement, values).rows[0],
        all: (...values) => query(statement, values).rows
      };
    }
  };
}

module.exports = { openPostgresDatabase };
