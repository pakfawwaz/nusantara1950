// Minimal static server for the production build (used by Heroku: `web: node server.mjs`). No dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT) || 8080;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.pbf': 'application/x-protobuf', '.woff2': 'font/woff2', '.map': 'application/json' };
const zipped = new Map(); // path -> gzip buffer (the data files are several MB of JSON)

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.normalize(path.join(root, url === '/' ? 'index.html' : url));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  const ext = path.extname(file); const type = types[ext] ?? 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache' };
  const compressible = /^(text\/|application\/(json|javascript)|image\/svg)/.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  if (compressible) {
    let buf = zipped.get(file); if (!buf) { buf = zlib.gzipSync(fs.readFileSync(file), { level: 6 }); zipped.set(file, buf); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': buf.length, Vary: 'Accept-Encoding' }).end(buf);
  } else { res.writeHead(200, headers); fs.createReadStream(file).pipe(res); }
}).listen(port, () => console.log(`Nusantara 1950 listening on ${port}`));
