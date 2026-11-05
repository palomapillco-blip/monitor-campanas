// Publica en la rama gh-pages lo que capturó la última corrida, sin pisar lo que publicaron otras
// (el Mac publica todas las tiendas cada mañana; GitHub Actions, las que falten).
//
//   node src/publish.js --from <carpeta OUT_DIR de la corrida> [--keep-dashboard]
//   node src/publish.js --dashboard        (solo el dashboard, index.json y el Excel, sin capturas)
//
// Cada intento trae la versión publicada más reciente, reemplaza solo los sitios de esta corrida en el
// JSON del día y empuja un único commit con --force-with-lease: si alguien publicó en el medio, reintenta.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import { ROOT, limaDate, loadConfig } from './util.js';
import { buildIndex } from './build-index.js';
import { pruneScreenshots } from './prune.js';

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const from = path.resolve(argValue('--from') || ROOT);
// El Mac no actualiza el dashboard (index.html/assets): eso lo hace GitHub Actions desde main.
const keepDashboard = args.includes('--keep-dashboard');
// GitHub Actions lo usa cuando se sube a main un cambio del dashboard: si no, recién se vería con su próxima captura.
const dashboardOnly = args.includes('--dashboard');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitConfig = (key) => {
  try { return git(ROOT, 'config', key); } catch { return ''; }
};
const exists = (p) => fs.access(p).then(() => true, () => false);

const remote = process.env.PUBLISH_REMOTE || git(ROOT, 'remote', 'get-url', 'origin');
const author = {
  name: gitConfig('user.name') || 'github-actions[bot]',
  email: gitConfig('user.email') || '41898282+github-actions[bot]@users.noreply.github.com',
};

async function mergeDay(dir, run, srcDay) {
  const { sites: config } = await loadConfig();
  const order = config.map((s) => s.id);
  const dayFile = path.join(dir, 'data', `${run.date}.json`);
  await fs.mkdir(path.dirname(dayFile), { recursive: true });
  const published = JSON.parse(await fs.readFile(dayFile, 'utf8').catch(() => 'null'));

  // Una captura con problemas no reemplaza a una buena: el Mac y GitHub pueden capturar la misma tienda el mismo día.
  const fresh = srcDay.sites.filter((s) => run.sites.includes(s.id));
  const worse = (s) => s.status === 'ok' && fresh.some((f) => f.id === s.id && f.status !== 'ok');
  const kept = (published?.sites || []).filter((s) => order.includes(s.id) && (!run.sites.includes(s.id) || worse(s)));
  const updated = fresh.filter((f) => !kept.some((s) => s.id === f.id));
  const sites = [...kept, ...updated].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const day = { ...(published || srcDay), generatedAt: new Date().toISOString(), comparedWith: srcDay.comparedWith ?? published?.comparedWith ?? null, sites };
  await fs.writeFile(dayFile, JSON.stringify(day, null, 1));

  const shotsDir = path.join(dir, 'screenshots', run.date);
  await fs.mkdir(shotsDir, { recursive: true });
  for (const { id } of updated) {
    for (const kind of ['hero', 'full']) {
      const f = `${id}-${kind}.jpg`;
      const src = path.join(from, 'screenshots', run.date, f);
      if (await exists(src)) await fs.copyFile(src, path.join(shotsDir, f));
    }
  }
}

async function mergeInto(dir, run, srcDay) {
  if (srcDay) await mergeDay(dir, run, srcDay);
  if (!keepDashboard || !(await exists(path.join(dir, 'index.html')))) {
    await fs.copyFile(path.join(ROOT, 'index.html'), path.join(dir, 'index.html'));
    await fs.cp(path.join(ROOT, 'assets'), path.join(dir, 'assets'), { recursive: true });
  }
  await fs.writeFile(path.join(dir, '.nojekyll'), '');
  await pruneScreenshots(path.join(dir, 'screenshots'));
  await buildIndex(path.join(dir, 'data'));
}

async function attempt(run, srcDay) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-pages-'));
  try {
    git(dir, 'init', '-q', '-b', 'gh-pages');
    let head = '';
    try {
      git(dir, 'fetch', '-q', '--depth=1', remote, 'gh-pages');
      head = git(dir, 'rev-parse', 'FETCH_HEAD');
      execSync('git archive FETCH_HEAD | tar -x', { cwd: dir, stdio: 'ignore' });
    } catch {
      // La rama todavía no existe: se crea.
    }
    await mergeInto(dir, run, srcDay);
    git(dir, 'add', '-A');
    const message = srcDay ? `Monitor ${run.date} · ${run.sites.join(', ')}` : 'Actualizar dashboard';
    git(dir, '-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '-q', '-m', message);
    // Un solo commit sin historial (las imágenes no se acumulan), pero solo si nadie publicó desde que lo trajimos.
    git(dir, 'push', '-q', `--force-with-lease=refs/heads/gh-pages:${head}`, remote, 'HEAD:refs/heads/gh-pages');
    return true;
  } catch (e) {
    console.warn(`  No se pudo publicar: ${String(e.stderr || e.message).trim().split('\n').pop()}`);
    return false;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const run = dashboardOnly
  ? { date: limaDate(), sites: [] }
  : JSON.parse(await fs.readFile(path.join(from, '.last-run.json'), 'utf8').catch(() => 'null'));
if (!dashboardOnly && !run?.sites?.length) {
  console.log('Nada que publicar: la última corrida no capturó sitios.');
  process.exit(0);
}
const srcDay = dashboardOnly ? null : JSON.parse(await fs.readFile(path.join(from, 'data', `${run.date}.json`), 'utf8'));

for (let i = 1; i <= 5; i++) {
  if (await attempt(run, srcDay)) {
    console.log(`Publicado en gh-pages: ${srcDay ? `${run.date} · ${run.sites.join(', ')}` : 'dashboard'}`);
    process.exit(0);
  }
  if (i < 5) {
    console.log(`  Reintentando en ${i * 15}s (intento ${i + 1}/5)…`);
    await new Promise((r) => setTimeout(r, i * 15000));
  }
}
console.error('No se pudo publicar después de 5 intentos.');
process.exit(1);
