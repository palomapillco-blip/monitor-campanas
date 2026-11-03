// Dashboard: lee data/index.json y data/AAAA-MM-DD.json. Estado en el hash: #AAAA-MM-DD/tab
const TYPE_LABEL = {
  campaign: 'Campaña',
  discount: 'Descuentos',
  card: 'Tarjeta propia',
  bank: 'Bancos / pagos',
  installments: 'Cuotas s/i',
  coupon: 'Cupones',
  multibuy: 'Multicompra',
  urgency: 'Urgencia',
  shipping: 'Envío / retiro',
  category: 'Categorías',
};
const TYPE_ORDER = Object.keys(TYPE_LABEL);
const STATUS_LABEL = { ok: 'OK', partial: 'Parcial', blocked: 'Bloqueado', error: 'Error' };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' });

const state = { index: null, date: null, tab: 'resumen', day: null, cache: new Map(), filter: { q: '', type: '', onlyNew: false } };

function chip(sig, extra = '') {
  const cls = ['chip', sig.isNew ? 'new' : '', extra].filter(Boolean).join(' ');
  return `<span class="${cls}" style="--c: var(--t-${sig.type})" title="${esc(sig.snippet || '')}${sig.sources ? ' · fuente: ' + esc(sig.sources.join(', ')) : ''}">${esc(sig.label)}</span>`;
}
const goneChip = (s) => `<span class="chip gone" title="Estaba el día anterior">${esc(s.label)}</span>`;

async function loadJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function loadDay(date) {
  if (!state.cache.has(date)) state.cache.set(date, await loadJSON(`data/${date}.json`));
  return state.cache.get(date);
}

function readHash() {
  const [d, t] = location.hash.slice(1).split('/');
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null, tab: t || null };
}

function writeHash() {
  history.replaceState(null, '', `#${state.date}/${state.tab}`);
}

async function init() {
  try {
    state.index = await loadJSON('data/index.json');
  } catch {
    $('#download').hidden = true;
    $('#view').innerHTML = `<div class="panel empty">Todavía no hay datos. Corre <code>npm run monitor</code> o espera la primera ejecución diaria.</div>`;
    return;
  }
  const dates = state.index.days.map((d) => d.date);
  const h = readHash();
  state.date = dates.includes(h.date) ? h.date : state.index.latest;
  state.tab = ['resumen', 'tiendas', 'cambios', 'historial'].includes(h.tab) ? h.tab : 'resumen';

  const sel = $('#daySelect');
  sel.innerHTML = [...dates].reverse().map((d) => `<option value="${d}">${fmtDate(d)}</option>`).join('');
  sel.onchange = () => go(sel.value);
  $('#prevDay').onclick = () => go(dates[dates.indexOf(state.date) - 1]);
  $('#nextDay').onclick = () => go(dates[dates.indexOf(state.date) + 1]);
  $('#download').onclick = downloadReport;
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; render(); }));
  window.addEventListener('hashchange', () => {
    const n = readHash();
    if (n.date && n.date !== state.date && dates.includes(n.date)) go(n.date);
    else if (n.tab && n.tab !== state.tab) { state.tab = n.tab; render(); }
  });
  await go(state.date);
}

async function go(date) {
  if (!date) return;
  state.date = date;
  state.day = await loadDay(date);
  render();
}

function render() {
  const dates = state.index.days.map((d) => d.date);
  const i = dates.indexOf(state.date);
  $('#daySelect').value = state.date;
  $('#prevDay').disabled = i <= 0;
  $('#nextDay').disabled = i >= dates.length - 1;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  writeHash();

  const day = state.day;
  $('#meta').innerHTML = metaHtml(day);
  $('#kpis').innerHTML = kpisHtml(day);
  const view = { resumen: renderSummary, tiendas: renderStores, cambios: renderChanges, historial: renderHistory }[state.tab];
  $('#view').innerHTML = view(day);
  bindView();
}

const metaHtml = (day) => `Captura del ${fmtDate(day.date)} · ${fmtTime(day.generatedAt)} (hora Lima)` +
  (day.comparedWith ? ` · comparado con ${fmtDate(day.comparedWith)}` : ' · primer día: sin comparación');

function kpisHtml(day) {
  const ok = day.sites.filter((s) => s.status === 'ok').length;
  const bad = day.sites.length - ok;
  const campaigns = new Set(day.sites.flatMap((s) => s.summary?.campaigns || []));
  const added = day.sites.reduce((n, s) => n + (s.diff?.added?.length || 0), 0);
  const removed = day.sites.reduce((n, s) => n + (s.diff?.removed?.length || 0), 0);
  const maxD = Math.max(0, ...day.sites.map((s) => Math.max(s.summary?.maxDiscount || 0, s.summary?.maxProductDiscount || 0)));
  const coupons = day.sites.reduce((n, s) => n + (s.summary?.coupons?.length || 0), 0);
  const k = (v, l, cls = '') => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  return [
    k(`${ok}/${day.sites.length}`, bad ? `tiendas capturadas · ${bad} con problema` : 'tiendas capturadas', bad ? 'bad' : ''),
    k(campaigns.size, campaigns.size ? [...campaigns].slice(0, 3).join(', ') : 'campañas detectadas'),
    k(maxD ? `${maxD}%` : '—', 'descuento máximo visto'),
    k(coupons, 'cupones detectados'),
    k(day.comparedWith ? `+${added}` : '—', 'mecánicas nuevas', added ? 'good' : ''),
    k(day.comparedWith ? `−${removed}` : '—', 'mecánicas que salieron', removed ? 'bad' : ''),
  ].join('');
}

const byType = (site, t) => (site.signals || []).filter((s) => s.type === t);
const list = (sigs, max = 4) => {
  if (!sigs.length) return '<span class="dim">—</span>';
  const more = sigs.length > max ? `<span class="dim">+${sigs.length - max}</span>` : '';
  return `<div class="cell-list">${sigs.slice(0, max).map((s) => chip(s)).join('')}${more}</div>`;
};
const statusBadge = (s) => `<span class="badge ${s.status}">${STATUS_LABEL[s.status] || s.status}</span>`;

// En el reporte descargado los links a tiendas apuntan a su tarjeta dentro del mismo archivo.
function renderSummary(day, { report = false } = {}) {
  const rows = day.sites.map((s) => {
    const sm = s.summary || {};
    const disc = sm.maxDiscount ? `${sm.maxDiscount}%` : '—';
    const prod = sm.maxProductDiscount ? `<div class="dim">productos hasta ${sm.maxProductDiscount}%</div>` : '';
    const delta = day.comparedWith && s.diff && !s.diff.skipped
      ? `<span class="delta-add">+${s.diff.added.length}</span> <span class="delta-del">−${s.diff.removed.length}</span>`
      : '<span class="dim">—</span>';
    return `<tr>
      <td class="store"><a href="${report ? `#site-${s.id}` : `#${day.date}/tiendas" data-jump="${s.id}`}">${esc(s.name)}</a><div>${statusBadge(s)}</div></td>
      <td>${list(byType(s, 'campaign'), 3)}</td>
      <td class="num">${disc}${prod}</td>
      <td>${list([...byType(s, 'card'), ...byType(s, 'bank')], 3)}</td>
      <td>${list(byType(s, 'installments'), 2)}</td>
      <td>${list(byType(s, 'coupon'), 3)}</td>
      <td>${list(byType(s, 'multibuy'), 3)}</td>
      <td>${list(byType(s, 'urgency'), 3)}</td>
      <td>${list(byType(s, 'shipping'), 2)}</td>
      <td class="num">${delta}</td>
    </tr>`;
  });
  return `<div class="panel scroll-x"><table>
    <thead><tr><th>Tienda</th><th>Campaña</th><th>Dscto máx.</th><th>Tarjeta / pago</th><th>Cuotas s/i</th><th>Cupones</th><th>Multicompra</th><th>Urgencia</th><th>Envío</th><th>vs. ayer</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>
    <p class="legend">Pasa el mouse sobre una etiqueta para ver el texto donde se detectó. Las etiquetas con borde verde son nuevas respecto al día anterior.</p>`;
}

function siteMatches(sig) {
  const f = state.filter;
  if (f.type && sig.type !== f.type) return false;
  if (f.onlyNew && !sig.isNew) return false;
  if (f.q && !`${sig.label} ${sig.snippet}`.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}

function filtersBar() {
  const f = state.filter;
  return `<div class="filters">
    <input type="search" id="fq" placeholder="Buscar (ej. CMR, 2x1, cupón)" value="${esc(f.q)}">
    <select id="ftype"><option value="">Todas las señales</option>${TYPE_ORDER.map((t) => `<option value="${t}" ${f.type === t ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}</select>
    <label><input type="checkbox" id="fnew" ${f.onlyNew ? 'checked' : ''}> Solo novedades</label>
  </div>`;
}

function renderStores(day) {
  return filtersBar() + `<div class="cards">${day.sites.map((s) => storeCard(s)).join('')}</div>`;
}

// En el reporte descargado no hay filtros, la imagen va incrustada (heroSrc) y la página completa se abre en línea.
function storeCard(s, { report = false, heroSrc = s.screenshots?.hero } = {}) {
  const f = report ? { q: '', type: '', onlyNew: false } : state.filter;
  const sigs = (s.signals || []).filter((x) => x.type !== 'price' && (report || siteMatches(x)));
  const groups = TYPE_ORDER.map((t) => {
    const g = sigs.filter((x) => x.type === t);
    return g.length ? `<div class="group"><div class="gl">${TYPE_LABEL[t]}</div><div class="gv">${g.map((x) => chip(x)).join('')}</div></div>` : '';
  }).join('');
  const removed = (s.diff?.removed || []).filter((x) => (!f.type || x.type === f.type));
  const sm = s.summary || {};
  const prices = sm.priceCount ? `<div class="group"><div class="gl">Precios</div><div class="gv dim">${sm.priceCount} precios en soles · S/ ${sm.minPrice} – S/ ${sm.maxPrice}${sm.productDiscountCount ? ` · ${sm.productDiscountCount} badges de dscto (máx. ${sm.maxProductDiscount}%)` : ''}</div></div>` : '';
  const full = s.screenshots?.full;
  const img = heroSrc ? `<img ${report ? '' : 'loading="lazy" '}src="${esc(heroSrc)}" alt="Primera pantalla de ${esc(s.name)}">` : '';
  const hero = !img
    ? `<div class="thumb nothumb">Sin captura</div>`
    : report
      ? `<a class="thumb" href="${esc(absUrl(full || s.screenshots.hero))}" target="_blank" rel="noopener">${img}</a>`
      : `<button class="thumb" data-shot="${esc(full || s.screenshots.hero)}" data-title="${esc(s.name)}">${img}</button>`;
  const fullLink = !full ? ''
    : report
      ? `<a href="${esc(absUrl(full))}" target="_blank" rel="noopener">página completa ↗</a>`
      : `<a href="#" data-shot="${esc(full)}" data-title="${esc(s.name)} · página completa">página completa</a>`;
  return `<article class="card" id="site-${s.id}">
    ${hero}
    <div class="card-body">
      <div class="card-head">
        <h3>${esc(s.name)} ${statusBadge(s)}</h3>
        <div class="links">
          ${fullLink}
          <a href="${esc(s.url)}" target="_blank" rel="noopener">sitio ↗</a>
        </div>
      </div>
      ${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
      ${s.status === 'blocked' ? `<div class="err">El sitio bloqueó la visita automática (título: “${esc(s.title)}”).</div>` : ''}
      ${groups || '<div class="dim">Sin señales con este filtro.</div>'}
      ${removed.length && !f.onlyNew ? `<div class="group"><div class="gl">Salieron</div><div class="gv">${removed.map(goneChip).join('')}</div></div>` : ''}
      ${f.type || f.onlyNew ? '' : prices}
      <details><summary>Texto leído (OCR del hero y banners)</summary>
        <pre>${esc((s.extracted?.ocr || '').slice(0, 3000))}</pre>
        <pre>${esc((s.extracted?.banners || []).slice(0, 40).join('\n'))}</pre>
      </details>
    </div>
  </article>`;
}

const absUrl = (p) => new URL(p, location.href).href;

function renderChanges(day) {
  if (!day.comparedWith) return `<div class="panel empty">Es el primer día con datos: mañana aparecerán aquí las mecánicas nuevas y las que desaparecieron.</div>`;
  const items = day.sites.map((s) => {
    if (s.diff?.skipped) return `<div class="item"><h3>${esc(s.name)} ${statusBadge(s)}</h3><div class="dim">No se compara: la captura de hoy o la de ayer no fue completa.</div></div>`;
    const added = (s.signals || []).filter((x) => x.isNew);
    const removed = s.diff?.removed || [];
    if (!added.length && !removed.length) return `<div class="item"><h3>${esc(s.name)}</h3><div class="dim">Sin cambios en ofertas o mecánicas.</div></div>`;
    const grp = (arr, fn) => TYPE_ORDER.map((t) => {
      const g = arr.filter((x) => x.type === t);
      return g.length ? `<div class="row"><span>${TYPE_LABEL[t]}</span><div class="gv">${g.map(fn).join('')}</div></div>` : '';
    }).join('');
    return `<div class="item">
      <h3>${esc(s.name)} <span class="delta-add">+${added.length}</span> <span class="delta-del">−${removed.length}</span></h3>
      ${added.length ? `<strong style="font-size:13px">Nuevas</strong>${grp(added, (x) => chip(x))}` : ''}
      ${removed.length ? `<div style="margin-top:10px"><strong style="font-size:13px">Desaparecieron</strong>${grp(removed, goneChip)}</div>` : ''}
    </div>`;
  });
  return `<div class="feed">${items.join('')}</div>`;
}

function renderHistory() {
  const days = state.index.days.slice(-21);
  const sites = [...new Map(days.flatMap((d) => d.sites.map((s) => [s.id, s.name]))).entries()];
  const max = Math.max(1, ...days.flatMap((d) => d.sites.map((s) => s.maxDiscount || 0)));
  const head = days.map((d) => `<th class="h"><a href="#${d.date}/resumen">${new Date(`${d.date}T12:00:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}</a></th>`).join('');
  const rows = sites.map(([id, name]) => {
    const cells = days.map((d) => {
      const s = d.sites.find((x) => x.id === id);
      if (!s) return '<td class="h dim">·</td>';
      if (s.status !== 'ok') return `<td class="h"><span class="badge ${s.status}" title="${STATUS_LABEL[s.status]}">!</span></td>`;
      const v = s.maxDiscount;
      const a = v ? 0.12 + 0.6 * (v / max) : 0;
      const camp = s.campaigns?.length ? ` · ${s.campaigns.join(', ')}` : '';
      const tip = `${v ? 'Dscto máx. ' + v + '%' : 'Sin dscto'} · ${s.mechanics} señales · +${s.added} −${s.removed}${camp}`;
      return `<td class="h" title="${esc(tip)}"><span style="background: color-mix(in srgb, var(--t-discount) ${Math.round(a * 100)}%, transparent)">${v ? v + '%' : '—'}</span><div class="dim" style="font-size:11px">${s.mechanics} · <span class="delta-add">+${s.added}</span></div></td>`;
    }).join('');
    return `<tr><td class="store">${esc(name)}</td>${cells}</tr>`;
  }).join('');
  return `<div class="panel scroll-x heat"><table><thead><tr><th>Tienda</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="legend">Cada celda: descuento máximo anunciado (“hasta X%”, “X% dscto”) · número de señales · mecánicas nuevas. Últimos ${days.length} días.</p>`;
}

function bindView() {
  document.querySelectorAll('[data-shot]').forEach((el) => {
    el.onclick = (e) => {
      e.preventDefault();
      $('#shotImg').src = el.dataset.shot;
      $('#shotLink').href = el.dataset.shot;
      $('#shotTitle').textContent = el.dataset.title;
      $('#shot').showModal();
    };
  });
  document.querySelectorAll('[data-jump]').forEach((el) => {
    el.onclick = (e) => {
      e.preventDefault();
      state.tab = 'tiendas';
      render();
      document.getElementById(`site-${el.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
  const fq = $('#fq');
  if (fq) {
    fq.oninput = () => { state.filter.q = fq.value; rerenderKeepFocus(); };
    $('#ftype').onchange = (e) => { state.filter.type = e.target.value; render(); };
    $('#fnew').onchange = (e) => { state.filter.onlyNew = e.target.checked; render(); };
  }
}

// Reporte descargable: un solo HTML con el resumen, los cambios y cada tienda, con los heros incrustados.
const REPORT_CSS = `
.top { position: static; }
.top-row { padding-bottom: 14px; }
h2 { font-size: 17px; margin: 28px 0 10px; }
@media print { .top { border: 0; } .card, .feed .item, tr { break-inside: avoid; } details { display: none; } }`;

async function toDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function buildReportHtml(day = state.day) {
  const css = await (await fetch('assets/style.css')).text();
  const heroes = new Map(await Promise.all(day.sites.map(async (s) =>
    [s.id, s.screenshots?.hero ? await toDataUrl(s.screenshots.hero).catch(() => null) : null])));
  const online = absUrl(`#${day.date}/resumen`);
  return `<!doctype html>
<html lang="es-PE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noimageindex">
<title>Monitor de campañas · ${esc(day.date)}</title>
<style>${css}${REPORT_CSS}</style>
</head>
<body>
<header class="top"><div class="wrap top-row"><div>
  <h1>Monitor de campañas · ${esc(fmtDate(day.date))}</h1>
  <p class="sub">Homes de ecommerce peruanos · <a href="${esc(online)}">ver en línea</a></p>
</div></div></header>
<main class="wrap">
  <p class="meta">${metaHtml(day)}</p>
  <section class="kpis">${kpisHtml(day)}</section>
  <h2>Resumen</h2>
  ${renderSummary(day, { report: true })}
  <h2>Cambios vs. día anterior</h2>
  ${renderChanges(day)}
  <h2>Tiendas</h2>
  <div class="cards">${day.sites.map((s) => storeCard(s, { report: true, heroSrc: heroes.get(s.id) })).join('')}</div>
</main>
<footer class="wrap foot">Datos detectados automáticamente con reglas y OCR: pueden tener errores. Revisa siempre la captura.</footer>
</body>
</html>`;
}

async function downloadReport() {
  const btn = $('#download');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparando…';
  try {
    const url = URL.createObjectURL(new Blob([await buildReportHtml()], { type: 'text/html' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `monitor-campanas-${state.date}.html` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    alert(`No se pudo armar el reporte: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function rerenderKeepFocus() {
  const pos = $('#fq').selectionStart;
  render();
  const fq = $('#fq');
  fq.focus();
  fq.setSelectionRange(pos, pos);
}

init();
