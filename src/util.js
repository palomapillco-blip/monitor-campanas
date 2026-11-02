import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// OUT_DIR permite escribir datos y capturas fuera del repo (en GitHub Actions es la carpeta de la rama gh-pages).
export const OUT_DIR = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : ROOT;
export const DATA_DIR = path.join(OUT_DIR, 'data');
export const SHOTS_DIR = path.join(OUT_DIR, 'screenshots');

export const DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

// Fecha AAAA-MM-DD en hora de Lima.
export function limaDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export async function loadConfig() {
  return JSON.parse(await fs.readFile(path.join(ROOT, 'sites.json'), 'utf8'));
}

export async function listDates() {
  const files = await fs.readdir(DATA_DIR).catch(() => []);
  return files.filter((f) => DATE_FILE_RE.test(f)).map((f) => f.slice(0, 10)).sort();
}

// El último día guardado antes de `date` (no necesariamente ayer).
export async function findPreviousDay(date) {
  const prev = (await listDates()).filter((d) => d < date).pop();
  if (!prev) return null;
  return { date: prev, data: JSON.parse(await fs.readFile(path.join(DATA_DIR, `${prev}.json`), 'utf8')) };
}
