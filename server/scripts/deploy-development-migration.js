import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const serverDirectory = fileURLToPath(new URL('../', import.meta.url));
const prismaCli = path.join(serverDirectory, 'node_modules', 'prisma', 'build', 'index.js');
const migrationName = '20261029130000_initial_design';
const expectedDatabase = 'blood_bank';
const requiredTables = [
  'users',
  'roles',
  'user_roles',
  'hospital_users',
  'hospitals',
  'staff',
  'donors',
  'blood_types',
  'appointments',
  'donations',
  'laboratory_tests',
  'donation_blood_types',
  'storage_locations',
  'blood_units',
  'blood_requests',
  'blood_request_status_history',
  'blood_compatibility_approvals',
  'allocations',
  'blood_dispatches',
  'blood_dispatch_status_history',
  'blood_unit_movements',
  'notifications',
  'audit_logs',
  'user_sessions',
];

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();

  const { rows: databaseRows } = await client.query(
    `SELECT current_database() AS database_name,
            inet_server_addr() AS server_address,
            inet_server_port() AS server_port`,
  );
  const target = databaseRows[0];
  if (
    target.database_name !== expectedDatabase
    || !['127.0.0.1', '::1'].includes(target.server_address)
    || target.server_port !== 5432
  ) {
    throw new Error(
      `Refusing migration: expected local development database "${expectedDatabase}" on localhost:5432.`,
    );
  }

  const { rows: migrationTableRows } = await client.query(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS exists`,
  );
  const migrationTableExists = migrationTableRows[0].exists;

  let migrationAlreadyApplied = false;
  if (migrationTableExists) {
    const { rows } = await client.query(
      'SELECT finished_at FROM public."_prisma_migrations" WHERE migration_name = $1 AND rolled_back_at IS NULL',
      [migrationName],
    );
    migrationAlreadyApplied = rows.some((row) => row.finished_at !== null);
  }

  const { rows: tableRows } = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  const existingTables = tableRows.map((row) => row.table_name);

  if (existingTables.length > 0 && !migrationAlreadyApplied) {
    throw new Error(
      `Refusing migration: found pre-existing application table(s) without a successful migration record (${existingTables.join(', ')}). No tables were changed.`,
    );
  }

  if (migrationAlreadyApplied) {
    console.log(`Migration ${migrationName} is already recorded as applied.`);
  } else {
    console.log(`Preflight passed for database "${expectedDatabase}"; deploying the create-only migration.`);
  }
} catch (error) {
  console.error('Migration preflight failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch((error) => {
    console.error('Failed to close PostgreSQL preflight connection:', error.message);
    process.exitCode = 1;
  });
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

try {
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: serverDirectory,
    stdio: 'inherit',
  });
} catch (error) {
  console.error('Prisma migration deployment failed. Review the migration status before retrying.');
  process.exitCode = error.status || 1;
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

const verificationClient = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await verificationClient.connect();
  const { rows } = await verificationClient.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  const createdTables = new Set(rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !createdTables.has(table));

  if (missingTables.length > 0) {
    throw new Error(`Migration verification failed; missing table(s): ${missingTables.join(', ')}.`);
  }

  const { rows: foreignKeyRows } = await verificationClient.query(
    `SELECT count(*)::int AS count
     FROM information_schema.table_constraints
     WHERE constraint_schema = 'public'
       AND constraint_type = 'FOREIGN KEY'
       AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  const { rows: checkRows } = await verificationClient.query(
    `SELECT count(*)::int AS count
     FROM information_schema.table_constraints
     WHERE constraint_schema = 'public'
       AND constraint_type = 'CHECK'
       AND table_name = ANY($1::text[])`,
    [requiredTables],
  );

  console.log(
    `Verified ${createdTables.size} application tables, ${foreignKeyRows[0].count} foreign keys, and ${checkRows[0].count} check constraints.`,
  );
} catch (error) {
  console.error('Post-migration verification failed:', error.message);
  process.exitCode = 1;
} finally {
  await verificationClient.end().catch((error) => {
    console.error('Failed to close PostgreSQL verification connection:', error.message);
    process.exitCode = 1;
  });
}
