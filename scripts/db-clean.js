import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const prismaClientDir = path.join(root, 'node_modules', '.prisma');
const sqliteDb = path.join(root, 'prisma', 'dev.db');

const removePath = (target) => {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
};

removePath(prismaClientDir);
removePath(sqliteDb);

console.log('Pulizia completata:', [prismaClientDir, sqliteDb].join(', '));
