// Corrida en este computador para los sitios con "runner": "local" en sites.json (p. ej. Ripley, que bloquea
// las visitas desde los servidores de GitHub): trae lo publicado, captura, y publica en gh-pages.
//
//   npm run monitor:local
//
// La tarea programada del Mac (scripts/install-mac-schedule.sh) ejecuta exactamente esto.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { ROOT } from './util.js';

const STAGE = path.join(ROOT, '.cache', 'local-site');
const stamp = () => new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });

console.log(`\n=== Corrida local · ${stamp()} ===`);
await fs.rm(STAGE, { recursive: true, force: true });
await fs.mkdir(STAGE, { recursive: true });

// Lo publicado: hace falta para comparar con el día anterior.
try {
  execSync('git fetch -q origin gh-pages && git archive FETCH_HEAD | tar -x -C .cache/local-site', { cwd: ROOT, stdio: 'inherit' });
} catch {
  console.warn('No se pudo traer gh-pages (¿primera vez o sin conexión?). Se sigue sin día anterior.');
}

const node = (script, extra = [], env = {}) =>
  spawnSync(process.execPath, ['--no-deprecation', script, ...extra], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } }).status;

if (node('src/monitor.js', [], { OUT_DIR: STAGE, MONITOR_RUNNER: 'local' }) !== 0) process.exit(1);
const status = node('src/publish.js', ['--from', STAGE, '--keep-dashboard']);
console.log(`=== Fin · ${stamp()} · ${status === 0 ? 'OK' : 'con errores'} ===`);
process.exit(status ?? 1);
