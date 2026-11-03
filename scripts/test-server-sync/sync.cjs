#!/usr/bin/env node
'use strict';
/*
 * Test server -> GitHub one-way sync, pushed to the `test-server` branch.
 *
 * The test server has no git and cannot reach github.com (only api.github.com),
 * so this talks to the GitHub REST API directly: it hashes the whitelisted
 * files the way git does, diffs them against the branch tree, and writes only
 * the changes as new trees + one commit. main is never touched.
 *
 * Usage:  node sync.cjs [--dry-run] [--server-dir C:\startpoint-test] [--sync-root C:\startpoint-sync]
 * Exit 0 = synced or nothing to do, 1 = error (nothing half-written: the ref
 * moves only after the commit exists), 2 = blocked by the secret scan.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ---------- configuration ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };

const SERVER_DIR = opt('--server-dir', 'C:\\startpoint-test');
const SYNC_ROOT = opt('--sync-root', 'C:\\startpoint-sync');
const OWNER = 'kuronzzhan-droid';
const REPO = 'startpoint-cn';
const BRANCH = opt('--branch', 'test-server');
const BASE_BRANCH = 'main';
const DRY_RUN = flag('--dry-run');
const MAX_FILE = 50 * 1024 * 1024;     // hard cap per file (blob API limit is 100MB)
const MAX_BINARY = 1024 * 1024;        // new binaries above this are skipped (repo hygiene rule)
const INLINE_MAX = 512 * 1024;         // larger text files are uploaded as blobs
const CHUNK_BYTES = 4 * 1024 * 1024;   // inline content per create-tree call
const CHUNK_FILES = 300;

// Mirrored top-level paths. Everything else on the server stays out.
// out/ is included on purpose: the live server runs from out/ and many fixes
// since 10-22 exist only there.
// docs/, apk-patches/, client-patch/ and deployment/ are not deployed to the
// server, so they are left as they are on the branch (maintained via main).
const INCLUDE_DIRS = ['src', 'out', 'assets', 'web', 'scripts', 'tools', 'admin', 'data'];
// Paths that exist only in the repo, never on the server: never deleted.
const KEEP_ON_BRANCH = [/^assets\/asset-patch\/(audit|artwork)\//];
const INCLUDE_FILES = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.cn.json',
  'tailwind.config.js', 'README.md'];

// Never synced, at any depth. Remote files matching these are also never deleted.
const EXCLUDE_DIRS = new Set(['node_modules', '.git', '.cdn', '.database', '.logs', 'logs', 'tmp', 'dist',
  'build', 'config', '.migration-backups', '.codex-backups', '__pycache__', 'gacha_odds', 'cn-traffic']);
const EXCLUDE_FILE_RE = [
  /^\.env($|\.)/i, /\.(bak|old|orig)([-.]|$)/i, /\.pre-[^/]*$/i, /-before$/i,
  /\.(apk|aab|keystore|jks|pem|key|p12|pfx|crt)$/i,
  /\.(log|db|db-shm|db-wal|sqlite|sqlite3)$/i,
  /^save_.*\.json$/i, /^save_data\.json$/i, /^confirmed_seeds\.json$/i, /\.backup\.json$/i,
  /\.(zip|7z|rar|exe|dll|node|pdb)$/i,
  /^id_(rsa|ed25519|ecdsa)/i, /^known_hosts$/i, /token\.txt$/i,
];

// Content checks on every added/changed file. Any hit aborts the whole run.
const SECRET_RES = [
  [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS key'],
  [/\bsk-(ant-|proj-)?[A-Za-z0-9_-]{30,}/, 'API key'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\b175\.178\.160\.158\b/, 'test server IP'],
  [/\b120\.77\.154\.101\b/, 'StarView server IP'],
  [/\b192\.168\.(?!1\.10\b)\d+\.\d+/, 'LAN IP'],
  [/\/Users\/[A-Za-z0-9_]+/, 'home path'],
  [/[A-Za-z]:\\\\?Users\\\\?(?!Public|Default|Alice)[A-Za-z0-9_.-]+/, 'Windows home path'],
  [/[A-Za-z0-9._%+-]+@(qq|gmail|163|126|outlook|hotmail|foxmail|yahoo)\.com/i, 'personal email'],
];
// Lines already present in the repo that are known false positives.
const SECRET_ALLOW = [
  /jeanphilippe\.aumasson@gmail\.com/,      // Node.js license notice
  /C:\/Users\/Alice|C:\\\\Users\\\\Alice/,  // test fixtures
];

// ---------- helpers ----------
fs.mkdirSync(SYNC_ROOT, { recursive: true });
const LOG = path.join(SYNC_ROOT, 'sync.log');
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

const TOKEN_FILE = path.join(SYNC_ROOT, 'token.txt');
const TOKEN = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(method, url, body, { allow404 = false } = {}) {
  const full = url.startsWith('http') ? url : `https://api.github.com/repos/${OWNER}/${REPO}${url}`;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(full, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'startpoint-test-sync',
          ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (attempt >= 4) throw new Error(`${method} ${url}: ${e.message}`);
      await sleep(5000 * 2 ** attempt);
      continue;
    }
    if (res.status === 404 && allow404) return null;
    if (res.ok) return res.status === 204 ? null : res.json();
    const text = await res.text();
    const limited = res.status === 429 || (res.status === 403 && /rate limit/i.test(text));
    if ((limited || res.status >= 500) && attempt < 4) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 60000 * (attempt + 1);
      log(`${method} ${url} -> ${res.status}, waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  }
}

function excludedPath(rel) {
  const parts = rel.split('/');
  if (parts.slice(0, -1).some((p) => EXCLUDE_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  return EXCLUDE_FILE_RE.some((re) => re.test(base));
}
function inScope(rel) {
  const top = rel.split('/')[0];
  return rel.includes('/') ? INCLUDE_DIRS.includes(top) : INCLUDE_FILES.includes(rel);
}

function walk(dirAbs, relBase, out) {
  let entries;
  try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    const abs = path.join(dirAbs, e.name);
    if (e.isSymbolicLink()) continue;              // .cdn is a junction; never follow links
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) walk(abs, rel, out);
    } else if (e.isFile() && !excludedPath(rel)) {
      out.push({ rel, abs });
    }
  }
}

function isText(buf) {
  if (buf.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; }
}
const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

function scan(rel, text) {
  const hits = [];
  for (const line of text.split('\n')) {
    if (SECRET_ALLOW.some((re) => re.test(line))) continue;
    for (const [re, label] of SECRET_RES) {
      if (re.test(line)) hits.push(`${label}: ${rel}`);
    }
  }
  if (TOKEN && text.includes(TOKEN)) hits.push(`sync token itself: ${rel}`);
  return [...new Set(hits)];
}

// Findings already public on main that gitleaks flags as generic-api-key:
// a fixed protocol stub token and Kakao's public infodesk reply.
const GITLEAKS_EXTRA_PATHS = [
  'out/routes/openapi\\.js$', 'out/routes/infodesk\\.js$',
  'src/routes/openapi\\.ts$', 'src/routes/infodesk\\.ts$',
];

function gitleaksConfig(repoToml) {
  // Reuse the repo's allowlist; make every path rule match both / and \
  // because gitleaks reports Windows paths with backslashes.
  const Q = "'''";
  const sep = (re) => re.replace(/\//g, '[\\\\/]');
  const block = (name) => {
    if (!repoToml) return [];
    const m = repoToml.match(new RegExp(`^${name}\\s*=\\s*\\[([\\s\\S]*?)^\\]`, 'm'));
    return m ? m[1].split(Q).filter((_, i) => i % 2 === 1) : [];
  };
  const paths = [...block('paths'), ...GITLEAKS_EXTRA_PATHS].map(sep);
  const regexes = block('regexes');
  const list = (xs) => xs.map((x) => `  ${Q}${x}${Q}`).join(',\n');
  return `[extend]\nuseDefault = true\n\n[allowlist]\ndescription = "repo allowlist + sync extras"\n` +
    `paths = [\n${list(paths)}\n]\nregexes = [\n${list(regexes)}\n]\n`;
}

function gitleaks(files, repoToml) {
  // Second opinion: scan exactly the files about to be pushed.
  const exe = path.join(SYNC_ROOT, 'gitleaks.exe');
  if (!fs.existsSync(exe)) return { ran: false };
  const stage = path.join(SYNC_ROOT, 'stage');
  const conf = path.join(SYNC_ROOT, 'gitleaks-sync.toml');
  const report = path.join(SYNC_ROOT, 'gitleaks-report.json');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(report, { force: true });
  fs.writeFileSync(conf, gitleaksConfig(repoToml));
  for (const f of files) {
    const dst = path.join(stage, ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, f.buf);
  }
  try {
    execFileSync(exe, ['dir', stage, '--config', conf, '--no-banner', '--redact', '--exit-code', '3',
      '--report-format', 'json', '--report-path', report], { stdio: 'pipe' });
    return { ran: true, ok: true, hits: [] };
  } catch (e) {
    if (e.status !== 3) return { ran: true, ok: false, hits: [`gitleaks failed to run: ${String(e.stderr || e.message).slice(0, 300)}`] };
    let hits;
    try {
      hits = JSON.parse(fs.readFileSync(report, 'utf8')).map((r) =>
        `gitleaks ${r.RuleID}: ${path.relative(stage, r.File).split(path.sep).join('/')}:${r.StartLine}`);
    } catch { hits = ['gitleaks: leaks found (report unreadable)']; }
    return { ran: true, ok: false, hits };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

// ---------- main ----------
async function main() {
  if (typeof fetch !== 'function') throw new Error(`node ${process.version} has no fetch; need node 18+`);
  if (!DRY_RUN && !TOKEN) throw new Error(`token missing: ${TOKEN_FILE}`);
  if (!fs.existsSync(SERVER_DIR)) throw new Error(`server dir missing: ${SERVER_DIR}`);

  // 1. Remote state: the sync branch, or main when the branch does not exist yet.
  let ref = await gh('GET', `/git/ref/heads/${BRANCH}`, null, { allow404: true });
  const branchExists = !!ref;
  if (!ref) ref = await gh('GET', `/git/ref/heads/${BASE_BRANCH}`);
  const headSha = ref.object.sha;
  const headCommit = await gh('GET', `/git/commits/${headSha}`);
  const tree = await gh('GET', `/git/trees/${headCommit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('remote tree listing truncated');
  const remote = new Map();
  for (const t of tree.tree) if (t.type === 'blob') remote.set(t.path, t);

  // 2. Local state.
  const files = [];
  for (const d of INCLUDE_DIRS) walk(path.join(SERVER_DIR, d), d, files);
  for (const f of INCLUDE_FILES) {
    const abs = path.join(SERVER_DIR, f);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) files.push({ rel: f, abs });
  }

  const changed = [];
  const skipped = [];
  const localPaths = new Set();
  // (size, mtime) -> sha cache so hourly runs only read files that changed.
  const CACHE = path.join(SYNC_ROOT, 'hash-cache.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { cache = {}; }
  const nextCache = {};
  for (const f of files) {
    const st = fs.statSync(f.abs);
    const size = st.size;
    if (size > MAX_FILE) { skipped.push(`${f.rel} (${(size / 1048576).toFixed(1)}MB)`); continue; }
    const key = `${size}:${Math.floor(st.mtimeMs)}`;
    const hit = cache[f.rel];
    if (hit && hit[0] === key && remote.get(f.rel)?.sha === hit[1]) {
      localPaths.add(f.rel); nextCache[f.rel] = hit; continue;
    }
    let buf = fs.readFileSync(f.abs);
    const text = isText(buf);
    if (text) buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'); // repo is LF everywhere
    else if (size > MAX_BINARY && !remote.has(f.rel) && !/\.(json|csv|md)$/i.test(f.rel)) { skipped.push(`${f.rel} (binary ${(size / 1048576).toFixed(1)}MB)`); continue; }
    localPaths.add(f.rel);
    const sha = gitSha(buf);
    nextCache[f.rel] = [key, sha];
    const r = remote.get(f.rel);
    if (r && r.sha === sha) continue;
    changed.push({ rel: f.rel, buf, text, mode: r ? r.mode : '100644', isNew: !r });
  }
  fs.writeFileSync(CACHE, JSON.stringify(nextCache));
  const deleted = [];
  for (const [p] of remote) {
    if (inScope(p) && !excludedPath(p) && !KEEP_ON_BRANCH.some((re) => re.test(p)) && !localPaths.has(p) && !skipped.some((s) => s.startsWith(p + ' '))) deleted.push(p);
  }

  const version = (() => {
    try {
      const m = fs.readFileSync(path.join(SERVER_DIR, 'assets', 'asset-patch', 'manifest.json'), 'utf8')
        .match(/"cdn_version"\s*:\s*"([^"]+)"/);
      return m ? m[1] : 'unknown';
    } catch { return 'unknown'; }
  })();

  // 3. Report.
  const report = [
    `server ${version}, remote ${branchExists ? BRANCH : BASE_BRANCH + ' (branch not created yet)'} @ ${headSha.slice(0, 8)}`,
    `added ${changed.filter((c) => c.isNew).length}, modified ${changed.filter((c) => !c.isNew).length}, deleted ${deleted.length}, skipped ${skipped.length}`,
    '', '# added', ...changed.filter((c) => c.isNew).map((c) => c.rel),
    '', '# modified', ...changed.filter((c) => !c.isNew).map((c) => c.rel),
    '', '# deleted', ...deleted,
    '', '# skipped (too large / binary)', ...skipped,
  ].join('\n');
  fs.writeFileSync(path.join(SYNC_ROOT, 'last-diff.txt'), report + '\n');
  log(report.split('\n').slice(0, 2).join(' | '));

  if (!changed.length && !deleted.length) { log('no changes'); return 0; }

  // 4. Secret scan, fail closed.
  const hits = changed.filter((c) => c.text).flatMap((c) => scan(c.rel, c.buf.toString('utf8')));
  let repoToml = '';
  const tomlEntry = remote.get('.gitleaks.toml');
  if (tomlEntry) repoToml = Buffer.from((await gh('GET', `/git/blobs/${tomlEntry.sha}`)).content, 'base64').toString('utf8');
  const gl = gitleaks(changed, repoToml);
  if (gl.ran && !gl.ok) hits.push(...gl.hits);
  if (!gl.ran) log('gitleaks.exe not present, built-in scan only');
  if (hits.length) {
    fs.writeFileSync(path.join(SYNC_ROOT, 'blocked.txt'), hits.join('\n') + '\n');
    log(`BLOCKED by secret scan (${hits.length} hits), see blocked.txt; nothing pushed`);
    return 2;
  }

  if (DRY_RUN) { log('dry run: see last-diff.txt, nothing pushed'); return 0; }

  // 5. Write trees in chunks. Text goes inline; binaries become blobs first.
  const entries = [];
  for (const c of changed) {
    if (c.text && c.buf.length <= INLINE_MAX) {
      entries.push({ bytes: c.buf.length, e: { path: c.rel, mode: c.mode, type: 'blob', content: c.buf.toString('utf8') } });
    } else {
      const blob = await gh('POST', '/git/blobs', { content: c.buf.toString('base64'), encoding: 'base64' });
      entries.push({ bytes: 100, e: { path: c.rel, mode: c.mode, type: 'blob', sha: blob.sha } });
      await sleep(1000); // stay under the content-creation rate limit
    }
  }
  for (const p of deleted) entries.push({ bytes: 100, e: { path: p, mode: remote.get(p).mode, type: 'blob', sha: null } });

  let baseTree = headCommit.tree.sha;
  for (let i = 0; i < entries.length;) {
    const chunk = [];
    let bytes = 0;
    while (i < entries.length && chunk.length < CHUNK_FILES && (chunk.length === 0 || bytes + entries[i].bytes <= CHUNK_BYTES)) {
      bytes += entries[i].bytes;
      chunk.push(entries[i++].e);
    }
    const t = await gh('POST', '/git/trees', { base_tree: baseTree, tree: chunk });
    baseTree = t.sha;
    log(`tree ${i}/${entries.length}`);
  }

  // 6. Commit and move the branch.
  const prev = (() => {
    const r = remote.get('assets/asset-patch/manifest.json');
    return r ? r.sha : null;
  })();
  let prevVersion = '';
  if (prev) {
    const b = await gh('GET', `/git/blobs/${prev}`);
    const m = Buffer.from(b.content, 'base64').toString('utf8').match(/"cdn_version"\s*:\s*"([^"]+)"/);
    if (m) prevVersion = m[1];
  }
  const range = prevVersion && prevVersion !== version ? `${prevVersion}\u2013${version}` : version;
  const message = `sync: 测试服 ${range}\n\nAutomatic sync from the test server: ` +
    `${changed.filter((c) => c.isNew).length} added, ${changed.filter((c) => !c.isNew).length} modified, ${deleted.length} deleted.\n`;
  const commit = await gh('POST', '/git/commits', {
    message, tree: baseTree, parents: [headSha],
    author: { name: 'startpoint-test-sync', email: `${OWNER}@users.noreply.github.com` },
  });
  if (branchExists) await gh('PATCH', `/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
  else await gh('POST', '/git/refs', { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  log(`pushed ${BRANCH} ${commit.sha.slice(0, 8)} (${range})`);
  return 0;
}

// Single instance: the deploy hook and the scheduled task may overlap.
const LOCK = path.join(SYNC_ROOT, 'sync.lock');
let lockFd;
try {
  lockFd = fs.openSync(LOCK, 'wx');
} catch {
  const age = Date.now() - fs.statSync(LOCK).mtimeMs;
  if (age < 60 * 60 * 1000) { log('another sync is running, skip'); process.exit(0); }
  fs.rmSync(LOCK, { force: true });              // stale lock from a crashed run
  lockFd = fs.openSync(LOCK, 'wx');
}
main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { log(`ERROR: ${e.message.replace(TOKEN || '\u0000', '***')}`); process.exitCode = 1; })
  .finally(() => { fs.closeSync(lockFd); fs.rmSync(LOCK, { force: true }); });
