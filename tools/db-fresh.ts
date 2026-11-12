import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = resolve(__dirname, '..');
const apiDir = resolve(rootDir, 'apps/api');
const freshScript = resolve(apiDir, 'prisma/fresh.ts');
const tsxLoader = pathToFileURL(resolve(apiDir, 'node_modules/tsx/dist/loader.mjs')).href;
const envFile = resolve(rootDir, '.env');

const rawArgs = process.argv.slice(2);
const argsString = rawArgs.map((arg) => `"${arg}"`).join(' ');

const cmd = `node --env-file="${envFile}" --import "${tsxLoader}" "${freshScript}" ${argsString}`;

try {
  execSync(cmd, {
    cwd: apiDir,
    stdio: 'inherit',
    env: process.env,
  });
} catch (error) {
  process.exit(1);
}
