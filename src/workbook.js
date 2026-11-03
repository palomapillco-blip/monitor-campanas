// Excel con todo el historial (data/monitor-campanas.xlsx) que baja el botón Descargar del dashboard.
// Tiene las mismas pestañas y columnas que apps-script/sheets-sync.gs: si cambias una, cambia la otra.
import { xlsx } from './xlsx.js';

export const WORKBOOK_FILE = 'monitor-campanas.xlsx';

const TYPE_LABEL = {
  campaign: 'Campaña', discount: 'Descuento', card: 'Tarjeta propia', bank: 'Banco / pago',
  installments: 'Cuotas s/i', coupon: 'Cupón', multibuy: 'Multicompra', urgency: 'Urgencia',
  shipping: 'Envío / retiro', category: 'Categoría',
};
const STATUS_LABEL = { ok: 'OK', partial: 'Parcial', blocked: 'Bloqueado', error: 'Error' };

const date = { h: 'Fecha', type: 'date', w: 11 };
const text = (h, w = 22) => ({ h, type: 'text', w });
const num = (h, w = 12) => ({ h, type: 'num', w });
const link = (h) => ({ h, type: 'link', w: 10 });

const TIENDAS_COLS = [
  date, text('Tienda', 14), text('Estado', 9), text('Campañas'), num('Dscto. máx. anunciado (%)'), text('Descuentos', 30),
  num('Dscto. máx. en productos (%)'), text('Tarjeta propia'), text('Bancos / pagos'), text('Cuotas s/i'),
  text('Cupones', 30), text('Multicompra'), text('Urgencia'), text('Envío / retiro', 26), text('Categorías', 40),
  num('Señales', 9), num('Nuevas vs. día anterior'), num('Salieron vs. día anterior'), link('Captura'), link('Ver en el dashboard'),
];
const CAMBIOS_COLS = [date, text('Tienda', 14), text('Cambio', 9), text('Tipo', 16), text('Señal', 30), text('Texto donde se vio', 80)];

function tiendaRows(day, baseUrl) {
  return day.sites.map((s) => {
    const sm = s.summary || {};
    const signals = s.signals || [];
    const labels = (type) => [...new Set(signals.filter((x) => x.type === type).map((x) => x.label))].join(', ');
    const compared = day.comparedWith && s.diff && !s.diff.skipped;
    return [
      day.date, s.name, STATUS_LABEL[s.status] || s.status,
      labels('campaign'), sm.maxDiscount ?? '', labels('discount'), sm.maxProductDiscount ?? '',
      labels('card'), labels('bank'), labels('installments'), labels('coupon'), labels('multibuy'),
      labels('urgency'), labels('shipping'), labels('category'),
      signals.filter((x) => x.type !== 'price' && x.type !== 'category').length,
      compared ? s.diff.added.length : '', compared ? s.diff.removed.length : '',
      s.screenshots?.hero ? baseUrl + s.screenshots.hero : '',
      `${baseUrl}#${day.date}/tiendas`,
    ];
  });
}

function cambioRows(day) {
  return day.sites.flatMap((s) => {
    if (!day.comparedWith || !s.diff || s.diff.skipped) return [];
    const nuevas = (s.signals || []).filter((x) => x.isNew && x.type !== 'price')
      .map((x) => [day.date, s.name, 'Nuevo', TYPE_LABEL[x.type] || x.type, x.label, x.snippet || '']);
    const salieron = (s.diff.removed || [])
      .map((x) => [day.date, s.name, 'Salió', TYPE_LABEL[x.type] || x.type, x.label, '']);
    return [...nuevas, ...salieron];
  });
}

// Se le pasan los días de a uno (así no hace falta tener todos los JSON en memoria) y al final arma el Excel,
// con el día más reciente arriba.
export function workbook(baseUrl) {
  const days = [];
  return {
    add: (day) => days.unshift({ tiendas: tiendaRows(day, baseUrl), cambios: cambioRows(day) }),
    build: () => xlsx([
      { name: 'Tiendas por día', cols: TIENDAS_COLS, rows: days.flatMap((d) => d.tiendas) },
      { name: 'Cambios', cols: CAMBIOS_COLS, rows: days.flatMap((d) => d.cambios) },
    ]),
  };
}
