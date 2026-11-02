// Detección de señales comerciales con reglas (regex + palabras clave).
// Cada señal es { type, key, value, label, snippet, sources[] }.
// `key` es lo que se usa para comparar entre días: misma key = misma oferta/mecánica.

export const SIGNAL_TYPES = {
  campaign: 'Campaña',
  discount: 'Descuento',
  card: 'Tarjeta propia',
  bank: 'Banco / medio de pago',
  installments: 'Cuotas sin intereses',
  coupon: 'Cupón',
  multibuy: 'Multicompra',
  urgency: 'Urgencia',
  shipping: 'Envío / retiro gratis',
  category: 'Categoría destacada',
  price: 'Precio',
};

// Normaliza para buscar: minúsculas, sin tildes, espacios simples.
export function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ \s]+/g, ' ')
    .toLowerCase()
    .trim();
}

const CAMPAIGNS = [
  ['Cyber Wow', /\bcyber\s*-?\s*wow\b/],
  ['Cyber Days', /\bcyber\s*days?\b/],
  ['Cyber Monday', /\bcyber\s*monday\b/],
  ['Black Friday', /\bblack\s*friday\b/],
  ['Black Week', /\bblack\s*(week|days?|weekend|november)\b/],
  ['Navidad', /\b(navidad|navidena?s?|christmas|regalos de fin de ano)\b/],
  ['Fiestas de fin de año', /\b(fiestas de fin de ano|fin de ano|ano nuevo)\b/],
  ['Día de la Madre', /\bdia de (la )?mama\b|\bdia de la madre\b/],
  ['Día del Padre', /\bdia del papa\b|\bdia del padre\b/],
  ['Fiestas Patrias', /\bfiestas patrias\b/],
  ['Halloween', /\bhalloween\b/],
  ['Aniversario', /\baniversario\b/],
  ['Liquidación', /\b(liquidacion|remate|outlet)\b/],
  ['Hot Sale', /\bhot\s*sale\b/],
  ['11.11', /\b11\s*[.\/]\s*11\b|\bdoble once\b/],
  ['Mega ofertas', /\b(mega|super|mas) ofertas?\b|\bofertas? (imperdibles|increibles)\b/],
  ['Regreso a clases', /\b(regreso|vuelta) a clases?\b|\bescolar(es)?\b/],
];

// Tarjetas propias de los retailers.
const CARDS = [
  ['CMR', /\bcmr\b|\bbanco falabella\b/],
  ['Tarjeta Ripley', /\btarjeta ripley\b|\bbanco ripley\b|\bripley (mastercard|visa)\b/],
  ['Tarjeta Oh!', /\btarjeta oh\b|\boh!/],
  ['Sip', /\bsip\b/],
  ['Wong Prime', /\bwong prime\b|\bprime\b(?=.{0,20}wong)/],
  ['Mercado Pago', /\bmercado pago\b/],
  ['Tarjeta Promart', /\btarjeta promart\b/],
  ['Monedero del Ahorro', /\bmonedero del ahorro\b/],
];

const BANKS = [
  ['BCP', /\bbcp\b/],
  ['Interbank', /\binterbank\b/],
  ['BBVA', /\bbbva\b/],
  ['Scotiabank', /\bscotiabank\b/],
  ['Diners Club', /\bdiners\b/],
  ['American Express', /\bamerican express\b|\bamex\b/],
  ['Yape', /\byape\b/],
  ['Plin', /\bplin\b/],
];

const CATEGORIES = [
  ['Tecnología', /\b(tecnologia|tecno|laptops?|celulares?|smartphones?|televisores?|smart tv|tv|computo|gamer|gaming|electro(nica)?|audio)\b/],
  ['Electrohogar', /\b(electrohogar|linea blanca|refrigeradoras?|lavadoras?|cocinas?|microondas|aspiradoras?)\b/],
  ['Dormitorio', /\b(dormitorio|colchones?|camas?|box tarima|almohadas?|sabanas?)\b/],
  ['Muebles y deco', /\b(muebles?|sofas?|decoracion|deco|comedor(es)?|hogar)\b/],
  ['Moda', /\b(moda|ropa|vestuario|zapatillas?|calzado|jeans|polos?|vestidos?|accesorios)\b/],
  ['Belleza', /\b(belleza|maquillaje|perfumes?|perfumeria|fragancias?|skincare|dermocosmetica|cuidado personal)\b/],
  ['Supermercado', /\b(super(mercado)?|abarrotes|despensa|lacteos|bebidas|licores|vinos?|cervezas?|carnes?|frutas|verduras|limpieza)\b/],
  ['Salud y farmacia', /\b(salud|farmacia|medicamentos?|vitaminas?|suplementos?|bienestar)\b/],
  ['Mamá y bebé', /\b(bebes?|mama y bebe|panales?|infantil|maternidad)\b/],
  ['Juguetería', /\b(juguetes?|jugueteria)\b/],
  ['Deportes', /\b(deportes?|deportivo|fitness|bicicletas?|outdoor)\b/],
  ['Mejoramiento del hogar', /\b(herramientas?|ferreteria|construccion|pisos?|pinturas?|banos?|jardin|iluminacion|terraza)\b/],
  ['Mascotas', /\b(mascotas?|perros?|gatos?)\b/],
  ['Automotriz', /\b(automotriz|autos?|llantas?|neumaticos?)\b/],
];

const URGENCY = [
  ['Solo por hoy', /\bsolo (por )?hoy\b|\bhoy (solo|nomas)\b|\bsolo este dia\b/],
  ['Solo por horas', /\bsolo (x|por) \d{1,2} ?(h|hrs?|horas)\b|\bsolo por horas\b|\b\d{1,2} horas? (solamente|nomas)\b/],
  ['Últimas horas', /\bultimas? (horas?|dias?|unidades|oportunidad)\b/],
  ['Por tiempo limitado', /\b(por )?tiempo limitado\b|\bhasta agotar stock\b|\bstock limitado\b/],
  ['Termina pronto', /\b(termina|acaba|finaliza|vence)( en| hoy| manana| pronto)\b/],
  ['Flash / relámpago', /\b(flash|relampago|ofertas? del (dia|momento)|deal del dia)\b/],
  ['Fin de semana', /\bsolo (este )?fin de semana\b/],
];

// --- helpers -------------------------------------------------------------

function snippetAround(text, index, len, pad = 50) {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + len + pad);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

function parseSoles(raw) {
  // "1,299.90" | "1.299,90" | "1299" | "49.90"
  let s = raw.replace(/\s/g, '');
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const SOLES_RE = /s\s?\/\s?\.?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/;
const SOLES_RE_G = new RegExp(SOLES_RE.source, 'g');

function findMinTicket(window) {
  // "por compras (mayores|desde|mínimas|de) (a|de) S/ 199 (a más)"
  const m = window.match(/(compras?|pedidos?|ticket|monto)( minim[oa]s?)?( (mayores?|desde|superiores?|minimas?|a partir))?( (a|de))?( s\s?\/\s?\.?\s?)(\d[\d.,]*)/);
  if (m) return parseSoles(m[8]);
  const m2 = window.match(/(desde|sobre|mas de|mayores? a|minimo( de)?|min\.?) s\s?\/\s?\.?\s?(\d[\d.,]*)/);
  return m2 ? parseSoles(m2[3]) : null;
}

// --- detector -------------------------------------------------------------

/**
 * @param {Array<{source: string, text: string}>} chunks  textos por fuente (text|alt|banner|ocr)
 * @returns {{signals: object[], summary: object}}
 */
export function detectSignals(chunks) {
  const found = new Map();
  const productBadges = [];

  const add = (sig, source) => {
    const existing = found.get(sig.key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      existing.count++;
      return;
    }
    found.set(sig.key, { ...sig, sources: [source], count: 1 });
  };

  for (const { source, text: rawText } of chunks) {
    if (!rawText) continue;
    const text = norm(rawText);

    // Campañas: el footer suele listar todas ("cyber wow, cyber days y black friday")
    // como texto SEO, así que el texto completo no cuenta; sí título, banners, alts y OCR.
    for (const [label, re] of source === 'text' ? [] : CAMPAIGNS) {
      const m = text.match(re);
      if (m) add({ type: 'campaign', key: `campaign:${label}`, value: label, label, snippet: snippetAround(text, m.index, m[0].length) }, source);
    }
    for (const [label, re] of CARDS) {
      // "Sip" es ambiguo: solo en texto con contexto de pago.
      const m = text.match(re);
      if (!m) continue;
      if (label === 'Sip' && !/(tarjeta|pago|paga|con sip|sip pay)/.test(snippetAround(text, m.index, 3, 40))) continue;
      add({ type: 'card', key: `card:${label}`, value: label, label, snippet: snippetAround(text, m.index, m[0].length) }, source);
    }
    for (const [label, re] of BANKS) {
      const m = text.match(re);
      if (m) add({ type: 'bank', key: `bank:${label}`, value: label, label, snippet: snippetAround(text, m.index, m[0].length) }, source);
    }
    for (const [label, re] of URGENCY) {
      const m = text.match(re);
      if (m) add({ type: 'urgency', key: `urgency:${label}`, value: label, label, snippet: snippetAround(text, m.index, m[0].length) }, source);
    }
    // Contador tipo 02:15:33 o "05 h 12 m 30 s"
    const cd = text.match(/\b\d{1,2}\s?:\s?\d{2}\s?:\s?\d{2}\b|\b\d{1,2}\s?(h|hrs?|horas)\s?\d{1,2}\s?(m|min|minutos)\s?\d{1,2}\s?(s|seg|segundos)\b/);
    if (cd) add({ type: 'urgency', key: 'urgency:Contador', value: 'Contador', label: 'Contador regresivo', snippet: snippetAround(text, cd.index, cd[0].length) }, source);

    // Las categorías se toman solo de banners / alts / OCR: el texto completo
    // incluye el menú de navegación y marcaría todas las categorías siempre.
    for (const [label, re] of source === 'text' ? [] : CATEGORIES) {
      const m = text.match(re);
      if (m) add({ type: 'category', key: `category:${label}`, value: label, label, snippet: snippetAround(text, m.index, m[0].length) }, source);
    }

    // Cuotas sin intereses
    for (const m of text.matchAll(/(hasta (en )?)?(\d{1,2}) (?:cuotas?|meses)( (sin|0%|cero) (de )?interes(es)?)?/g)) {
      const n = Number(m[3]);
      const sin = Boolean(m[4]) || /sin interes|0% interes|tea 0/.test(text.slice(m.index, m.index + 60));
      if (!sin || n < 2 || n > 48) continue;
      add({ type: 'installments', key: `installments:${n}`, value: n, label: `${n} cuotas sin intereses`, snippet: snippetAround(text, m.index, m[0].length) }, source);
    }
    if (!/\d{1,2} (cuotas|meses) sin/.test(text)) {
      const m = text.match(/(cuotas|meses) sin interes(es)?/);
      if (m) add({ type: 'installments', key: 'installments:?', value: null, label: 'Cuotas sin intereses', snippet: snippetAround(text, m.index, m[0].length) }, source);
    }

    // Multicompra
    for (const m of text.matchAll(/\b([2-6]) ?x ?([1-5])\b/g)) {
      if (Number(m[2]) >= Number(m[1])) continue;
      const v = `${m[1]}x${m[2]}`;
      add({ type: 'multibuy', key: `multibuy:${v}`, value: v, label: v, snippet: snippetAround(text, m.index, m[0].length) }, source);
    }
    for (const m of text.matchAll(/\b(2da|segunda|2do|segundo|3ra|3ro|tercera|tercero) (unidad |und |prenda |producto )?(a |al |con |a solo )?(-?\d{1,2}) ?%/g)) {
      if (!m[2] && !m[3]) continue;
      const ord = /^(3r|tercer)/.test(m[1]) ? '3ra' : '2da';
      const v = `${ord} unidad al ${m[4].replace('-', '')}%`;
      add({ type: 'multibuy', key: `multibuy:${v}`, value: v, label: v, snippet: snippetAround(text, m.index, m[0].length) }, source);
    }
    for (const m of text.matchAll(/\blleva (\d) (y )?paga (\d)\b/g)) {
      const v = `${m[1]}x${m[3]}`;
      add({ type: 'multibuy', key: `multibuy:${v}`, value: v, label: v, snippet: snippetAround(text, m.index, m[0].length) }, source);
    }

    // Envío / retiro gratis
    for (const m of text.matchAll(/\b(envio|despacho|delivery|retiro|recojo|recoge) (es )?(gratis|sin costo|gratuito|free)\b|\bfree shipping\b/g)) {
      const kind = /retiro|recojo|recoge/.test(m[0]) ? 'Retiro gratis' : 'Envío gratis';
      const win = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 100);
      const min = findMinTicket(win);
      add({ type: 'shipping', key: `shipping:${kind}`, value: kind, minAmount: min, label: min ? `${kind} desde S/ ${min}` : kind, snippet: snippetAround(text, m.index, m[0].length, 70) }, source);
    }

    // Descuentos. Solo cuentan como mecánica los que traen contexto ("hasta 70%",
    // "40% dscto", "+10% adicional"). Los badges sueltos de producto ("-58%") se
    // resumen aparte para no inundar las señales ni la comparación diaria.
    for (const m of text.matchAll(/(hasta( el| un)? |\+ ?|-)?(\d{1,2})\s?%( de)?( (dscto|dcto|dsct|desct|desc|descuento|off|menos|adicional|extra))?/g)) {
      const pct = Number(m[3]);
      if (pct < 5) continue;
      const before = text.slice(Math.max(0, m.index - 30), m.index);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 20);
      // excluir "2da unidad al 50%", "0% interés", "TEA 40%"
      if (/((unidad|prenda|producto)( a| al| con)?|(2da|2do|segunda|segundo|3ra) (a|al|con)) $/.test(before) || /^ ?(de )?interes|^ ?(tea|tcea)/.test(after) || /(tea|tcea) ?$/.test(before)) continue;
      const hasta = Boolean(m[1] && m[1].startsWith('hasta'));
      const extra = Boolean(m[1] && m[1].startsWith('+')) || /adicional|extra/.test(m[0]) || /^ ?(adicional|extra)/.test(after);
      // "23% OFF" suelto es el badge de producto típico (Mercado Libre); "40% off en zapatillas" sí cuenta.
      const described = (Boolean(m[6]) && m[6] !== 'off') || /^ ?(en |dscto|dcto|desct|descuento)/.test(after);
      if (!hasta && !extra && !described) {
        productBadges.push(pct);
        continue;
      }
      const label = `${hasta ? 'Hasta ' : ''}${pct}%${extra ? ' adicional' : ''}`;
      add({ type: 'discount', key: `discount:${label.toLowerCase()}`, value: pct, upTo: hasta, extra, label, snippet: snippetAround(text, m.index, m[0].length) }, source);
    }

    // Cupones: código en mayúsculas en el texto original, cerca de "cupón/código"
    const codeRe = /\b([A-Z]{3,}\d{1,3})\b/g;
    for (const m of String(rawText).matchAll(codeRe)) {
      const code = m[1];
      // Forma de cupón: letras y luego 1-3 dígitos (CYBER40, MODAWOW50). Descarta modelos tipo VG249QM5A o B00388.
      if (!/^[A-Z]{3,}\d{1,3}$/.test(code)) continue;
      if (/^(S\d|[A-Z]\d{1,2}$)/.test(code) || /^(MP3|MP4|USB|HDMI|A\d+|IPHONE\d+|GALAXY|X\d+|PS\d|RTX\d+|GTX\d+|I\d|RYZEN\d+|COVID19)/.test(code)) continue;
      const winRaw = String(rawText).slice(Math.max(0, m.index - 140), m.index + code.length + 160);
      const win = norm(winRaw);
      const knownPrefix = /^(CYBER|WOW|BLACK|BF|NAVIDAD|XMAS|MODA)/.test(code) && /\d/.test(code);
      if (!knownPrefix && !/(cupon|codigo|cod\.|usa el|ingresa|aplica|promocode|code)/.test(win)) continue;
      const amtSoles = win.match(/s\s?\/\s?\.?\s?(\d[\d.,]*) (de )?(dscto|dcto|descuento|off|menos)/);
      const amtPct = win.match(/(\d{1,2}) ?% (de )?(dscto|dcto|descuento|off|adicional|extra)?/);
      const amount = amtSoles ? `S/ ${parseSoles(amtSoles[1])}` : amtPct ? `${amtPct[1]}%` : null;
      const minTicket = findMinTicket(win);
      const parts = [code, amount && `(${amount})`, minTicket && `mín. S/ ${minTicket}`].filter(Boolean);
      add({ type: 'coupon', key: `coupon:${code}`, value: code, amount, minTicket, label: parts.join(' '), snippet: snippetAround(String(rawText).replace(/\s+/g, ' '), m.index, code.length, 70) }, source);
    }

    // Precios
    for (const m of text.matchAll(SOLES_RE_G)) {
      const v = parseSoles(m[1]);
      if (v == null || v <= 0 || v > 100000) continue;
      add({ type: 'price', key: `price:${v}`, value: v, label: `S/ ${v.toLocaleString('es-PE', { minimumFractionDigits: v % 1 ? 2 : 0 })}`, snippet: snippetAround(text, m.index, m[0].length, 40) }, source);
    }
  }

  const signals = [...found.values()];
  const summary = summarize(signals);
  summary.productDiscountCount = productBadges.length;
  summary.maxProductDiscount = productBadges.length ? Math.max(...productBadges) : null;
  return { signals, summary };
}

export function summarize(signals) {
  const by = (t) => signals.filter((s) => s.type === t);
  const discounts = by('discount').map((s) => s.value);
  const prices = by('price').map((s) => s.value);
  const installments = by('installments').map((s) => s.value).filter(Boolean);
  return {
    campaigns: by('campaign').map((s) => s.value),
    maxDiscount: discounts.length ? Math.max(...discounts) : null,
    discountCount: discounts.length,
    cards: by('card').map((s) => s.value),
    banks: by('bank').map((s) => s.value),
    maxInstallments: installments.length ? Math.max(...installments) : by('installments').length ? '?' : null,
    coupons: by('coupon').map((s) => s.label),
    multibuy: by('multibuy').map((s) => s.value),
    urgency: by('urgency').map((s) => s.value),
    shipping: by('shipping').map((s) => s.label),
    categories: by('category').map((s) => s.value),
    priceCount: prices.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
  };
}

// Tipos que se comparan día a día (los precios son demasiado ruidosos).
export const DIFF_TYPES = ['campaign', 'discount', 'card', 'bank', 'installments', 'coupon', 'multibuy', 'urgency', 'shipping', 'category'];

export function diffSignals(today, previous) {
  if (!previous) return { baseline: true, added: [], removed: [] };
  const prevKeys = new Map(previous.filter((s) => DIFF_TYPES.includes(s.type)).map((s) => [s.key, s]));
  const todayKeys = new Set(today.filter((s) => DIFF_TYPES.includes(s.type)).map((s) => s.key));
  const added = today.filter((s) => DIFF_TYPES.includes(s.type) && !prevKeys.has(s.key)).map((s) => s.key);
  const removed = [...prevKeys.values()].filter((s) => !todayKeys.has(s.key)).map(({ type, key, label, value }) => ({ type, key, label, value }));
  return { baseline: false, added, removed };
}
