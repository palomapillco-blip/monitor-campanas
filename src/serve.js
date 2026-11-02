// Servidor estático mínimo para ver el dashboard en local: npm run serve
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, OUT_DIR } from './util.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT) || 8080;

http
  .createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // data/ y screenshots/ salen de OUT_DIR (por defecto el mismo repo).
    const base = /^\/(data|screenshots)\//.test(url) ? OUT_DIR : ROOT;
    const file = path.join(base, url.endsWith('/') ? url + 'index.html' : url);
    if (!file.startsWith(base)) return res.writeHead(403).end();
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('No encontrado');
    }
  })
  .listen(port, () => console.log(`Dashboard en http://localhost:${port}`));
