import http from 'node:http';
import {createReadStream} from 'node:fs';
import {realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCommunityHandler} from './handler.mjs';
import {openDatabase} from './sqlite-adapter.mjs';
import {developmentTools} from './development.mjs';
import catalog from './catalog.mjs';
import {localSecrets} from './local-secrets.mjs';
import {normalizeEmail} from './password-crypto.mjs';
const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2'};
async function sendWebResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}
async function serveFile(req, res, root, url) {
  if (!['GET', 'HEAD'].includes(req.method)) {res.writeHead(405); res.end(); return;}
  let decoded;
  try {decoded = decodeURIComponent(url.pathname);} catch {res.writeHead(400); res.end(); return;}
  if (decoded.split(/[\\/]/).some((part) => part.startsWith('.') || part.includes(':'))) {res.writeHead(404); res.end(); return;}
  let file, info;
  try {
    file = await realpath(path.join(root, decoded === '/' ? 'index.html' : decoded));
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error();
    info = await stat(file); if (!info.isFile()) throw new Error();
  } catch {res.writeHead(404); res.end('Not found'); return;}
  const headers = {'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff'};
  let start = 0, end = info.size - 1, status = 200;
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && (range[1] || range[2])) {
      if (!range[1]) start = Math.max(0, info.size - Number(range[2]));
      else {start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2]));}
    }
    if (!range || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      res.writeHead(416, {'Content-Range': `bytes */${info.size}`}); res.end(); return;
    }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1)); res.writeHead(status, headers);
  if (req.method === 'HEAD' || !info.size) {res.end(); return;}
  createReadStream(file, {start, end}).on('error', () => res.destroy()).pipe(res);
}
export async function startLocalServer({site, db = ':memory:', port = 0, trustedCatalog = catalog, ownerEmail, deputyEmail, authMode = 'password'}) {
  const root = await realpath(site);
  if (!['access', 'password'].includes(authMode)) throw new Error('Invalid authMode');
  if (authMode === 'password') ownerEmail = normalizeEmail(ownerEmail);
  if (deputyEmail) deputyEmail = normalizeEmail(deputyEmail);
  const privateConfig = await localSecrets(db, root), database = openDatabase(privateConfig.database);
  const handler = createCommunityHandler(trustedCatalog, {development: developmentTools(privateConfig.secrets.COMMUNITY_COOKIE_SECRET)});
  const env = {COMMUNITY_DB: database, ...privateConfig.secrets, COMMUNITY_AUTH_MODE: authMode, COMMUNITY_OWNER_EMAIL: ownerEmail,
    COMMUNITY_INITIAL_DEPUTY_EMAIL: deputyEmail,
    COMMUNITY_ALLOWED_HOSTNAMES: '127.0.0.1,localhost', TURNSTILE_SECRET: 'LOCAL-ONLY', TURNSTILE_SITE_KEY: 'LOCAL-ONLY'};
  const server = http.createServer(async (req, res) => {
    try {
      const origin = `http://${req.headers.host}`;
      const url = new URL(req.url, origin);
      const allowedHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      if (!allowedHosts.includes(req.headers.host) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== String(server.address().port)) {
        res.writeHead(403); res.end('Loopback only'); return;
      }
      if (!url.pathname.startsWith('/api/community/')) return await serveFile(req, res, root, url);
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) {res.writeHead(413, {'Content-Type': 'application/json'}); res.end(JSON.stringify({error: 'body_too_large', message: '提交内容过长。'})); return;}
        chunks.push(chunk);
      }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, {method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? {body} : {})});
      await sendWebResponse(res, await handler(request, env));
    } catch {if (!res.headersSent) res.writeHead(500); res.end('Local server error');}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});
  return {server, database, origin: `http://127.0.0.1:${server.address().port}`, async close() {
    await new Promise((resolve) => server.close(resolve)); database.close();
  }};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), settings = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--site', '--db', '--port', '--owner-email', '--deputy-email'].includes(args[i]) || !args[i + 1]) throw new Error('Use --site PATH --db PATH --port NUMBER --owner-email EMAIL [--deputy-email EMAIL]');
    settings[({'--owner-email': 'ownerEmail', '--deputy-email': 'deputyEmail'})[args[i]] || args[i].slice(2)] = args[i + 1];
  }
  if (!settings.site || !settings.db || !/^\d+$/.test(settings.port || '') || +settings.port > 65535) throw new Error('Explicit --site, --db and --port are required.');
  const app = await startLocalServer({...settings, port: +settings.port});
  console.log(`Wiki local preview: ${app.origin}; password admin with local test challenge; SQLite: ${settings.db}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {await app.close(); process.exit(0);});
}
