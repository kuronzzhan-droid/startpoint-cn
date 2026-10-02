// Run against a local Wrangler output directory; never uploads or contacts Cloudflare.
import assert from 'node:assert/strict';
import {readFile, writeFile, stat} from 'node:fs/promises';
import {writeSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openDatabase} from './sqlite-adapter.mjs';
import catalog from './catalog.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node verify-build.mjs ABSOLUTE_BUILD_DIRECTORY');
const root = path.resolve(directory);
const bundlePath = path.join(root, 'index.js');
const [source, metadata, routes] = await Promise.all([
  readFile(bundlePath, 'utf8'), readFile(path.join(root, 'bundle-meta.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, '_routes.json'), 'utf8').then(JSON.parse)
]);
const inputs = Object.keys(metadata.inputs);
for (const input of inputs) assert.ok(!/(?:^|\/)(?:development|local-server|local-secrets|sqlite-adapter|verify-build)\.mjs$|(?:^|\/)tests\//.test(input), input);
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
const originalNow = Date.now;
let verificationNow = Date.parse('2026-10-02T04:00:00Z');
Date.now = () => verificationNow;
globalThis.fetch = async () => {throw new Error('Network access is forbidden during build verification');};
let checks = 0;
try {
  const worker = (await import(pathToFileURL(bundlePath).href)).default;
  const runtime = {waitUntil() {throw new Error('Unexpected background task');}};
  async function call(route, options = {}, bindings = env) {
    return worker.fetch(new Request(`https://wiki.example${route}`, {...options,
      headers: {Origin: 'https://wiki.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...options.headers}}), bindings, runtime);
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
  const passwordEnv = {...env, COMMUNITY_AUTH_MODE: 'password', COMMUNITY_OWNER_EMAIL: 'owner@example.test',
    COMMUNITY_PASSWORD_PEPPER: 'p'.repeat(40), COMMUNITY_OWNER_BOOTSTRAP_TOKEN: 'b'.repeat(40)};
  const passwordConfig = await (await call('/api/community/config', {}, passwordEnv)).json();
  assert.equal(passwordConfig.authMode, 'password'); assert.equal(passwordConfig.needsSetup, true);
  assert.ok(!JSON.stringify(passwordConfig).includes('@')); checks++;
  assert.equal((await call('/api/community/auth/bootstrap', {method: 'POST', body: JSON.stringify({email: 'owner@example.test', password: 'fixture-only-password'})}, passwordEnv)).status, 403); checks++;
  const boot = await call('/api/community/auth/bootstrap', {method: 'POST', body: JSON.stringify({email: 'owner@example.test', password: 'fixture-only-password', bootstrapToken: 'b'.repeat(40)})}, passwordEnv);
  assert.equal(boot.status, 201); assert.match(boot.headers.get('set-cookie'), /; Secure/); checks++;
  const ownerCookie = boot.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await call('/api/community/admin/users', {headers: {Cookie: ownerCookie}}, passwordEnv)).json()).items[0].role, 'owner'); checks++;
  assert.equal((await call('/api/community/admin/users', {headers: {'Cf-Access-Authenticated-User-Email': 'owner@example.test'}}, passwordEnv)).status, 401); checks++;
  assert.equal((await call('/api/community/development-admin-login', {method: 'POST', body: '{}'}, passwordEnv)).status, 404); checks++;
  const characterIds = Object.keys(catalog.characters).slice(0, 3);
  assert.equal(characterIds.length, 3);
  const fixtureTeam = {main: characterIds, unison: ['', '', ''], weapon: ['', '', ''], soul: ['', '', '']};
  const createPrivate = await call('/api/community/admin/teams', {method: 'POST', headers: {Cookie: ownerCookie},
    body: JSON.stringify({title: '编译验证私盘', notes: '仅保存在验证内存库', author: '', category: '萌新启航',
      section: 'original', visibility: 'private', element: 'auto', damageTypes: ['skill'], team: fixtureTeam})}, passwordEnv);
  assert.equal(createPrivate.status, 201);
  const privateTeam = (await createPrivate.json()).team;
  assert.equal(privateTeam.visibility, 'private'); assert.equal(privateTeam.gameCode, null); checks++;
  const publicTeams = await (await call('/api/community/teams')).json();
  assert.deepEqual(publicTeams.items, []);
  assert.equal((await call(`/api/community/teams/${privateTeam.id}`)).status, 404); checks++;
  const createCode = await call(`/api/community/admin/teams/${privateTeam.id}/game-code`, {method: 'POST',
    headers: {Cookie: ownerCookie}, body: JSON.stringify({expectedRevision: privateTeam.revision})}, passwordEnv);
  assert.equal(createCode.status, 200); const publishedCode = (await createCode.json()).gameCode;
  assert.match(publishedCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/); checks++;
  const lookup = await call(`/api/community/game-codes/${publishedCode}`); assert.equal(lookup.status, 200);
  const shared = await lookup.json(); assert.deepEqual(shared.team, fixtureTeam);
  assert.deepEqual(Object.keys(shared).sort(), ['active', 'team', 'title']); checks++;
  const noticePath = '/api/community/admin/announcement';
  assert.equal((await call(noticePath)).status, 401); checks++;
  const noticeWrite = await call(noticePath, {method:'PATCH', headers:{Cookie:ownerCookie},
    body:JSON.stringify({text:'编译验证公告',expectedRevision:0})}, passwordEnv);
  assert.equal(noticeWrite.status,200); assert.equal((await noticeWrite.json()).revision,1);
  const publicNotice = await call('/api/community/announcement');
  assert.equal(publicNotice.status,200); assert.equal(publicNotice.headers.get('set-cookie'),null);
  assert.equal((await publicNotice.json()).text,'编译验证公告'); checks++;
  const keyword = encodeURIComponent(catalog.characters[characterIds[0]].name);
  assert.deepEqual((await (await call(`/api/community/teams?q=${keyword}`)).json()).items, []); checks++;
  db.raw.prepare("UPDATE community_teams SET visibility='public' WHERE id=?").run(privateTeam.id);
  const nameSearch = await (await call(`/api/community/teams?q=${keyword}`)).json();
  assert.equal(nameSearch.items[0]?.id,privateTeam.id);
  assert.deepEqual((await (await call('/api/community/teams?q=__no_such_fixture__')).json()).items,[]);
  db.raw.prepare("UPDATE community_teams SET visibility='private' WHERE id=?").run(privateTeam.id); checks++;
  const aliasesPath = `/api/community/admin/aliases/character/${characterIds[0]}`;
  const aliasWrite = await call(aliasesPath, {method: 'PATCH', headers: {Cookie: ownerCookie},
    body: JSON.stringify({aliases: ['编译验证别名'], expectedRevision: 0})}, passwordEnv);
  assert.equal(aliasWrite.status, 200); const aliasRecord = await aliasWrite.json();
  assert.deepEqual(aliasRecord.aliases, ['编译验证别名']); assert.equal(aliasRecord.revision, 1); checks++;
  const publicAliases = await call('/api/community/aliases'); assert.equal(publicAliases.status, 200);
  assert.deepEqual((await publicAliases.json()).items, [aliasRecord]);
  assert.ok(!JSON.stringify(aliasRecord).includes('@')); checks++;
  assert.ok(data.sections.some((section) => section.value === 'original' && section.label === '原版'));
  assert.equal(privateTeam.section, 'original');
  const originals = await call('/api/community/admin/teams?section=original&scope=private', {headers: {Cookie: ownerCookie}}, passwordEnv);
  assert.equal(originals.status, 200); assert.equal((await originals.json()).items[0].id, privateTeam.id); checks++;
  const ratingPath = `/api/community/ratings/characters/${characterIds[0]}`;
  const ratingRead = await call(ratingPath); assert.equal(ratingRead.status, 200); const rating = await ratingRead.json();
  assert.deepEqual(Object.keys(rating).sort(), ['average', 'myScore', 'nextVoteAt', 'rankScore', 'ratedToday', 'voters']);
  assert.equal(rating.average, null); assert.equal(rating.rankScore, null);
  assert.equal(rating.myScore, null); assert.equal(rating.voters, 0); assert.equal(rating.ratedToday, false);
  const noChallenge = await call(ratingPath, {method: 'POST', body: JSON.stringify({score: 0})});
  assert.equal(noChallenge.status, 400); assert.equal((await noChallenge.json()).error, 'challenge_required');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS count FROM community_character_ratings').get().count, 0); checks++;
  const emptyRatings = await call('/api/community/ratings/characters');
  assert.equal(emptyRatings.status, 200); assert.equal(emptyRatings.headers.get('set-cookie'), null);
  const emptySnapshot = await emptyRatings.json();
  assert.deepEqual(emptySnapshot.items, []); assert.equal(emptySnapshot.refreshDay, '2026-10-02');
  assert.equal(emptySnapshot.stale, false);
  const seedRating = db.raw.prepare('INSERT INTO community_character_ratings(character_id,visitor_id,score,vote_day,updated_at) VALUES(?,?,?,?,?)');
  seedRating.run(characterIds[0], 'fixture-rating-a', 0, '2026-09-30', Date.now());
  seedRating.run(characterIds[1], 'fixture-rating-a', 2, '2026-09-30', Date.now());
  seedRating.run(characterIds[1], 'fixture-rating-b', 3, '2026-09-30', Date.now());
  assert.deepEqual((await (await call('/api/community/ratings/characters')).json()).items, []); checks++;
  verificationNow += 86_400_000;
  const aggregate = await call('/api/community/ratings/characters/');
  assert.equal(aggregate.status, 200); assert.equal(aggregate.headers.get('set-cookie'), null);
  assert.deepEqual((await aggregate.json()).items.sort((a, b) => a.id.localeCompare(b.id)),
    [{id: characterIds[0], average: 0, voters: 1, rankScore: 12.5 / 6},
      {id: characterIds[1], average: 2.5, voters: 2, rankScore: 2.5}].sort((a, b) => a.id.localeCompare(b.id))); checks++;
  db.raw.prepare('INSERT INTO community_tier_rankings VALUES(?,?,?,?)')
    .run('fixture-ranking-a', JSON.stringify({tier0:characterIds}), '2026-09-30', Date.now());
  verificationNow += 86_400_000;
  const rankings = await call('/api/community/tier-rankings');
  assert.equal(rankings.status, 200); assert.equal(rankings.headers.get('set-cookie'), null);
  const boards = await rankings.json();
  assert.deepEqual(Object.keys(boards).sort(), ['asOf', 'formula', 'nextRefreshAt', 'rankings', 'refreshDay', 'stale']);
  assert.deepEqual(boards.formula, {method: 'bayesian', priorVoters: 5, placementPrior: 3, ratingPrior: 2.5,
    tierMethod: 'raw-average', minimumTierVoters: 3});
  assert.deepEqual(boards.rankings.placement,
    [...characterIds].sort().map(id => ({id, average: 5, voters: 1, rankScore: 20 / 6, row: 'provisional'})));
  assert.deepEqual(boards.rankings.rating, [
    {id: characterIds[1], average: 2.5, voters: 2, rankScore: 2.5, row: 'provisional'},
    {id: characterIds[0], average: 0, voters: 1, rankScore: 12.5 / 6, row: 'provisional'}
  ]); checks++;
  const stats = await call('/api/community/stats');
  assert.equal(stats.status, 200); assert.equal(stats.headers.get('set-cookie'), null);
  const counts = await stats.json();
  assert.equal(counts.ratingVoters, 2); assert.equal(counts.tierVoters, 1); assert.equal(counts.onlineVisitors, 0);
  assert.equal(counts.totalVoters, 3);
  assert.equal(counts.presenceWindowSeconds, 1800); assert.ok(Number.isFinite(Date.parse(counts.asOf)));
  assert.ok(Number.isFinite(Date.parse(counts.participationAsOf))); assert.equal(counts.participationStale, false); checks++;
  const anonymousPresence = await call('/api/community/presence', {method:'POST', body:'{}'});
  assert.equal(anonymousPresence.status, 428); assert.equal(anonymousPresence.headers.get('set-cookie'), null); checks++;
  const visitorCookie = config.headers.get('set-cookie').split(';')[0];
  const presence = await call('/api/community/presence', {method:'POST', body:'{}', headers:{Cookie:visitorCookie}});
  assert.equal(presence.status, 200); assert.equal(presence.headers.get('set-cookie'), null);
  assert.equal((await presence.json()).onlineVisitors, 1); checks++;
  assert.equal((await call('/api/community/presence', {method:'POST', body:'{}', headers:{Cookie:visitorCookie, Origin:'https://other.example'}})).status, 403);
  assert.equal((await call('/api/community/presence')).status, 405); checks++;
  const viewPath = `/api/community/characters/${characterIds[0]}/views`;
  const emptyViews = await call(viewPath);
  assert.equal(emptyViews.status, 200); assert.equal(emptyViews.headers.get('set-cookie'), null);
  assert.deepEqual(await emptyViews.json(), {characterId:characterIds[0],views:0,windowSeconds:1800}); checks++;
  const anonymousView = await call(viewPath, {method:'POST',body:'{}'});
  assert.equal(anonymousView.status, 428); assert.equal(anonymousView.headers.get('set-cookie'), null);
  for (let repeat = 0; repeat < 2; repeat++) {
    const view = await call(viewPath, {method:'POST',body:'{}',headers:{Cookie:visitorCookie}});
    assert.equal(view.status, 200); assert.equal(view.headers.get('set-cookie'), null); assert.equal((await view.json()).views, 1);
  }
  assert.equal((await (await call(viewPath)).json()).views, 1); checks++;
  assert.equal((await call(viewPath, {method:'POST',body:'{}',headers:{Cookie:visitorCookie,Origin:'https://other.example'}})).status, 403);
  assert.equal((await call('/api/community/characters/not-public/views')).status, 404); checks++;
  const characterTeams = `/api/community/teams?character=${encodeURIComponent(characterIds[0])}`;
  assert.deepEqual((await (await call(characterTeams)).json()).items, [], 'publishing a private game code must not expose its related team');
  db.raw.prepare("UPDATE community_teams SET visibility='public' WHERE id=?").run(privateTeam.id);
  const related = await call(characterTeams); assert.equal(related.headers.get('set-cookie'), null);
  assert.deepEqual((await related.json()).items.map(item => item.id), [privateTeam.id]);
  assert.equal((await call('/api/community/teams?character=not-public')).status, 400); checks++;
  for (let i = 0; i < 2; i++) {
    seedRating.run(characterIds[0], `fixture-third-${i}`, 0, '2026-09-30', Date.now());
    db.raw.prepare('INSERT INTO community_tier_rankings VALUES(?,?,?,?)')
      .run(`fixture-third-${i}`, JSON.stringify({tier0: [characterIds[0]]}), '2026-09-30', Date.now());
  }
  const sameDay = (await (await call('/api/community/tier-rankings')).json()).rankings;
  assert.equal(sameDay.placement.find(item => item.id === characterIds[0]).row, 'provisional'); checks++;
  verificationNow += 86_400_000;
  const qualified = (await (await call('/api/community/tier-rankings')).json()).rankings;
  assert.equal(qualified.placement.find(item => item.id === characterIds[0]).row, 'tier0');
  assert.equal(qualified.rating.find(item => item.id === characterIds[0]).row, 'tier4');
  assert.equal(qualified.placement.find(item => item.id === characterIds[1]).row, 'provisional'); checks++;
  assert.equal(assets.length, 4);
  const report = {wrangler: '4.143.0', verifiedAt: new Date().toISOString(),
    bundle: {file: 'index.js', bytes: (await stat(bundlePath)).size, sha256: createHash('sha256').update(source).digest('hex')},
    productionModuleInputs: inputs.filter((name) => !name.includes('node_modules') && !name.includes('.wrangler')),
    routes, staticFallbackPaths: assets, runtimeChecksPassed: checks, containsLocalPaths: false,
    developmentModulesBundled: false, networkUsed: false, cloudDeployed: false,
    scope: 'Wrangler compiled bundle with local JavaScript request execution and SQLite; not a live Cloudflare runtime acceptance'};
  await writeFile(path.join(root, 'verification.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeSync(1, JSON.stringify({bytes: report.bundle.bytes, sha256: report.bundle.sha256, runtimeChecksPassed: checks, report: path.join(root, 'verification.json')}) + '\n');
} finally {globalThis.fetch = originalFetch; Date.now = originalNow; db.close();}
