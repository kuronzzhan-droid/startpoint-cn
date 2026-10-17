const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gacha-exec-preservation-'));
process.env.DATA_DIR = path.join(directory, 'database');
process.env.GACHA_SEED_DIR = path.join(directory, 'seeds');
process.env.GAME_VERBOSE_LOGS = 'false';
fs.mkdirSync(process.env.GACHA_SEED_DIR);
const Fastify = require('fastify');
const { pack, unpack } = require('msgpackr');
const { getDb } = require('../out/data/db');
const players = require('../out/data/domains/player');
const characters = require('../out/data/domains/character');
const items = require('../out/data/domains/item');
const mail = require('../out/data/domains/mail');
const gachaState = require('../out/data/domains/gacha');
const assets = require('../out/lib/assets');
const { drawGachaWithMetadataSync } = require('../out/lib/gacha');
const seed = require('../out/lib/seed-validator').default;
const { getPlayerCharacterAwakeUnlocksSync } = require('../out/data/domains/character_awake');
const { recordGachaRequest, drainGachaRequestSummary } = require('../out/lib/settlement-performance');
const db = getDb();
const app = Fastify({ logger: false });
app.addHook('onSend', (_request, reply, body, done) => done(null,
    String(reply.getHeader('content-type')).startsWith('application/x-msgpack') ? pack(body).toString('base64') : body));
test.before(async () => { await app.register(require('../out/routes/api/gacha').default, { prefix: '/gacha' }); });
test.after(async () => {
    await app.close(); await seed.close(); db.close();
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(directory, { recursive: true });
});
let sequence = 0;
async function player() {
    const account = require('../out/data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `preserve-${++sequence}`, status: 'normal' });
    const id = players.insertDefaultPlayerSync(account.id).id;
    players.updatePlayerSync({ id, vmoney: 10000, freeVmoney: 10000 });
    require('../out/data/activeAccount').saveAccountDefaultPlayer(account.id, id);
    const viewer = 790000000 + id;
    await require('../out/data/domains/session').insertSessionWithToken({ token: String(viewer), accountId: account.id, expires: new Date('2099-01-01'), type: 2 });
    return { id, viewer };
}
function request(p, gid, payment, type, count = 1) {
    return app.inject({ method: 'POST', url: '/gacha/exec', payload: {
        viewer_id: p.viewer, gacha_id: gid, payment_type: payment, type, number_of_exec: count,
    } });
}
function data(response) { assert.equal(response.statusCode, 200, response.body); return unpack(Buffer.from(response.body, 'base64')).data; }
function rng(initial) { let state = initial; return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296); }
function snapshot(id) {
    return { player: players.getPlayerSync(id), characters: characters.getPlayerCharactersSync(id),
        items: db.prepare('SELECT * FROM players_items WHERE player_id = ? ORDER BY id').all(id),
        history: db.prepare('SELECT * FROM players_receive_history WHERE player_id = ? ORDER BY id').all(id),
        gacha: gachaState.getPlayerGachaInfoListSync(id) };
}

test('both custom pools preserve deterministic draws, ticket debit, points and per-draw history', async () => {
    const p = await player();
    for (const gid of [990001, 990002]) {
        const pool = assets.getGachaSync(gid);
        items.setPlayerItemSync(p.id, pool.tenTicketItemId, 20);
        const historyBefore = snapshot(p.id).history.length;
        const random = crypto.randomInt;
        const controlledRandom = () => {
            const next = rng(123456);
            return (min, max) => {
                if (max === undefined) { max = min; min = 0; }
                return min + Math.floor(next() * (max - min));
            };
        };
        let expected, actual;
        try {
            crypto.randomInt = controlledRandom();
            expected = drawGachaWithMetadataSync(pool, 20).map(row => row.id);
            crypto.randomInt = controlledRandom();
            actual = data(await request(p, gid, 3, 4, 2));
        } finally { crypto.randomInt = random; }
        assert.deepEqual(actual.draw.map(row => row.character_id), expected);
        assert.equal(items.getPlayerItemSync(p.id, pool.tenTicketItemId), 18);
        assert.equal(actual.item_list[pool.tenTicketItemId], 18);
        assert.equal(gachaState.getPlayerGachaInfoSync(p.id, gid).gachaExchangePoint, 20);
        assert.equal(snapshot(p.id).history.length - historyBefore, 20);
        for (const id of expected) assert.ok(characters.getPlayerCharacterSync(p.id, id));
    }
});

test('single and ten-pull currency costs and equipment grants remain consistent', async () => {
    const p = await player();
    for (const [gid, type, count] of [[1, 1, 1], [1, 2, 10], [3, 1, 1], [3, 2, 10]]) {
        const pool = assets.getGachaSync(gid);
        const before = players.getPlayerSync(p.id);
        const result = data(await request(p, gid, 1, type));
        const cost = count === 1 ? pool.singleCost : pool.multiCost;
        assert.equal(players.getPlayerSync(p.id).freeVmoney, before.freeVmoney - cost);
        assert.equal(players.getPlayerSync(p.id).vmoney, before.vmoney);
        assert.equal((gid === 3 ? result.draw_equipment : result.draw).length, count);
        assert.equal(result.user_info.free_vmoney, before.freeVmoney - cost);
    }
});

test('legacy pools keep daily paid summons and reject repeats without further debit', async () => {
    const p = await player();
    for (const [gid, cost] of [[1, 50], [3, 25]]) {
        const before = players.getPlayerSync(p.id);
        const result = data(await request(p, gid, 2, 5));
        assert.equal(players.getPlayerSync(p.id).vmoney, before.vmoney - cost);
        assert.equal(players.getPlayerSync(p.id).freeVmoney, before.freeVmoney);
        assert.equal((gid === 3 ? result.draw_equipment : result.draw).length, 1);
        assert.equal(result.user_info.vmoney, before.vmoney - cost);
        const after = snapshot(p.id);
        const repeat = await request(p, gid, 2, 5);
        assert.equal(repeat.statusCode, 400);
        assert.equal(repeat.json().message, 'Already did daily paid summon.');
        assert.deepEqual(snapshot(p.id), after);
    }
});

test('gacha still repairs eligible old characters even when they were not drawn', async () => {
    const p = await player();
    for (const id of [211002, 341005]) {
        if (!characters.playerOwnsCharacterSync(p.id, id)) characters.insertDefaultPlayerCharacterSync(p.id, id);
        const learned = new Set(characters.getPlayerCharacterManaNodesSync(p.id, id));
        characters.insertPlayerCharacterManaNodesSync(p.id, id,
            Object.keys(assets.getCharacterManaNodesSync(id, 1)).map(Number).filter(node => !learned.has(node)));
        db.prepare(`INSERT INTO players_character_quest_clears (player_id, character_id, clear_count,
            multi_count, leader_clear_count, leader_multi_count, leader_power_flip_count) VALUES (?, ?, 5, 0, 0, 0, 0)`).run(p.id, id);
    }
    const result = data(await request(p, 1, 1, 1));
    for (const id of [211002, 341005]) {
        assert.deepEqual(getPlayerCharacterAwakeUnlocksSync(p.id).get(String(id)), { 1: 1 });
        assert.equal(result.character_list.find(row => row.character_id === id).mana_board_awake[1], 1);
    }
});

test('a failure after character grant rolls back ticket debit, rewards, history and points together', async () => {
    const p = await player();
    items.setPlayerItemSync(p.id, assets.getGachaSync(990001).tenTicketItemId, 10);
    const before = snapshot(p.id);
    const original = mail.insertReceiveHistorySync;
    const originalMarkSent = seed.markSent;
    let markedSeeds = 0;
    try {
        seed.markSent = (...args) => { markedSeeds++; return originalMarkSent.apply(seed, args); };
        mail.insertReceiveHistorySync = () => { throw new Error('injected history failure'); };
        assert.equal((await request(p, 990001, 3, 4)).statusCode, 500);
    } finally {
        mail.insertReceiveHistorySync = original;
        seed.markSent = originalMarkSent;
    }
    assert.deepEqual(snapshot(p.id), before);
    assert.equal(markedSeeds, 0);
});

test('interleaved accounts keep separate inventories and points, and insufficient funds do not mutate saves', async () => {
    const accounts = await Promise.all(Array.from({ length: 6 }, () => player()));
    const ticket = assets.getGachaSync(990002).tenTicketItemId;
    for (const p of accounts) items.setPlayerItemSync(p.id, ticket, 3);
    const results = await Promise.all(accounts.flatMap(p => [request(p, 990002, 3, 4), request(p, 990002, 3, 4)]));
    for (const response of results) assert.equal(data(response).draw.length, 10);
    for (const p of accounts) {
        assert.equal(items.getPlayerItemSync(p.id, ticket), 1);
        assert.equal(gachaState.getPlayerGachaInfoSync(p.id, 990002).gachaExchangePoint, 20);
        const before = snapshot(p.id);
        assert.equal((await request(p, 990002, 3, 4, 2)).statusCode, 400);
        assert.deepEqual(snapshot(p.id), before);
    }
});

test('invalid execution counts are rejected before draws or persistence', async () => {
    const p = await player();
    const ticket = assets.getGachaSync(990002).tenTicketItemId;
    items.setPlayerItemSync(p.id, ticket, 20);
    for (const count of [0, -1, 2.5, 11, Number.MAX_SAFE_INTEGER + 1]) {
        const before = snapshot(p.id);
        const response = await request(p, 990002, 3, 4, count);
        assert.equal(response.statusCode, 400);
        assert.deepEqual(snapshot(p.id), before);
    }
});

test('performance counters distinguish requests from actual pulls and reset on reporting', () => {
    drainGachaRequestSummary();
    recordGachaRequest('character', 10); recordGachaRequest('character', 1); recordGachaRequest('equipment', 20);
    recordGachaRequest('character', NaN);
    assert.equal(drainGachaRequestSummary(), 'character{requests=2,pulls=11}; equipment{requests=1,pulls=20}');
    assert.equal(drainGachaRequestSummary(), 'character{requests=0,pulls=0}; equipment{requests=0,pulls=0}');
});
