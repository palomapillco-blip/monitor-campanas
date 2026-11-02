// Genera data/index.json: lista de días con un resumen liviano por sitio para el dashboard.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, listDates, isMain } from './util.js';

export async function buildIndex(dataDir = DATA_DIR) {
  const days = [];
  for (const date of await listDates(dataDir)) {
    const d = JSON.parse(await fs.readFile(path.join(dataDir, `${date}.json`), 'utf8'));
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
  const index = { updatedAt: new Date().toISOString(), latest: days.at(-1)?.date ?? null, days };
  await fs.writeFile(path.join(dataDir, 'index.json'), JSON.stringify(index, null, 1));
  return index;
}

if (isMain(import.meta.url)) {
  buildIndex().then((i) => console.log(`index.json: ${i.days.length} días`));
}
