/**
 * @OnlyCurrentDoc
 *
 * Monitor de campañas → Google Sheets
 *
 * Copia a esta hoja de cálculo los datos que el monitor publica cada día en GitHub Pages:
 *   - "Tiendas por día": una fila por tienda y día (campañas, descuentos, tarjetas, cupones, cambios…).
 *   - "Cambios": una fila por cada mecánica que apareció o salió respecto al día anterior.
 * No hace scraping: lee los JSON ya publicados, así que siempre coincide con el dashboard.
 *
 * Instalación (una sola vez):
 *   1. Crea una hoja nueva en Google Sheets → Extensiones → Apps Script.
 *   2. Reemplaza todo el contenido de Código.gs por este archivo y guarda.
 *   3. Arriba, elige la función "instalar" y presiona Ejecutar. Acepta los permisos que pide Google.
 * Trae todo el historial y deja una revisión automática cada hora. Para traer lo último al instante,
 * ejecuta "sincronizar". Si quieres tus propias columnas o fórmulas, ponlas en otra pestaña: estas dos
 * se reescriben en cada sincronización.
 *
 * Las columnas son las mismas que las del Excel del dashboard (src/workbook.js): si cambias una, cambia la otra.
 */

const BASE_URL = 'https://denv17.github.io/monitor-campanas/';
// La primera vez puede haber muchos días: se traen de a poco (los más recientes primero) y el resto en la
// siguiente revisión, para no pasar el límite de 6 minutos por ejecución.
const MAX_DIAS_POR_CORRIDA = 30;

const TYPE_LABEL = {
  campaign: 'Campaña', discount: 'Descuento', card: 'Tarjeta propia', bank: 'Banco / pago',
  installments: 'Cuotas s/i', coupon: 'Cupón', multibuy: 'Multicompra', urgency: 'Urgencia',
  shipping: 'Envío / retiro', category: 'Categoría',
};
const STATUS_LABEL = { ok: 'OK', partial: 'Parcial', blocked: 'Bloqueado', error: 'Error' };

// Formato de cada columna: '@' = texto (así "10%" o "3x2" no se convierten en números), '0' = número.
const FECHA = { h: 'Fecha', f: 'yyyy-mm-dd' };
const txt = (h) => ({ h: h, f: '@' });
const num = (h) => ({ h: h, f: '0' });

const TIENDAS = {
  name: 'Tiendas por día',
  cols: [
    FECHA, txt('Tienda'), txt('Estado'), txt('Campañas'), num('Dscto. máx. anunciado (%)'), txt('Descuentos'),
    num('Dscto. máx. en productos (%)'), txt('Tarjeta propia'), txt('Bancos / pagos'), txt('Cuotas s/i'),
    txt('Cupones'), txt('Multicompra'), txt('Urgencia'), txt('Envío / retiro'), txt('Categorías'),
    num('Señales'), num('Nuevas vs. día anterior'), num('Salieron vs. día anterior'), txt('Captura'), txt('Ver en el dashboard'),
  ],
  rows: (day) => day.sites.map((s) => {
    const sm = s.summary || {};
    const signals = s.signals || [];
    const labels = (type) => [...new Set(signals.filter((x) => x.type === type).map((x) => x.label))].join(', ');
    const compared = day.comparedWith && s.diff && !s.diff.skipped;
    return [
      day.date, s.name, STATUS_LABEL[s.status] || s.status,
      labels('campaign'), blank_(sm.maxDiscount), labels('discount'), blank_(sm.maxProductDiscount),
      labels('card'), labels('bank'), labels('installments'), labels('coupon'), labels('multibuy'),
      labels('urgency'), labels('shipping'), labels('category'),
      signals.filter((x) => x.type !== 'price' && x.type !== 'category').length,
      compared ? s.diff.added.length : '', compared ? s.diff.removed.length : '',
      s.screenshots && s.screenshots.hero ? BASE_URL + s.screenshots.hero : '',
      BASE_URL + '#' + day.date + '/tiendas',
    ];
  }),
};

const CAMBIOS = {
  name: 'Cambios',
  cols: [FECHA, txt('Tienda'), txt('Cambio'), txt('Tipo'), txt('Señal'), txt('Texto donde se vio')],
  rows: (day) => day.sites.flatMap((s) => {
    if (!day.comparedWith || !s.diff || s.diff.skipped) return [];
    const nuevas = (s.signals || []).filter((x) => x.isNew && x.type !== 'price')
      .map((x) => [day.date, s.name, 'Nuevo', TYPE_LABEL[x.type] || x.type, x.label, x.snippet || '']);
    const salieron = (s.diff.removed || [])
      .map((x) => [day.date, s.name, 'Salió', TYPE_LABEL[x.type] || x.type, x.label, '']);
    return nuevas.concat(salieron);
  }),
};

function instalar() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'sincronizar')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizar').timeBased().everyHours(1).create();
  sincronizar();
}

function sincronizar() {
  const index = fetchJson_(['data/index.json'])[0];
  const props = PropertiesService.getDocumentProperties();
  const synced = props.getProperties(); // 'gen:AAAA-MM-DD' → generatedAt del día ya copiado
  // Un día se vuelve a copiar si se republicó (p. ej. el Mac sube Ripley y después GitHub las demás).
  const pending = index.days.filter((d) => synced['gen:' + d.date] !== d.generatedAt).slice(-MAX_DIAS_POR_CORRIDA);
  if (!pending.length) return;

  const days = fetchJson_(pending.map((d) => 'data/' + d.date + '.json'));
  const dates = days.map((d) => d.date);
  [TIENDAS, CAMBIOS].forEach((table) => write_(table, dates, days.flatMap(table.rows)));

  const done = {};
  days.forEach((d) => (done['gen:' + d.date] = d.generatedAt));
  props.setProperties(done);
}

// Reescribe la pestaña: quita las filas de los días que se actualizan, agrega las nuevas y ordena
// (día más reciente arriba; dentro de cada día, en el orden de sites.json).
function write_(table, dates, newRows) {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const width = table.cols.length;
  let sh = ss.getSheetByName(table.name);
  if (!sh) {
    sh = ss.insertSheet(table.name);
    sh.getRange(1, 1, 1, width).setValues([table.cols.map((c) => c.h)]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const last = sh.getLastRow();
  const old = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  const replaced = new Set(dates);
  const keep = old.filter((r) => !replaced.has(dateKey_(r[0], tz)));
  const fresh = newRows.map((r) => [Utilities.parseDate(r[0], tz, 'yyyy-MM-dd')].concat(r.slice(1)));
  const rows = keep.concat(fresh).sort((a, b) => b[0] - a[0]);

  if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
  if (!rows.length) return;
  const range = sh.getRange(2, 1, rows.length, width);
  range.setNumberFormats(rows.map(() => table.cols.map((c) => c.f))); // antes de los valores, para que el texto quede como texto
  range.setValues(rows);
}

function fetchJson_(paths) {
  const t = Date.now(); // evita la caché de GitHub Pages
  return UrlFetchApp.fetchAll(paths.map((p) => ({ url: BASE_URL + p + '?t=' + t, muteHttpExceptions: true })))
    .map((r, i) => {
      if (r.getResponseCode() !== 200) throw new Error('No se pudo leer ' + paths[i] + ' (HTTP ' + r.getResponseCode() + ')');
      return JSON.parse(r.getContentText());
    });
}

const dateKey_ = (v, tz) => (Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v));
const blank_ = (v) => (v === null || v === undefined ? '' : v);
