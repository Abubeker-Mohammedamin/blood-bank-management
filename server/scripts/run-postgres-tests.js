import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const serverDirectory = fileURLToPath(new URL('../', import.meta.url));
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const loopbackAddresses = new Set(['127.0.0.1', '127.0.0.1/32', '::1', '::1/128']);

function validateDatabaseUrl() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('Set TEST_DATABASE_URL to a dedicated local PostgreSQL database ending in _test.');
  }

  const target = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!loopbackHosts.has(target.hostname) || !/_test$/.test(databaseName)) {
    throw new Error('Refusing PostgreSQL tests: TEST_DATABASE_URL must target a local *_test database.');
  }

  if (process.env.DATABASE_URL) {
    const applicationTarget = new URL(process.env.DATABASE_URL);
    if (
      target.host === applicationTarget.host
      && databaseName === decodeURIComponent(applicationTarget.pathname.slice(1))
    ) {
      throw new Error('Refusing PostgreSQL tests: TEST_DATABASE_URL matches DATABASE_URL.');
    }
  }
  return testDatabaseUrl;
}

function run(args, environment) {
  const result = spawnSync(process.execPath, args, {
    cwd: serverDirectory,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
}

async function verifyDatabaseServer(testDatabaseUrl) {
  const client = new pg.Client({ connectionString: testDatabaseUrl });
  try {
    await client.connect();
    const { rows } = await client.query(
      'SELECT current_database() AS database_name, inet_server_addr()::text AS server_address',
    );
    const target = rows[0];
    if (!/_test$/.test(target.database_name) || !loopbackAddresses.has(target.server_address)) {
      throw new Error('Refusing PostgreSQL tests: server must be local and database name must end in _test.');
    }
  } finally {
    await client.end();
  }
}

try {
  const testDatabaseUrl = validateDatabaseUrl();
  await verifyDatabaseServer(testDatabaseUrl);
  const environment = { ...process.env, DATABASE_URL: testDatabaseUrl, RUN_POSTGRES_INTEGRATION_TESTS: '1' };
  const prismaCli = path.join(serverDirectory, 'node_modules', 'prisma', 'build', 'index.js');
  run([prismaCli, 'migrate', 'deploy'], environment);

  if (!process.exitCode) {
    run([
      '--test',
      'tests/api-postgres.test.js',
      'tests/dashboard.test.js',
      'tests/inventory-postgres.test.js',
    ], environment);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
