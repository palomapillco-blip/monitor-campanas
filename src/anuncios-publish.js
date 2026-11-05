// Publica en gh-pages los anuncios de la última corrida de src/anuncios.js, sin pisar lo que publicaron otras
// (el Mac y GitHub Actions pueden capturar el mismo día: por marca y fuente gana la captura que salió bien).
//
//   node src/anuncios-publish.js --from <OUT_DIR de la corrida> [--keep-dashboard]
//   node src/anuncios-publish.js --dashboard     (solo anuncios.html y assets, sin datos)
//
// Igual que src/publish.js: trae lo publicado, mezcla, y empuja un único commit con --force-with-lease (reintenta).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import { ROOT } from './util.js';
import { mergeSource, buildAdsIndex, loadAdsConfig } from './anuncios.js';

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const from = path.resolve(argValue('--from') || ROOT);
const keepDashboard = args.includes('--keep-dashboard');
const dashboardOnly = args.includes('--dashboard');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitConfig = (key) => { try { return git(ROOT, 'config', key); } catch { return ''; } };
const exists = (p) => fs.access(p).then(() => true, () => false);
const remote = process.env.PUBLISH_REMOTE || git(ROOT, 'remote', 'get-url', 'origin');
const author = {
  name: gitConfig('user.name') || 'github-actions[bot]',
  email: gitConfig('user.email') || '41898282+github-actions[bot]@users.noreply.github.com',
};

async function mergeInto(dir, date) {
  if (date) {
    const { brands } = await loadAdsConfig();
    const order = brands.map((b) => b.id);
    const dataDir = path.join(dir, 'anuncios', 'data');
    const imgDir = path.join(dir, 'anuncios', 'img');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(imgDir, { recursive: true });
    const fresh = JSON.parse(await fs.readFile(path.join(from, 'anuncios', 'data', `${date}.json`), 'utf8'));
    const published = JSON.parse(await fs.readFile(path.join(dataDir, `${date}.json`), 'utf8').catch(() => 'null'));
    const day = published
      ? { ...fresh, generatedAt: new Date().toISOString(), meta: mergeSource(fresh.meta, published.meta, order), google: mergeSource(fresh.google, published.google, order) }
      : fresh;
    await fs.writeFile(path.join(dataDir, `${date}.json`), JSON.stringify(day, null, 1));
    // Miniaturas: solo las que usa el día publicado y aún no estaban.
    const used = [...(day.meta?.ads || []), ...(day.google?.ads || [])].map((a) => a.img).filter(Boolean);
    for (const rel of used) {
      const dst = path.join(dir, rel);
      const src = path.join(from, rel);
      if (!(await exists(dst)) && (await exists(src))) await fs.copyFile(src, dst);
    }
    await buildAdsIndex(dataDir);
  }
  if (!keepDashboard || !(await exists(path.join(dir, 'anuncios.html')))) {
    await fs.copyFile(path.join(ROOT, 'anuncios.html'), path.join(dir, 'anuncios.html'));
    await fs.cp(path.join(ROOT, 'assets'), path.join(dir, 'assets'), { recursive: true });
  }
  await fs.writeFile(path.join(dir, '.nojekyll'), '');
}

async function attempt(date) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anuncios-pages-'));
  try {
    git(dir, 'init', '-q', '-b', 'gh-pages');
    let head = '';
    try {
      git(dir, 'fetch', '-q', '--depth=1', remote, 'gh-pages');
      head = git(dir, 'rev-parse', 'FETCH_HEAD');
      execSync('git archive FETCH_HEAD | tar -x', { cwd: dir, stdio: 'ignore' });
    } catch { /* la rama todavía no existe */ }
    await mergeInto(dir, date);
    git(dir, 'add', '-A');
    git(dir, '-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '-q', '-m', date ? `Anuncios ${date}` : 'Actualizar dashboard de anuncios');
    git(dir, 'push', '-q', `--force-with-lease=refs/heads/gh-pages:${head}`, remote, 'HEAD:refs/heads/gh-pages');
    return true;
  } catch (e) {
    console.warn(`  No se pudo publicar: ${String(e.stderr || e.message).trim().split('\n').pop()}`);
    return false;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const run = dashboardOnly ? null : JSON.parse(await fs.readFile(path.join(from, '.last-anuncios.json'), 'utf8').catch(() => 'null'));
if (!dashboardOnly && !run?.date) {
  console.log('Nada que publicar: no hay corrida de anuncios.');
  process.exit(0);
}
for (let i = 1; i <= 5; i++) {
  if (await attempt(run?.date)) {
    console.log(`Publicado en gh-pages: ${run ? `anuncios ${run.date}` : 'dashboard de anuncios'}`);
    process.exit(0);
  }
  if (i < 5) {
    console.log(`  Reintentando en ${i * 15}s (intento ${i + 1}/5)…`);
    await new Promise((r) => setTimeout(r, i * 15000));
  }
}
console.error('No se pudo publicar después de 5 intentos.');
process.exit(1);
