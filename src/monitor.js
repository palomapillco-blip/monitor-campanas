// Corre el monitoreo del día: node src/monitor.js [--only falabella,ripley]
// MONITOR_RUNNER=github|local corre solo los sitios de ese runner ("runner" en sites.json, por defecto github).
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createWorker } from 'tesseract.js';
import { captureSite } from './capture.js';
import { detectSignals, diffSignals } from './signals.js';
import { buildIndex } from './build-index.js';
import { ROOT, OUT_DIR, DATA_DIR, SHOTS_DIR, limaDate, loadConfig, findPreviousDay } from './util.js';

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1]?.split(',') : null;
const runner = process.env.MONITOR_RUNNER || null;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function main() {
  const { settings, sites: allSites } = await loadConfig();
  const sites = allSites.filter(
    (s) => s.enabled !== false && (!only || only.includes(s.id)) && (!runner || (s.runner || 'github') === runner)
  );
  const date = limaDate();
  const shotsDir = path.join(SHOTS_DIR, date);
  await fs.mkdir(shotsDir, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });

  const outFile = path.join(DATA_DIR, `${date}.json`);
  const previous = await findPreviousDay(date);
  // Conserva los sitios ya capturados hoy que esta corrida no visita (--only, u otro runner).
  const existing = JSON.parse(await fs.readFile(outFile, 'utf8').catch(() => 'null'));
  const lastRunFile = path.join(OUT_DIR, '.last-run.json');

  console.log(`Monitoreo ${date} · ${sites.length} sitios${runner ? ` (${runner})` : ''} · comparando con ${previous?.date ?? '(sin día anterior)'}`);
  if (!sites.length) {
    await fs.writeFile(lastRunFile, JSON.stringify({ date, sites: [] }));
    return;
  }

  const browser = await chromium.launch({
    headless: true,
    // Chromium completo (headless nuevo) en vez del "headless shell": algunos sitios, como Ripley, no renderizan su contenido en el shell.
    channel: 'chromium',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ocr = await createWorker(settings.ocrLang, 1, { cachePath: path.join(ROOT, '.cache', 'tesseract') });
  // PSM 11 = texto disperso: rinde mejor en banners que el modo de "página" por defecto.
  await ocr.setParameters({ tessedit_pageseg_mode: '11' });

  const results = [];
  for (const site of sites) {
    const context = await browser.newContext({
      viewport: settings.viewport,
      deviceScaleFactor: 2,
      locale: settings.locale,
      timezoneId: settings.timezoneId,
      userAgent: UA,
      extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.6' },
      geolocation: { latitude: -12.0464, longitude: -77.0428 },
      permissions: [],
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const rel = (f) => path.posix.join('screenshots', date, f);
    const paths = { hero: path.join(shotsDir, `${site.id}-hero.jpg`), full: path.join(shotsDir, `${site.id}-full.jpg`) };

    const cap = await captureSite(context, site, settings, paths);
    await context.close();

    const ocrParts = [];
    for (const img of cap.ocrImages || []) {
      try {
        const { data } = await ocr.recognize(img);
        ocrParts.push(data.text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim());
      } catch (e) {
        console.warn(`  OCR falló: ${e.message}`);
      }
    }
    const ocrText = ocrParts.join('\n----\n');

    const c = cap.content || { title: '', visibleText: '', alts: [], banners: [], countdowns: [] };
    const chunks = [
      { source: 'title', text: c.title },
      { source: 'ocr', text: ocrText },
      { source: 'banner', text: c.banners.join('\n') },
      { source: 'alt', text: c.alts.join('\n') },
      { source: 'countdown', text: c.countdowns.join('\n') },
      { source: 'text', text: c.visibleText },
    ];
    const { signals, summary } = detectSignals(chunks);
    if (c.countdowns.length && !signals.some((s) => s.key === 'urgency:Contador')) {
      signals.push({ type: 'urgency', key: 'urgency:Contador', value: 'Contador', label: 'Contador regresivo', snippet: c.countdowns[0], sources: ['dom'], count: 1 });
      summary.urgency.push('Contador');
    }

    const prevSite = previous?.data.sites.find((s) => s.id === site.id);
    const canCompare = prevSite && prevSite.status === 'ok' && cap.status === 'ok';
    const diff = canCompare ? diffSignals(signals, prevSite.signals) : { baseline: !prevSite, added: [], removed: [], skipped: Boolean(prevSite) };
    const addedSet = new Set(diff.added);
    for (const s of signals) s.isNew = addedSet.has(s.key);

    const shotExists = async (p) => fs.access(p).then(() => true, () => false);
    results.push({
      id: site.id,
      name: site.name,
      url: site.url,
      capturedBy: process.env.GITHUB_ACTIONS ? 'github' : 'local',
      finalUrl: cap.finalUrl ?? null,
      status: cap.status,
      httpStatus: cap.httpStatus ?? null,
      error: cap.error ?? null,
      title: c.title,
      capturedAt: new Date().toISOString(),
      durationMs: cap.durationMs,
      popupsClosed: cap.popupsClosed,
      overlaysRemoved: cap.overlaysRemoved,
      pageHeight: c.scrollHeight ?? null,
      screenshots: {
        hero: (await shotExists(paths.hero)) ? rel(`${site.id}-hero.jpg`) : null,
        full: (await shotExists(paths.full)) ? rel(`${site.id}-full.jpg`) : null,
      },
      summary,
      signals,
      diff,
      extracted: {
        ocr: ocrText,
        banners: c.banners,
        alts: c.alts,
        countdowns: c.countdowns,
        visibleText: c.visibleText.slice(0, 20000),
      },
    });

    const flag = { ok: '✓', partial: '~', blocked: '⛔', error: '✗' }[cap.status];
    console.log(`${flag} ${site.name.padEnd(14)} ${cap.status.padEnd(7)} ${(cap.durationMs / 1000).toFixed(1)}s · ${signals.filter((s) => s.type !== 'price').length} señales · +${diff.added.length} −${diff.removed.length}${cap.error ? ' · ' + cap.error : ''}`);
  }

  await ocr.terminate();
  await browser.close();

  const order = allSites.map((s) => s.id);
  const merged = [
    ...(existing?.sites || []).filter((s) => order.includes(s.id) && !results.some((r) => r.id === s.id)),
    ...results,
  ];
  merged.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const out = {
    date,
    generatedAt: new Date().toISOString(),
    comparedWith: previous?.date ?? null,
    sites: merged,
  };
  await fs.writeFile(outFile, JSON.stringify(out, null, 1));
  // Para src/publish.js: qué sitios capturó esta corrida.
  await fs.writeFile(lastRunFile, JSON.stringify({ date, sites: results.map((r) => r.id) }));
  await buildIndex();
  console.log(`Guardado ${path.relative(OUT_DIR, outFile)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
