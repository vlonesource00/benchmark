import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const threeModule = path.resolve(root, '..', 'subjects', 'gemini-grand-prix', 'node_modules', 'three', 'build', 'three.module.js');
const port = Number(process.env.PORT || 4180);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const server = http.createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent((request.url || '/').split('?')[0]);
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    const file = relative === 'vendor/three.module.js' ? threeModule : path.resolve(root, relative);
    const allowed = file === threeModule || (file !== root && file.startsWith(`${root}${path.sep}`));
    if (!allowed) { response.writeHead(403); response.end('Forbidden'); return; }
    const body = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.code === 'ENOENT' ? 'Not found' : error.message);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Harbor Ring viewer: http://127.0.0.1:${port}`);
});
