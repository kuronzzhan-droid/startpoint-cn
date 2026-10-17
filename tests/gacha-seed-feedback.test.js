const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const Fastify = require('fastify');
const { unpack } = require('msgpackr');
const crashHelpers = require('../out/lib/crash-report');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gacha-seed-feedback-'));
process.env.GACHA_SEED_DIR = directory;
fs.writeFileSync(path.join(directory, 'confirmed_seeds.json'), JSON.stringify({ fes: { 100: 0, 103: 0 } }));
const validator = require('../out/lib/seed-validator').default;
const app = Fastify({ logger: false });

// Register the actual CN feedback handlers without starting its unrelated TCP
// listener or schedulers. No copied handler implementation is kept in the test.
const server = fs.readFileSync(path.join(__dirname, '../src/cn-server.ts'), 'utf8');
const start = server.indexOf('// Public diagnostic feedback');
const end = server.indexOf('fastify.register(cnToolPlugin', start);
assert.ok(start >= 0 && end > start);
const handlers = ts.transpileModule(server.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function('fastify', 'seedValidator', 'gameVerboseLog', 'console', ...Object.keys(crashHelpers), handlers)(
    app, validator, () => {}, { log: () => {} }, ...Object.values(crashHelpers));
// Also use the production parsers so legacy form crash reports reach the same
// handler used in production rather than Fastify's default JSON-only parser.
const source = ts.createSourceFile('cn-server.ts', server, ts.ScriptTarget.Latest, true);
const parserStatements = source.statements.filter(statement => {
    if (ts.isFunctionDeclaration(statement)) return statement.name?.text === 'jsonParser';
    return ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
        && statement.expression.expression.getText(source) === 'fastify.addContentTypeParser';
});
assert.ok(parserStatements.length >= 3);
const parsers = ts.transpileModule(parserStatements.map(statement => statement.getText(source)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function('fastify', 'unpack', 'parseCrashReportBody', parsers)(app, unpack, crashHelpers.parseCrashReportBody);
const star = String.fromCharCode(0xe2, 0x98, 0x85);
const correction = seed => `C3032 seed=${seed} movie_id=fes 結果レア度=${star}5 play=1`;
const read = kind => JSON.parse(fs.readFileSync(path.join(directory, `${kind}_seeds.json`), 'utf8'));
let flushCalls = 0;
const flushPersistence = validator.flushPersistence.bind(validator);
validator.flushPersistence = () => { flushCalls++; return flushPersistence(); };
async function inject(options) {
    const before = flushCalls;
    const response = await app.inject(options);
    assert.equal(flushCalls, before, 'public feedback must not allocate a persistence flush waiter');
    return response;
}
test.after(async () => {
    await app.close(); await validator.close();
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(directory, { recursive: true });
});

test('GET and POST C3032 feedback batch the corrected rarity without forcing a flush', async () => {
    for (const [method, seed] of [['GET', 100], ['POST', 101]]) {
        validator.markSent('fes', seed, 3);
        const loc = correction(seed);
        const response = await inject(method === 'GET'
            ? { method, url: `/debug?loc=${encodeURIComponent(loc)}` }
            : { method, url: '/debug', payload: { loc } });
        assert.equal(response.statusCode, 200);
        assert.equal(response.body, 'OK');
        await validator.flushPersistence();
        assert.equal(read('verified').fes[seed], 2);
        assert.equal(validator.isKnownRarityMismatch('fes', seed, 3), true);
    }
});

test('GET and POST PLAY feedback keep the sent rarity and accept duplicate feedback', async () => {
    for (const [method, seed] of [['GET', 102], ['POST', 106]]) {
        validator.markSent('fes', seed, 4);
        const loc = `PLAY|play=1|seed=${seed}, movie_id=fes`;
        const options = method === 'GET' ? { method, url: `/debug?loc=${encodeURIComponent(loc)}` }
            : { method, url: '/debug', payload: { loc } };
        assert.equal((await inject(options)).statusCode, 200);
        assert.equal((await inject(options)).statusCode, 200);
        await validator.flushPersistence();
        assert.equal(read('verified').fes[seed], 1);
        assert.equal(validator.getSentR('fes', seed), undefined);
    }
});

test('a disk failure retains the original beacon response contract and retries the correction', async () => {
    validator.markSent('fes', 103, 3);
    const target = path.join(directory, 'confirmed_seeds.json');
    const previous = `${target}.original`;
    fs.renameSync(target, previous);
    fs.mkdirSync(target);
    try {
        const response = await inject({ method: 'GET', url: `/debug?loc=${encodeURIComponent(correction(103))}` });
        assert.equal(response.statusCode, 200);
        assert.equal(response.body, 'OK');
        assert.equal(validator.isKnownRarityMismatch('fes', 103, 3), true);
        await assert.rejects(validator.flushPersistence());
    } finally {
        fs.rmdirSync(target);
        fs.renameSync(previous, target);
    }
    await validator.flushPersistence();
    assert.equal(read('verified').fes[103], 2);
    assert.equal(read('confirmed').fes[103], undefined);
});

test('the legacy crash-report path still records known rarity without inventing a play result', async () => {
    validator.markSent('fes', 104, 3);
    const response = await inject({ method: 'POST', url: '/crash', payload: {
        message: 'C3032 seed=104 movie_id=fes 結果レア度=★4',
    } });
    assert.equal(response.statusCode, 200);
    await validator.flushPersistence();
    assert.equal(read('confirmed').fes[104], 1);
    assert.equal(read('verified').fes[104], undefined);
});

test('C3032 correction after a long stack survives mislabeled JSON form parsing and reaches disk', async () => {
    validator.markSent('fes', 105, 3);
    const payload = JSON.stringify({ stack: 'at client.LoadingTask\n'.repeat(160),
        message: 'C3032 seed=105 movie_id=fes 結果レア度=★5', viewer_id: 19, resource_version: '1.4.134' });
    assert.ok(payload.indexOf('C3032') > 2000);
    const response = await inject({ method: 'POST', url: '/crash',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'OK');
    await validator.flushPersistence();
    assert.equal(read('confirmed').fes[105], 2);
    assert.equal(read('verified').fes[105], undefined);
});

test('unissued, malformed and oversized public feedback returns OK without pool or disk growth', async () => {
    await validator.flushPersistence();
    const before = fs.readFileSync(path.join(directory, 'verified_seeds.json'));
    const movies = validator.getMovieIds();
    for (const loc of [correction(999), 'C3032 seed=9007199254740992 movie_id=fes 結果レア度=★5',
        'PLAY|play=1|seed=102, movie_id=attacker', 'C3032 seed=102 movie_id=fes 結果レア度=★9', 'x'.repeat(8193)]) {
        const response = await inject({ method: 'POST', url: '/debug', payload: { loc } });
        assert.equal(response.statusCode, 200);
        assert.equal(response.body, 'OK');
    }
    const crash = await inject({ method: 'POST', url: '/crash', payload: {
        message: 'C3032 seed=999 movie_id=attacker 結果レア度=★5',
    } });
    assert.equal(crash.body, 'OK');
    await validator.flushPersistence();
    assert.deepEqual(validator.getMovieIds(), movies);
    assert.deepEqual(fs.readFileSync(path.join(directory, 'verified_seeds.json')), before);
});

test('complete field tokens reject invalid suffixes even when a matching seed was issued', async () => {
    validator.markSent('normal', 160, 3);
    validator.markSent('fes', 161, 3);
    const revision = validator.persistence.revision;
    for (const loc of ['C3032 seed=160 movie_id=normal.evil 結果レア度=★5',
        'C3032 seed=161 movie_id=fes-bad 結果レア度=★5',
        'C3032 seed=161 movie_id=fes 結果レア度=★50',
        'C3032 seed=161 movie_id=fes 結果レア度=★5.1',
        'PLAY|play=1|seed=161.0, movie_id=fes', 'PLAY|play=10|seed=161, movie_id=fes']) {
        for (const method of ['GET', 'POST']) {
            const response = await inject(method === 'GET' ? { method, url: `/debug?loc=${encodeURIComponent(loc)}` }
                : { method, url: '/debug', payload: { loc } });
            assert.equal(response.body, 'OK');
        }
    }
    for (const message of ['C3032 seed=160 movie_id=normal.evil 結果レア度=★5',
        'C3032 seed=161 movie_id=fes 結果レア度=★50']) {
        assert.equal((await inject({ method: 'POST', url: '/crash', payload: { message } })).body, 'OK');
    }
    assert.equal(validator.persistence.revision, revision);
});

test('public early-request source throttling returns OK before parsing malformed request bodies', async () => {
    for (let i = 0; i < 120; i++) {
        await inject({ method: 'GET', url: '/debug', remoteAddress: '198.51.100.42' });
    }
    const before = validator.persistence.revision;
    const denied = await inject({ method: 'POST', url: '/debug', remoteAddress: '198.51.100.42',
        headers: { 'content-type': 'application/json' }, payload: '{not-valid-json' });
    assert.equal(denied.statusCode, 200);
    assert.equal(denied.body, 'OK');
    assert.equal(validator.persistence.revision, before);
});
