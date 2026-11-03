// Genera data/index.json (lista de días con un resumen liviano por sitio para el dashboard)
// y data/monitor-campanas.xlsx (todo el historial en Excel).
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, listDates, loadConfig, isMain } from './util.js';
import { workbook, WORKBOOK_FILE } from './workbook.js';

export async function buildIndex(dataDir = DATA_DIR) {
  const { settings } = await loadConfig();
  const book = workbook(settings.publicUrl || '');
  const days = [];
  for (const date of await listDates(dataDir)) {
    const d = JSON.parse(await fs.readFile(path.join(dataDir, `${date}.json`), 'utf8'));
    book.add(d);
    days.push({
      date,
      generatedAt: d.generatedAt,
      sites: d.sites.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        maxDiscount: s.summary?.maxDiscount ?? null,
        campaigns: s.summary?.campaigns ?? [],
        mechanics: (s.signals || []).filter((x) => x.type !== 'price' && x.type !== 'category').length,
        added: s.diff?.added?.length ?? 0,
        removed: s.diff?.removed?.length ?? 0,
      })),
    });
  }
  await fs.writeFile(path.join(dataDir, WORKBOOK_FILE), book.build());
  const index = { updatedAt: new Date().toISOString(), latest: days.at(-1)?.date ?? null, workbook: `data/${WORKBOOK_FILE}`, days };
  await fs.writeFile(path.join(dataDir, 'index.json'), JSON.stringify(index, null, 1));
  return index;
}

if (isMain(import.meta.url)) {
  buildIndex().then((i) => console.log(`index.json y ${WORKBOOK_FILE}: ${i.days.length} días`));
}
