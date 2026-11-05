// Captura diaria de los anuncios de la competencia en Meta Ad Library y Google Ads Transparency Center.
//
//   node src/anuncios.js                       # todas las marcas, Meta y Google
//   node src/anuncios.js --only ripley,wong     # solo algunas marcas (se mezclan con lo ya capturado hoy)
//   node src/anuncios.js --source google        # solo una fuente (meta | google)
//
// Configuración en anuncios.json (campaña, palabra clave, fechas y marcas).
// Escribe en OUT_DIR/anuncios/: data/AAAA-MM-DD.json, data/index.json e img/*.jpg (miniaturas propias: los links de
// imagen de Meta caducan en días). El dashboard es anuncios.html.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createWorker } from 'tesseract.js';
import { ROOT, OUT_DIR, limaDate, isMain } from './util.js';

export const ADS_DIR = path.join(OUT_DIR, 'anuncios');
const DATA = path.join(ADS_DIR, 'data');
const IMG = path.join(ADS_DIR, 'img');
const DAY_RE = /^\d{4}-\d{2}-\d{2}\.json$/;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const only = argValue('--only')?.split(',') ?? null;
const onlySource = argValue('--source');

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const exists = (p) => fs.access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadAdsConfig() {
  return JSON.parse(await fs.readFile(path.join(ROOT, 'anuncios.json'), 'utf8'));
}

// Correcciones a mano de la clasificación Cyber de Google: { "<ad_url>": "Sí" | "No" }.
async function loadOverrides() {
  return JSON.parse(await fs.readFile(path.join(ROOT, 'anuncios-revision.json'), 'utf8').catch(() => '{}'));
}

export async function listAdDays(dataDir = DATA) {
  return (await fs.readdir(dataDir).catch(() => [])).filter((f) => DAY_RE.test(f)).map((f) => f.slice(0, 10)).sort();
}

// ---------- Rasgos del texto ----------
function maxDiscount(t) {
  const m = String(t).match(/(\d{1,2})\s?%/g);
  return m ? Math.max(...m.map((x) => parseInt(x, 10))) : null;
}
const mentionsApp = (t) => /\bapp\b/i.test(t);
const mentionsInstallments = (t) => /cuotas|sin inter[eé]s|tarjeta|\bcmr\b|\boh!|ripley card|banco/i.test(t);

// ---------- Miniaturas ----------
// Descarga una imagen (sin restricciones de CORS, con la sesión del navegador) y guarda una miniatura JPG.
// Devuelve el buffer original (sirve para el OCR) o null.
async function saveThumb(context, resizer, url, file, width) {
  if (!url) return null;
  try {
    const r = await context.request.get(url, { timeout: 30000 });
    if (!r.ok()) return null;
    const buf = await r.body();
    if (await exists(file)) return buf;
    const type = (r.headers()['content-type'] || 'image/jpeg').split(';')[0];
    const dataUrl = await resizer.evaluate(async ({ b64, type, width }) => {
      const img = new Image();
      img.src = `data:${type};base64,${b64}`;
      await img.decode();
      const w = Math.min(width, img.naturalWidth);
      const h = Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      x.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.72);
    }, { b64: buf.toString('base64'), type, width });
    await fs.writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return buf;
  } catch {
    return null;
  }
}

// ---------- Meta ----------
function metaUrl(brand, s) {
  const q = new URLSearchParams({
    active_status: 'active', ad_type: 'all', country: s.country, media_type: 'all',
    q: s.keyword, search_type: 'keyword_unordered', view_all_page_id: brand.metaPageId,
  });
  return `https://www.facebook.com/ads/library/?${q}`;
}

// Corre dentro de la página del Ad Library: recorre la lista (scroll + "Ver más") y lee cada tarjeta.
async function scrapeMetaPage(maxScrolls) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ID_RE = /^(Identificador de la biblioteca|Library ID):\s*(\d+)/;
  const MES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sept: 9, sep: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  const cards = () => [...document.querySelectorAll('span,div')]
    .filter((e) => e.childElementCount === 0 && ID_RE.test(e.textContent.trim()))
    .map((el) => {
      let n = el;
      while (n.parentElement) {
        const p = n.parentElement;
        if ((p.innerText.match(/(Identificador de la biblioteca|Library ID):/g) || []).length > 1) break;
        n = p;
      }
      return n;
    });
  const landing = (h) => { try { const u = new URL(h); if (u.hostname.startsWith('l.facebook.com')) return u.searchParams.get('u') || h; } catch {} return h; };
  const read = (c) => {
    const L = c.innerText.split('\n').map((l) => l.replace(/​/g, '').trim()).filter(Boolean);
    const id = ((L.find((l) => ID_RE.test(l)) || '').match(ID_RE) || [])[2] || '';
    const d = (L.find((l) => /(En circulación desde|Started running on)/i.test(l)) || '').replace(/^(En circulación desde el|Started running on)\s*/i, '');
    let date = d;
    const m = d.match(/^(\d+)\s+(\w+)\.?,?\s+(\d{4})/) || d.match(/^(\w+)\s+(\d+),\s+(\d{4})/);
    if (m) {
      const [day, mon] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
      const mm = MES[mon.toLowerCase().slice(0, 4)] || MES[mon.toLowerCase().slice(0, 3)];
      if (mm) date = `${m[3]}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    const pi = L.findIndex((l) => /^(Publicidad|Sponsored)$/.test(l));
    const rest = pi >= 0 ? L.slice(pi + 1) : [];
    const di = rest.findIndex((l) => /^[A-Z0-9.-]+\.[A-Z]{2,}$/.test(l));
    const cb = di >= 0 ? rest.slice(di) : [];
    const ver = L.find((l) => /varias versiones|multiple versions|anuncios usan este contenido|ads use this/i.test(l)) || '';
    const v = c.querySelector('video');
    let img = v && v.poster ? v.poster : '';
    if (!img) {
      const im = [...c.querySelectorAll('img')].filter((x) => x.clientWidth > 40 || x.naturalWidth > 100)
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      img = im ? im.src : '';
    }
    return {
      id, advertiser: pi > 0 ? L[pi - 1] : '', startDate: date,
      format: v ? 'video' : (c.querySelector('img') ? 'imagen' : ''),
      versions: (ver.match(/^(\d+)/) || [])[1] || (ver ? 'varias' : '1'),
      text: (di >= 0 ? rest.slice(0, di) : rest).join(' '), headline: cb.length > 2 ? cb[1] : '',
      domain: cb[0] || '', cta: cb.length > 1 ? cb[cb.length - 1] : '',
      landingUrl: [...c.querySelectorAll('a')].map((a) => a.href).filter((h) => h.includes('l.facebook.com')).map(landing)[0] || '',
      imageUrl: img,
    };
  };
  const ads = new Map();
  let still = 0;
  for (let i = 0; i < maxScrolls; i++) {
    const before = ads.size;
    cards().forEach((c) => { const a = read(c); if (a.id && !ads.has(a.id)) ads.set(a.id, a); });
    still = ads.size === before ? still + 1 : 0;
    if (still >= 3) break;
    window.scrollTo(0, document.body.scrollHeight);
    const cs = cards(); const last = cs[cs.length - 1];
    // El "Ver más" del final de la lista (no los "Ver más" dentro de cada anuncio, que abren el sitio del anunciante).
    const more = last ? [...document.querySelectorAll('[role=button]')]
      .filter((e) => /^(Ver más|See more)$/.test((e.innerText || '').trim()) && !e.getAttribute('href') && !last.contains(e) && (last.compareDocumentPosition(e) & 4))
      .pop() : null;
    if (more) more.click();
    await sleep(2500);
  }
  return [...ads.values()];
}

async function captureMeta(context, brand, s) {
  const page = await context.newPage();
  const t0 = Date.now();
  try {
    await page.goto(metaUrl(brand, s), { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (/\/login|checkpoint/.test(page.url())) throw new Error('Meta pidió iniciar sesión');
    for (const name of ['Rechazar cookies opcionales', 'Decline optional cookies', 'Permitir todas las cookies', 'Allow all cookies']) {
      const b = page.getByRole('button', { name });
      if (await b.count().catch(() => 0)) { await b.first().click().catch(() => {}); break; }
    }
    await page.waitForFunction(
      () => /(Identificador de la biblioteca|Library ID):|No hay anuncios|No ads match|~?0 resultados|~?0 results/.test(document.body.innerText),
      null, { timeout: 45000 },
    );
    const ads = await page.evaluate(scrapeMetaPage, s.maxScrolls || 60);
    return { status: 'ok', ads, durationMs: Date.now() - t0 };
  } catch (e) {
    return { status: 'error', error: String(e.message || e).split('\n')[0], ads: [], durationMs: Date.now() - t0 };
  } finally {
    await page.close();
  }
}

// ---------- Google ----------
const GOOGLE_RPC = 'https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=0';
const FORMAT = { 1: 'texto', 2: 'imagen', 3: 'video' };
const OWN = /RIPLEY|FALABELLA|TOTTUS|CENCOSUD|MEJORAMIENTO DEL HOGAR|SODIMAC/i;

async function listGoogle(domain, s, from, to) {
  const out = [];
  let token = null;
  for (let p = 0; p < 40; p++) {
    const req = { 2: 100, 3: { 12: { 1: domain, 2: true }, 8: [s.googleRegion], 6: from, 7: to }, 7: { 1: 1, 2: 30, 3: s.googleRegion } };
    if (token) req[4] = token;
    const r = await fetch(GOOGLE_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
      body: 'f.req=' + encodeURIComponent(JSON.stringify(req)),
    });
    if (!r.ok) throw new Error(`Google respondió ${r.status}`);
    const j = await r.json();
    (j[1] || []).forEach((c) => out.push(c));
    token = j[2];
    if (!token || !(j[1] || []).length) break;
    await sleep(400);
  }
  const seen = new Set();
  return out.filter((c) => (seen.has(c[2]) ? false : (seen.add(c[2]), true)));
}

export function extractGoogle(raw) {
  const t = raw.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, '/');
  const grab = (k) => [...t.matchAll(new RegExp(`['"]${k}['"]\\s*:\\s*['"]([^'"]{2,300})['"]`, 'gi'))].map((m) => m[1]);
  const uniq = (a) => [...new Set(a)].filter((x) => !/^https?:/.test(x));
  return {
    heads: uniq([...grab('headline'), ...grab('long_?headline'), ...grab('title')]).slice(0, 4),
    descs: uniq([...grab('description'), ...grab('body')]).slice(0, 3),
    imgs: [...new Set(t.match(/https:\/\/(?:tpc\.googlesyndication\.com\/(?:archive\/)?simgad\/\d+|lh3\.googleusercontent\.com\/[\w\-=]+|i\.ytimg\.com\/vi\/[\w-]+\/\w+\.jpg)/g) || [])],
    content: norm(t),
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- Corrida ----------
async function main() {
  const { settings: s, brands: allBrands } = await loadAdsConfig();
  const brands = allBrands.filter((b) => b.enabled !== false && (!only || only.includes(b.id)));
  const date = limaDate();
  const kw = norm(s.keyword);
  await fs.mkdir(DATA, { recursive: true });
  await fs.mkdir(IMG, { recursive: true });

  const days = await listAdDays();
  const prevDate = days.filter((d) => d < date).pop() ?? null;
  const readDay = async (d) => (d ? JSON.parse(await fs.readFile(path.join(DATA, `${d}.json`), 'utf8').catch(() => 'null')) : null);
  const previous = await readDay(prevDate);
  const today = await readDay(date);
  // Lo ya leído de Google (texto, imagen, clasificación) no se vuelve a descargar.
  const known = new Map([...(previous?.google?.ads || []), ...(today?.google?.ads || [])].map((a) => [a.url, a]));
  const overrides = await loadOverrides();

  console.log(`Anuncios ${date} · ${s.campaign} · "${s.keyword}" · ${brands.length} marcas · comparando con ${prevDate ?? '(sin día anterior)'}`);

  const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, locale: 'es-PE', timezoneId: 'America/Lima', userAgent: UA,
    extraHTTPHeaders: { 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.6' },
  });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const resizer = await context.newPage();
  await resizer.setContent('<!doctype html><title>miniaturas</title>');
  let ocr = null;
  const getOcr = async () => {
    if (!ocr) {
      ocr = await createWorker('spa', 1, { cachePath: path.join(ROOT, '.cache', 'tesseract') });
      await ocr.setParameters({ tessedit_pageseg_mode: '11' });
    }
    return ocr;
  };

  const meta = { brands: [], ads: [] };
  const google = { brands: [], ads: [] };

  // --- Meta ---
  if (onlySource !== 'google') {
    for (const b of brands.filter((x) => x.metaPageId)) {
      const r = await captureMeta(context, b, s);
      const withKw = r.ads.filter((a) => norm(`${a.text} ${a.headline}`).includes(kw));
      for (const a of withKw) {
        const file = path.join(IMG, `meta-${a.id}.jpg`);
        const ok = (await exists(file)) || (await saveThumb(context, resizer, a.imageUrl, file, s.thumbWidth));
        const t = `${a.text} ${a.headline}`;
        meta.ads.push({
          id: a.id, brand: b.id, brandName: b.name, group: b.group, advertiser: a.advertiser, startDate: a.startDate,
          format: a.format, versions: a.versions, text: a.text, headline: a.headline, cta: a.cta, domain: a.domain,
          maxDiscount: maxDiscount(t), app: mentionsApp(t), installments: mentionsInstallments(t),
          landingUrl: a.landingUrl, url: `https://www.facebook.com/ads/library/?id=${a.id}`,
          img: ok ? `anuncios/img/meta-${a.id}.jpg` : null,
        });
      }
      meta.brands.push({ id: b.id, name: b.name, status: r.status, error: r.error ?? null, seen: r.ads.length, count: withKw.length, durationMs: r.durationMs });
      console.log(`${r.status === 'ok' ? '✓' : '✗'} Meta   ${b.name.padEnd(10)} ${String(withKw.length).padStart(3)} con "${s.keyword}" de ${r.ads.length}${r.error ? ' · ' + r.error : ''}`);
    }
  }

  // --- Google ---
  if (onlySource !== 'meta') {
    const from = Number(s.startDate.replace(/-/g, ''));
    const end = s.endDate && s.endDate < date ? s.endDate : date;
    const to = Number(end.replace(/-/g, ''));
    const tFrom = Date.parse(`${s.startDate}T00:00:00Z`) / 1000;
    const iso = (sec) => new Date(Number(sec) * 1000).toISOString().slice(0, 10);
    for (const b of brands.filter((x) => x.googleDomain)) {
      const t0 = Date.now();
      try {
        const creatives = (await listGoogle(b.googleDomain, s, from, to)).filter((c) => +c[6][1] >= tFrom);
        const rows = await pool(creatives, 6, async (c) => {
          const url = `https://adstransparency.google.com/advertiser/${c[1]}/creative/${c[2]}?region=${s.country}`;
          const base = {
            url, creativeId: c[2], brand: b.id, brandName: b.name, advertiser: c[12] || '', thirdParty: !OWN.test(c[12] || ''),
            format: FORMAT[c[4]] || String(c[4]), firstShown: iso(c[6][1]), lastShown: iso(c[7][1]),
          };
          const k = known.get(url);
          if (k) return { ...k, ...base };
          let heads = [], descs = [], imgUrl = '', content = '';
          if (c[3]?.[1]?.[4]) {
            try {
              const raw = await (await fetch(c[3][1][4], { headers: { 'user-agent': UA } })).text();
              const e = extractGoogle(raw);
              heads = e.heads; descs = e.descs; content = e.content;
              imgUrl = e.imgs.find((u) => /ytimg/.test(u)) || e.imgs[0] || '';
            } catch { /* sin contenido */ }
          }
          if (!imgUrl && c[3]?.[3]?.[2]) imgUrl = (c[3][3][2].match(/src="([^"]+)"/) || [])[1] || '';
          const file = path.join(IMG, `google-${c[2]}.jpg`);
          const buf = imgUrl ? await saveThumb(context, resizer, imgUrl, file, s.thumbWidth) : null;
          const txt = norm(`${heads.join(' ')} ${descs.join(' ')}`);
          let cyber = 'Sin dato', method = 'sin dato';
          if (txt.includes(kw)) { cyber = 'Sí'; method = 'texto'; }
          else if (heads.length || descs.length) { cyber = 'No'; method = 'texto'; }
          else if (content.includes(kw)) { cyber = 'Sí'; method = 'contenido'; }
          else if (buf) {
            try {
              const { data } = await (await getOcr()).recognize(buf);
              // El OCR lee mal letras estilizadas: si no encuentra la palabra, el banner queda "Por revisar", no "No".
              if (norm(data.text).replace(/\s+/g, '').includes(kw.replace(/\s+/g, ''))) { cyber = 'Sí'; method = 'ocr'; }
              else { cyber = 'Por revisar'; method = 'ocr'; }
            } catch { cyber = 'Por revisar'; method = 'imagen'; }
          }
          return {
            ...base, headlines: heads.join(' | '), description: descs.join(' | '), cyber, method,
            img: (await exists(file)) ? `anuncios/img/google-${c[2]}.jpg` : null,
          };
        });
        rows.forEach((r) => { if (overrides[r.url]) { r.cyber = overrides[r.url]; r.method = 'revisión manual'; } });
        google.ads.push(...rows);
        google.brands.push({ id: b.id, name: b.name, status: 'ok', error: null, count: rows.length, cyber: rows.filter((r) => r.cyber === 'Sí').length, durationMs: Date.now() - t0 });
        console.log(`✓ Google ${b.name.padEnd(10)} ${String(rows.length).padStart(3)} nuevos desde ${s.startDate} · ${rows.filter((r) => r.cyber === 'Sí').length} Cyber`);
      } catch (e) {
        google.brands.push({ id: b.id, name: b.name, status: 'error', error: String(e.message || e).split('\n')[0], count: 0, cyber: 0, durationMs: Date.now() - t0 });
        console.log(`✗ Google ${b.name.padEnd(10)} ${e.message}`);
      }
    }
  }

  if (ocr) await ocr.terminate();
  await browser.close();

  const order = allBrands.map((x) => x.id);
  const out = {
    date,
    generatedAt: new Date().toISOString(),
    capturedBy: process.env.GITHUB_ACTIONS ? 'github' : 'local',
    comparedWith: prevDate,
    campaign: s.campaign, keyword: s.keyword, startDate: s.startDate, endDate: s.endDate,
    meta: mergeSource(meta, today?.meta, order),
    google: mergeSource(google, today?.google, order),
  };
  await fs.writeFile(path.join(DATA, `${date}.json`), JSON.stringify(out, null, 1));
  await buildAdsIndex();
  await fs.writeFile(path.join(OUT_DIR, '.last-anuncios.json'), JSON.stringify({ date }));
  console.log(`Guardado anuncios/data/${date}.json · Meta ${out.meta.ads.length} · Google ${out.google.ads.length}`);
}

// Mezcla una fuente (meta o google) del día con lo que ya había: una marca que en `fresh` falló o no se corrió
// conserva lo anterior. Así el Mac y GitHub Actions pueden capturar el mismo día sin pisarse.
export function mergeSource(fresh, old, order = []) {
  if (!old) return fresh;
  if (!fresh) return old;
  const keepOld = (old.brands || []).filter((ob) => {
    const nb = fresh.brands.find((x) => x.id === ob.id);
    return !nb || (nb.status !== 'ok' && ob.status === 'ok');
  }).map((x) => x.id);
  const brands = [...(old.brands || []).filter((x) => keepOld.includes(x.id)), ...fresh.brands.filter((x) => !keepOld.includes(x.id))];
  const ads = [...(old.ads || []).filter((a) => keepOld.includes(a.brand)), ...fresh.ads.filter((a) => !keepOld.includes(a.brand))];
  brands.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
  return { brands, ads };
}

// data/index.json: lista de días con totales, para el selector de días del dashboard.
export async function buildAdsIndex(dataDir = DATA) {
  const days = [];
  for (const d of await listAdDays(dataDir)) {
    const j = JSON.parse(await fs.readFile(path.join(dataDir, `${d}.json`), 'utf8'));
    days.push({ date: d, campaign: j.campaign, meta: j.meta?.ads?.length ?? 0, google: j.google?.ads?.length ?? 0 });
  }
  const index = { updatedAt: new Date().toISOString(), latest: days.at(-1)?.date ?? null, days };
  await fs.writeFile(path.join(dataDir, 'index.json'), JSON.stringify(index, null, 1));
  return index;
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
