import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Ensure environment variables are loaded
try {
  const rootEnv = resolve(process.cwd(), '../../.env');
  const directEnv = resolve(process.cwd(), '.env');
  if (typeof process.loadEnvFile === 'function') {
    if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
    else if (existsSync(directEnv)) process.loadEnvFile(directEnv);
  }
} catch {
  // Environment already populated
}

const args = process.argv.slice(2);
const shouldSeed = args.includes('--seed') || args.includes('-s');
const isForced = args.includes('--force') || args.includes('-f');
const isHelp = args.includes('--help') || args.includes('-h');

if (isHelp) {
  console.info(`
DailyDose V2 - Database Migrate Fresh Runner (Equivalent to Laravel 'php artisan migrate:fresh')

Usage:
  pnpm db:fresh [options]
  node prisma/fresh.ts [options]

Options:
  -s, --seed    Seed the database with complete master and operational data
  -f, --force   Force the operation to run in production environment
  -h, --help    Show this help message

Examples:
  pnpm db:fresh             # Drops all tables and recreates clean schema
  pnpm db:fresh --seed      # Drops all tables, recreates schema, and seeds data
`);
  process.exit(0);
}

if (process.env.NODE_ENV === 'production' && !isForced) {
  console.error('⚠️  CRITICAL: Database fresh requested in PRODUCTION environment! Aborted. Use --force to override.');
  process.exit(1);
}

async function dropAllDatabaseObjects(): Promise<void> {
  // Load PrismaClient only inside a short-lived child process so Windows releases query_engine DLL locks before `prisma generate`.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    console.info('⏳ [Step 1/3] Inspecting database objects to drop...');

    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0;');

    const views: Array<{ TABLE_NAME?: string; table_name?: string }> = await prisma.$queryRawUnsafe(`
      SELECT table_name AS TABLE_NAME 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_type = 'VIEW';
    `);

    if (views.length > 0) {
      console.info(`🗑️  Dropping ${views.length} existing view(s)...`);
      for (const viewRow of views) {
        const viewName = viewRow.TABLE_NAME || viewRow.table_name;
        if (viewName) {
          await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS \`${viewName}\`;`);
        }
      }
    }

    const tables: Array<{ TABLE_NAME?: string; table_name?: string }> = await prisma.$queryRawUnsafe(`
      SELECT table_name AS TABLE_NAME 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
    `);

    console.info(`🗑️  Dropping ${tables.length} existing table(s) (including legacy/orphaned tables)...`);
    for (const tableRow of tables) {
      const tableName = tableRow.TABLE_NAME || tableRow.table_name;
      if (tableName) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS \`${tableName}\`;`);
      }
    }

    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1;');
    console.info(`✨ Successfully dropped all ${tables.length} table(s) and ${views.length} view(s). Database is completely clean.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

async function runMigrateFresh() {
  if (args.includes('--internal-drop')) {
    await dropAllDatabaseObjects();
    return;
  }

  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  // Parse target database for logging
  try {
    const parsed = new URL(rawDbUrl.replace(/^mysql:\/\//, 'http://'));
    const dbName = parsed.pathname.replace(/^\//, '');
    console.info(`========================================================`);
    console.info(`🚀 DailyDose V2: Database Migrate Fresh`);
    console.info(`========================================================`);
    console.info(`📍 Target Database : ${dbName}`);
    console.info(`📍 Server Host     : ${parsed.hostname}:${parsed.port || '3306'}`);
    console.info(`📍 Seed Mode       : ${shouldSeed ? 'ENABLED (--seed)' : 'DISABLED'}`);
    console.info(`========================================================\n`);
  } catch {
    console.info('🚀 DailyDose V2: Database Migrate Fresh starting...\n');
  }

  const apiDir = resolve(__dirname, '..');
  const prismaBin = resolve(apiDir, 'node_modules/prisma/build/index.js');
  const tsxLoader = pathToFileURL(resolve(apiDir, 'node_modules/tsx/dist/loader.mjs')).href;
  const envFile = existsSync(resolve(process.cwd(), '.env'))
    ? resolve(process.cwd(), '.env')
    : resolve(process.cwd(), '../../.env');
  const envFlag = existsSync(envFile) ? `--env-file="${envFile}" ` : '';

  execSync(`"${process.execPath}" ${envFlag}--import "${tsxLoader}" "${__filename}" --internal-drop`, {
    cwd: apiDir,
    stdio: 'inherit',
    env: process.env,
  });

  // Step 2: Push clean schema using Prisma CLI
  console.info('⏳ [Step 2/3] Pushing clean Prisma schema (schema.prisma)...');

  const pushCmd = `node ${envFlag}"${prismaBin}" db push --config prisma.config.ts --accept-data-loss --skip-generate`;
  execSync(pushCmd, {
    cwd: apiDir,
    stdio: 'inherit',
    env: process.env,
  });

  const generateCmd = `node ${envFlag}"${prismaBin}" generate --config prisma.config.ts`;
  execSync(generateCmd, {
    cwd: apiDir,
    stdio: 'inherit',
    env: process.env,
  });

  console.info('\n✅ Fresh schema applied successfully (all 20 v2_* models created).\n');

  // Step 3: Optional Seeding
  if (shouldSeed) {
    console.info('⏳ [Step 3/3] Seeding database with fresh master & operational data...');
    const seedScript = resolve(__dirname, 'seed.ts');
    const seedCmd = `node ${envFlag}--import "${tsxLoader}" "${seedScript}"`;
    
    execSync(seedCmd, {
      cwd: apiDir,
      stdio: 'inherit',
      env: process.env,
    });

    console.info('\n🌱 Database seeded successfully!');
  } else {
    console.info('ℹ️  [Step 3/3] Skipping seed (run with --seed or use `pnpm db:fresh --seed` to seed).\n');
  }

  console.info(`========================================================`);
  console.info(`🎉 MIGRATE FRESH COMPLETE! Database is ready.`);
  console.info(`========================================================\n`);
}

runMigrateFresh().catch((err: unknown) => {
  console.error('\n❌ Migrate fresh failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
