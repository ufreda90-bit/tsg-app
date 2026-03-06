import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
const hasMigrations = fs.existsSync(migrationsDir) && fs.readdirSync(migrationsDir).some((entry) => entry && entry !== '.DS_Store');

const args = ['prisma', 'migrate', 'dev', '--schema=prisma/schema.prisma'];
if (!hasMigrations) {
  args.push('--name', 'init');
}

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npxCmd, args, { stdio: 'inherit' });

process.exit(result.status ?? 1);
