import { spawnSync } from 'node:child_process';

const dockerCheck = spawnSync('docker', ['--version'], { stdio: 'ignore' });
if (dockerCheck.error || dockerCheck.status !== 0) {
  console.error('Docker non trovato.');
  console.error('Installa Docker Desktop oppure usa il percorso Postgres via Homebrew indicato nel README.');
  process.exit(1);
}

const composeCheck = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
if (composeCheck.error || composeCheck.status !== 0) {
  console.error('Docker trovato ma "docker compose" non disponibile.');
  console.error('Aggiorna Docker Desktop o usa il percorso Postgres via Homebrew indicato nel README.');
  process.exit(1);
}
