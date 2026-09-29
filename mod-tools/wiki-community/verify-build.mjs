// Run against a local Wrangler output directory; never uploads or contacts Cloudflare.
import assert from 'node:assert/strict';
import {readFile, writeFile, stat} from 'node:fs/promises';
import {writeSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openDatabase} from './sqlite-adapter.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node verify-build.mjs ABSOLUTE_BUILD_DIRECTORY');
const root = path.resolve(directory);
const bundlePath = path.join(root, 'index.js');
const [source, metadata, routes] = await Promise.all([
  readFile(bundlePath, 'utf8'), readFile(path.join(root, 'bundle-meta.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, '_routes.json'), 'utf8').then(JSON.parse)
]);
const inputs = Object.keys(metadata.inputs);
for (const input of inputs) assert.ok(!/(?:^|\/)(?:development|local-server|sqlite-adapter|verify-build)\.mjs$|(?:^|\/)tests\//.test(input), input);
assert.ok(!/node:sqlite|development-admin-login|development-challenge|dev-admin@example\.test|C:[/\\]|D:[/\\]|sourceMappingURL/.test(source));
assert.deepEqual(routes.include, ['/api/community/*']); assert.deepEqual(routes.exclude, []);
assert.ok(inputs.some((name) => name.endsWith('api/community/[[path]].js')));
const db = openDatabase();
const assets = [];
const env = {COMMUNITY_DB: db, COMMUNITY_COOKIE_SECRET: 'c'.repeat(40), COMMUNITY_IP_SALT: 'i'.repeat(40),
  COMMUNITY_ALLOWED_HOSTNAMES: 'wiki.example', TURNSTILE_SECRET: 'fixture-only', TURNSTILE_SITE_KEY: 'fixture-public',
  ACCESS_TEAM_DOMAIN: 'wiki-test.cloudflareaccess.com', ACCESS_AUD: 'fixture', ADMIN_EMAILS: 'admin@example.test',
  DEVELOPMENT: true, ASSETS: {async fetch(request) {
    assets.push(new URL(request.url).pathname); return new Response('fixture-static-asset', {headers: {'X-Fixture-Asset': 'yes'}});
  }}};
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {throw new Error('Network access is forbidden during build verification');};
let checks = 0;
try {
  const worker = (await import(pathToFileURL(bundlePath).href)).default;
  const runtime = {waitUntil() {throw new Error('Unexpected background task');}};
  async function call(route, options = {}, bindings = env) {
    return worker.fetch(new Request(`https://wiki.example${route}`, {headers: {Origin: 'https://wiki.example', 'Content-Type': 'application/json'}, ...options}), bindings, runtime);
  }
  for (const route of ['/', '/data.js', '/media/sample.mp3', '/api/community-other/config']) {
    const response = await call(route); assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Fixture-Asset'), 'yes'); checks++;
  }
  const disabled = await call('/api/community/config', {}, {ASSETS: env.ASSETS});
  assert.equal(disabled.status, 503); assert.equal((await disabled.json()).enabled, false); checks++;
  const config = await call('/api/community/config'); const data = await config.json();
  assert.equal(config.status, 200); assert.equal(data.canSubmit, false); assert.equal(data.development, undefined); checks++;
  const forbidden = await call('/api/community/teams', {method: 'POST', body: '{}'});
  assert.equal(forbidden.status, 403); checks++;
  assert.equal((await call('/api/community/development-admin-login', {method: 'POST', body: '{}'})).status, 404); checks++;
  assert.equal((await call('/api/community/development-challenge?action=like_team')).status, 404); checks++;
  assert.equal((await call('/api/community/admin/me', {headers: {'Cf-Access-Authenticated-User-Email': 'admin@example.test'}})).status, 401); checks++;
  assert.equal(assets.length, 4);
  const report = {wrangler: '4.143.0', verifiedAt: new Date().toISOString(),
    bundle: {file: 'index.js', bytes: (await stat(bundlePath)).size, sha256: createHash('sha256').update(source).digest('hex')},
    productionModuleInputs: inputs.filter((name) => !name.includes('node_modules') && !name.includes('.wrangler')),
    routes, staticFallbackPaths: assets, runtimeChecksPassed: checks, containsLocalPaths: false,
    developmentModulesBundled: false, networkUsed: false, cloudDeployed: false,
    scope: 'Wrangler compiled bundle with local JavaScript request execution and SQLite; not a live Cloudflare runtime acceptance'};
  await writeFile(path.join(root, 'verification.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeSync(1, JSON.stringify({bytes: report.bundle.bytes, sha256: report.bundle.sha256, runtimeChecksPassed: checks, report: path.join(root, 'verification.json')}) + '\n');
} finally {globalThis.fetch = originalFetch; db.close();}
