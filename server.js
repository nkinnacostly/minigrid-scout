import http from 'node:http';
import path from 'node:path';
import { createReadStream, promises as fsp } from 'node:fs';
import { createApiHandler } from './server/api.js';

// Production server: the built app from dist/ plus the same API the Vite
// dev server mounts. Run `npm run build` first.
const root = path.resolve('dist');
const port = Number(process.env.PORT) || 5178;
const host = process.env.HOST || '0.0.0.0';

const api = createApiHandler({
  cacheDir: process.env.CACHE_DIR || path.resolve('.cache'),
  googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
  ionToken: process.env.CESIUM_ION_TOKEN,
});

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.join(root, pathname);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let stat = await fsp.stat(file).catch(() => null);
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = await fsp.stat(file).catch(() => null);
  }
  if (!stat?.isFile()) {
    // Unknown paths get the app, which reads its state from the #hash.
    file = path.join(root, 'index.html');
    stat = await fsp.stat(file);
  }
  const hashed = file.startsWith(path.join(root, 'assets') + path.sep);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  api(req, res, () => {
    serveStatic(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
});

// Analyses stream for a minute or two; don't let Node cut them off.
server.requestTimeout = 0;
server.listen(port, host, () => console.log(`Minigrid Scout on http://${host}:${port}`));
