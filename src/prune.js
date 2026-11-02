// Borra carpetas de capturas más antiguas que settings.keepScreenshotsDays (los JSON se conservan).
import fs from 'node:fs/promises';
import path from 'node:path';
import { SHOTS_DIR, limaDate, loadConfig } from './util.js';

const { settings } = await loadConfig();
const keep = settings.keepScreenshotsDays ?? 45;
const cutoff = limaDate(new Date(Date.now() - keep * 86400000));
const dirs = (await fs.readdir(SHOTS_DIR).catch(() => [])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff);
for (const d of dirs) await fs.rm(path.join(SHOTS_DIR, d), { recursive: true });
console.log(`Capturas: ${dirs.length} días borrados (se conservan ${keep} días)`);
