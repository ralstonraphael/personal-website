// Local server for the real voice loop: the static site plus /api/ask and /api/voice,
// calling the same handlers Vercel runs. The key comes from the environment, never the page.
//   OPENROUTER_API_KEY=... ALLOWED_ORIGINS=http://127.0.0.1:4174 node scripts/voice-dev-server.mjs
// then open http://127.0.0.1:4174/ask/?api=http://127.0.0.1:4174/api/ask
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ask from '../api/ask.ts';
import * as voice from '../api/voice.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const routes = { '/api/ask': ask, '/api/voice': voice };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4174');
  const route = routes[url.pathname];
  if (route && (req.method === 'POST' || req.method === 'OPTIONS')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    const out = await route[req.method](request);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    return res.end(Buffer.from(await out.arrayBuffer()));
  }
  try {
    let file = resolve(join(root, normalize(decodeURIComponent(url.pathname))));
    if (file !== root && !file.startsWith(root + sep)) throw new Error('out');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(4174, '127.0.0.1', () => console.log('http://127.0.0.1:4174'));
