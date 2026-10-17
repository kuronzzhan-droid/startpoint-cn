const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-feedback-guard-'));
process.env.GACHA_SEED_DIR = path.join(root, 'singleton');
fs.mkdirSync(process.env.GACHA_SEED_DIR);
const { SeedValidator, default: singleton } = require('../out/lib/seed-validator');
const { SeedFeedbackGuard } = require('../out/lib/seed-feedback-guard');
let sequence = 0;

function create(t, options = {}, confirmed = {}) {
    const directory = path.join(root, String(++sequence));
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'confirmed_seeds.json'), JSON.stringify(confirmed));
    const validator = new SeedValidator(directory, options);
    t.after(() => validator.close());
    return { validator, directory };
}
test.after(async () => {
    await singleton.close();
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true });
});
const correction = (seed, extra = {}) => ({ kind: 'c3032', movieId: 'fes', seed, rarity: 5, didPlay: true, ...extra });

test('every public kind rejects invalid identities and unissued seeds without touching pools or files', async t => {
    const { validator: v, directory } = create(t);
    const files = () => fs.readdirSync(directory).map(name => [name, fs.readFileSync(path.join(directory, name), 'utf8')]);
    const before = files();
    for (const kind of ['play', 'c3032', 'crash']) {
        for (const extra of [{}, { movieId: 'fake_movie' }, { movieId: '__proto__' }, { seed: NaN },
            { seed: Infinity }, { seed: 0.5 }, { seed: -1 }, { seed: 9007199254740992 }, { rarity: 2 },
            { rarity: 6 }, { didPlay: '1' }]) {
            assert.equal(v.applyPublicFeedback('source', correction(400, { kind, ...extra })), 'rejected');
        }
    }
    await v.flushPersistence();
    assert.deepEqual(v.getMovieIds(), []);
    assert.deepEqual(files(), before);
    assert.equal(v.getPublicFeedbackStats().newSeeds, 0);
});

test('actual sent evidence survives cleanup; duplicate feedback does not create another persistence revision', async t => {
    const { validator: v, directory } = create(t);
    v.markSent('fes', 101, 3);
    assert.equal(v.applyPublicFeedback('source', correction(101)), 'accepted');
    assert.equal(v.getSentR('fes', 101), undefined);
    const revision = v.persistence.revision;
    assert.equal(v.applyPublicFeedback('source', correction(101)), 'duplicate');
    assert.equal(v.persistence.revision, revision);
    assert.equal(v.applyPublicFeedback('source', { kind: 'play', movieId: 'fes', seed: 101, didPlay: true }), 'accepted');
    assert.equal(v.getVerifiedList('fes')[0].rarity, 5, 'PLAY cannot undo observed C3032 rarity');
    await v.flushPersistence();
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'verified_seeds.json'))).fes[101], 2);
    assert.equal(v.getPublicFeedbackStats().newSeeds, 1);
});

test('expired evidence rejects feedback and removes pending issued seeds before shutdown persistence', async t => {
    let now = 100;
    const { validator: v, directory } = create(t, { now: () => now, sentTtlMs: 10 });
    v.markSent('fes', 102, 4);
    now = 110;
    assert.equal(v.applyPublicFeedback('source', correction(102)), 'rejected');
    assert.equal(v.getSentR('fes', 102), undefined);
    v.flushAll();
    await v.flushPersistence();
    assert.equal(v.stats('fes').verified_total, 0);
    assert.equal(v.stats('fes').confirm_total, 0);
    assert.deepEqual(fs.readdirSync(directory), ['confirmed_seeds.json']);
});

test('recent issued evidence and legacy sent maps stay bounded when many legitimate draws arrive', t => {
    const { validator: v } = create(t, { maxRecentSent: 3 });
    for (let seed = 0; seed < 20; seed++) v.markSent('fes_guarantee', seed, 3);
    assert.equal(v.getPublicFeedbackStats().recentSent, 3);
    assert.equal(v.pools.get('fes_guarantee').sentSeeds.size, 3);
    assert.equal(v.pools.get('fes').sentSeeds.size, 3);
    assert.equal(v.applyPublicFeedback('source', correction(0, { movieId: 'fes_guarantee' })), 'rejected');
    assert.equal(v.applyPublicFeedback('source', correction(19, { movieId: 'fes_guarantee' })), 'accepted');
    assert.equal(v.applyPublicFeedback('source', correction(19)), 'rejected', 'base fallback blocking is not proof that base movie was issued');
});

test('source and global budgets have bounded keys and reset with the clock', () => {
    let now = 0;
    const guard = new SeedFeedbackGuard({ now: () => now, windowMs: 10, maxRequestsPerSource: 2,
        maxRequestsGlobal: 5, maxSources: 2 });
    assert.equal(guard.allowRequest('a'), true);
    assert.equal(guard.allowRequest('a'), true);
    assert.equal(guard.allowRequest('a'), false);
    assert.equal(guard.allowRequest('b'), true);
    assert.equal(guard.allowRequest('c'), false);
    assert.equal(guard.allowRequest('b'), false);
    for (let i = 0; i < 100; i++) guard.allowRequest(`random${i}`);
    assert.equal(guard.stats().sources, 2);
    assert.equal(guard.stats().requests, 5);
    now = 10;
    assert.equal(guard.allowRequest('c'), true);
    assert.equal(guard.stats().sources, 1);
});

test('absolute persisted capacity survives reload; older files and administrative edits stay usable', async t => {
    const { validator: v, directory } = create(t, { maxPersistedSeeds: 2 }, { fes: { 1: 0, 2: 1 } });
    v.markSent('fes', 1, 3);
    assert.equal(v.applyPublicFeedback('source', correction(1)), 'accepted');
    v.markSent('fes', 3, 3);
    assert.equal(v.applyPublicFeedback('source', correction(3)), 'rejected');
    assert.equal(v.getVerifiedList('fes').length, 1);
    // An admin correction remains valid even when the public capacity is full.
    v.confirm('custom_old_movie', 4, 2);
    await v.flushPersistence();
    const reloaded = new SeedValidator(directory, { maxPersistedSeeds: 2 });
    t.after(() => reloaded.close());
    assert.ok(reloaded.getMovieIds().includes('custom_old_movie'));
    reloaded.markSent('fes', 5, 3);
    assert.equal(reloaded.applyPublicFeedback('source', correction(5)), 'rejected');
    reloaded.markSent('fes', 1, 3);
    assert.equal(reloaded.applyPublicFeedback('source', correction(1, { rarity: 4 })), 'accepted');
});

test('crash diagnostics only confirm known rarity, and all three feedback kinds share one new-seed budget', t => {
    const { validator: v } = create(t, { maxNewSeeds: 1 });
    v.markSent('fes', 50, 3);
    assert.equal(v.applyPublicFeedback('source', correction(50, { kind: 'crash', didPlay: null })), 'accepted');
    assert.equal(v.getVerifiedList('fes').length, 0);
    assert.equal(v.stats('fes').confirm, 1);
    v.markSent('fes', 51, 3);
    assert.equal(v.applyPublicFeedback('source', { kind: 'play', movieId: 'fes', seed: 51, didPlay: false }), 'rejected');
    assert.equal(v.applyPublicFeedback('source', correction(51)), 'rejected');
    assert.equal(v.getPublicFeedbackStats().newSeeds, 1);
});

test('shutdown fallback cannot bypass full persisted capacity or silently learn expired sent seeds', async t => {
    let now = 0;
    const { validator: v, directory } = create(t, { now: () => now, sentTtlMs: 10, maxPersistedSeeds: 2 },
        { fes: { 1: 0, 2: 1 } });
    v.markSent('fes', 3, 3);
    assert.equal(v.applyPublicFeedback('source', correction(3)), 'rejected');
    await v.close();
    const full = JSON.parse(fs.readFileSync(path.join(directory, 'confirmed_seeds.json')));
    assert.deepEqual(Object.keys(full.fes), ['1', '2']);
    const reload = new SeedValidator(directory, { maxPersistedSeeds: 2 });
    t.after(() => reload.close());
    assert.equal(reload.getPublicFeedbackStats().persistedSeeds, 2);

    const { validator: expiring, directory: expiryDirectory } = create(t, { now: () => now, sentTtlMs: 10 });
    expiring.markSent('fes', 4, 3);
    now = 10;
    await expiring.close();
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(expiryDirectory, 'confirmed_seeds.json'))), {});
    assert.deepEqual(fs.readdirSync(expiryDirectory), ['confirmed_seeds.json']);
});

test('all valid feedback variants occupy at most fourteen deduplication signatures per issued seed', t => {
    const { validator: v } = create(t);
    v.markSent('fes', 150, 3);
    const feedback = [true, false].map(didPlay => ({ kind: 'play', movieId: 'fes', seed: 150, didPlay }));
    for (const rarity of [3, 4, 5]) {
        feedback.push(correction(150, { kind: 'crash', rarity }));
        for (const didPlay of [true, false, null]) feedback.push(correction(150, { rarity, didPlay }));
    }
    for (const input of feedback) assert.equal(v.applyPublicFeedback('source', input), 'accepted');
    const revision = v.persistence.revision;
    for (const input of feedback) assert.equal(v.applyPublicFeedback('source', input), 'duplicate');
    assert.equal(v.persistence.revision, revision);
    assert.equal(v.feedbackGuard.recent.get('fes:150').seen.size, 14);
});
