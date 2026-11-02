// Prueba rápida de las reglas: npm run test:signals
import { detectSignals } from './signals.js';

const sample = [
  { source: 'ocr', text: 'CYBER WOW Hasta 70% dscto en Tecnología. Solo por hoy. Usa el cupón CYBER40 y obtén S/ 40 de dscto por compras mayores a S/ 199' },
  { source: 'banner', text: 'Dormitorio 2da unidad al 50% | 3x2 en Belleza | Paga con tarjeta CMR hasta 24 cuotas sin intereses' },
  { source: 'alt', text: 'Envío gratis por compras desde S/ 99 - Black Friday -40% adicional con Tarjeta Ripley - termina en 02:15:33' },
  { source: 'text', text: 'Moda Smart TV 55" S/ 1,299.90 antes S/ 1.899 Código: MODAWOW50 50% dscto en moda mínimo S/ 150. Retiro gratis en tienda. 0% interés' },
];
const { signals, summary } = detectSignals(sample);
for (const s of signals) console.log(s.type.padEnd(13), '|', s.label, '|', s.sources.join(','));
console.log(summary);
