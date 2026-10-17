const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Fastify = require('fastify');
const { pack, unpack } = require('msgpackr');
const helpers = require('../out/lib/crash-report');
const { parseCrashReportBody, crashReportText, createCrashLogRecord } = helpers;
const LIMIT = 48 * 1024;
const receivedAt = '2026-10-10T00:00:00.000Z';
const source = fs.readFileSync(path.join(__dirname, '../src/cn-server.ts'), 'utf8');
const ast = ts.createSourceFile('cn-server.ts', source, ts.ScriptTarget.Latest, true);

// Exercise the production parser registrations and handler without importing
// cn-server's listeners, schedulers, player database, or unrelated plugins.
const parserStatements = ast.statements.filter(statement => {
    if (ts.isFunctionDeclaration(statement)) return statement.name?.text === 'jsonParser';
    return ts.isExpressionStatement(statement)
        && ts.isCallExpression(statement.expression)
        && statement.expression.expression.getText(ast) === 'fastify.addContentTypeParser';
});
const crashStatement = ast.statements.find(statement => ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression)
    && statement.expression.expression.getText(ast) === 'fastify.post'
    && statement.expression.arguments[0]?.getText(ast) === '"/crash"');
const feedbackFieldsStatement = ast.statements.find(statement => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'parseSeedFeedbackFields');
assert.ok(parserStatements.length >= 3, 'production content parsers must be extracted');
assert.ok(crashStatement, 'production /crash handler must be extracted');
assert.ok(feedbackFieldsStatement, 'production feedback field parser must be extracted');
const compile = statements => ts.transpileModule(statements.map(statement => statement.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function installParsers(app) {
    new Function('fastify', 'unpack', 'parseCrashReportBody', compile(parserStatements))(
        app, unpack, parseCrashReportBody);
}

function fixture() {
    const app = Fastify({ logger: false });
    const logs = [];
    const pending = [];
    let flushes = 0;
    installParsers(app);
    const names = ['fastify', 'seedValidator', 'persistSeedFeedback', 'console', ...Object.keys(helpers)];
    new Function(...names, compile([feedbackFieldsStatement, crashStatement]))(app, {
        applyPublicFeedback: (_source, feedback) => {
            pending.push([feedback.movieId, feedback.seed, feedback.rarity - 3]);
            return 'accepted';
        },
    }, async () => { flushes++; }, { log: (...args) => logs.push(args) }, ...Object.values(helpers));
    app.post('/api/index.php/parser-regression', async request => ({ body: request.body ?? null }));
    return { app, logs, pending, flushes: () => flushes };
}

function structuredLog(logs) {
    for (const args of logs) {
        for (const item of args) {
            if (item && typeof item === 'object' && typeof item.format === 'string') return item;
            if (typeof item !== 'string') continue;
            const start = item.indexOf('{');
            if (start < 0) continue;
            try {
                const record = JSON.parse(item.slice(start));
                if (record && typeof record.format === 'string') return record;
            } catch {}
        }
    }
    assert.fail('production handler must emit a structured crash record');
}

const recordFor = raw => createCrashLogRecord(parseCrashReportBody(raw), 'request-test', receivedAt);
const field = (record, key, value) => record.fields.some(entry =>
    typeof entry.path === 'string' && entry.path.includes(key) && entry.value === value);
const reportText = record => record.report.text ?? `${record.report.head}\n${record.report.tail}`;

test('a long crash retains its tail context and full business-analysis text', () => {
    const stack = 'BattleScene.preparation U_af660f\n' + ' at client.asset.LoadingTask\n'.repeat(140);
    const payload = { stack, player: { viewer_id: 4620 }, device: '安卓设备', resource_version: '1.4.134' };
    const raw = JSON.stringify(payload);
    assert.ok(raw.indexOf('viewer_id') > 2000);
    const wrapped = parseCrashReportBody(raw);
    const record = createCrashLogRecord(wrapped, 'request-test', receivedAt);
    assert.equal(record.format, 'json');
    assert.equal(record.truncated, false);
    assert.ok(reportText(record).includes('1.4.134'));
    assert.ok(reportText(record).includes('viewer_id'));
    assert.ok(field(record, 'viewer_id', 4620));
    assert.ok(field(record, 'resource_version', '1.4.134'));
    assert.ok(record.codes.includes('U_af660f'));
    assert.equal(record.received_bytes, Buffer.byteLength(raw));
    assert.equal(crashReportText(wrapped), raw);
    assert.equal(record.request_id, 'request-test');
    assert.equal(record.received_at, receivedAt);
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
    assert.equal(recordFor(raw).sha256, record.sha256);
});

test('JSON takes precedence over form parsing and keeps nested device fields', () => {
    const raw = JSON.stringify({ message: 'C3032 seed=99 + 50% 中文', device: { os: 'Android' } });
    const record = recordFor(raw);
    assert.equal(record.format, 'json');
    assert.ok(field(record, 'os', 'Android'));
    assert.ok(reportText(record).includes('C3032 seed=99 + 50% 中文'));
    assert.equal(crashReportText(parseCrashReportBody(raw)), raw);
});

test('standard forms decode Chinese, spaces, literal plus and percent, and retain repeated keys', () => {
    const raw = 'message=%E4%B8%AD%E6%96%87+space%2Bplus%25&resource_version=1.4.134&tag=first&tag=%E5%B0%BE%E9%83%A8';
    const wrapped = parseCrashReportBody(raw);
    const record = createCrashLogRecord(wrapped, 'request-test', receivedAt);
    assert.equal(record.format, 'form');
    assert.ok(reportText(record).includes('中文 space+plus%'));
    assert.ok(field(record, 'resource_version', '1.4.134'));
    assert.deepEqual(JSON.parse(record.report.text).tag, ['first', '尾部']);
    assert.equal(record.received_bytes, Buffer.byteLength(raw));
    assert.ok(crashReportText(wrapped).includes('中文 space+plus%'));
    assert.ok(crashReportText(wrapped).includes('尾部'));
});

test('base64 MessagePack reports retain their decoded fields and wire byte count', () => {
    const raw = pack({ message: 'C7050 客户端堆栈', viewer_id: 19, resource_version: '1.4.134' }).toString('base64');
    const wrapped = parseCrashReportBody(raw);
    const record = createCrashLogRecord(wrapped, 'request-test', receivedAt);
    assert.equal(record.format, 'msgpack_base64');
    assert.ok(field(record, 'viewer_id', 19));
    assert.ok(record.codes.includes('C7050'));
    assert.equal(record.received_bytes, Buffer.byteLength(raw));
    assert.ok(crashReportText(wrapped).includes('客户端堆栈'));
});

test('empty, plain text, and malformed JSON reports remain representable', () => {
    for (const [raw, format] of [['', 'empty'], ['ordinary crash C5706\nplain text', 'text'], ['{"message":"C7050",', 'invalid_json']]) {
        const wrapped = parseCrashReportBody(raw);
        const record = createCrashLogRecord(wrapped, 'request-test', receivedAt);
        assert.equal(record.format, format);
        assert.equal(record.received_bytes, Buffer.byteLength(raw));
        assert.ok(Buffer.byteLength(`[CRASH] ${JSON.stringify(record)}`) <= LIMIT);
        assert.equal(crashReportText(wrapped), raw);
    }
});

test('bounded records preserve head, tail, key fields, and valid Unicode for oversized reports', () => {
    const raw = JSON.stringify({ message: 'HEAD C5706\n' + '堆栈😀'.repeat(50000) + '\nTAIL C7050',
        viewer_id: 4620, resource_version: '1.4.134' });
    const wrapped = parseCrashReportBody(raw);
    const record = createCrashLogRecord(wrapped, 'request-test', receivedAt);
    assert.equal(record.truncated, true);
    assert.equal(typeof record.report.head, 'string');
    assert.equal(typeof record.report.tail, 'string');
    assert.ok(record.report.head.includes('HEAD'));
    assert.ok(record.report.tail.includes('TAIL'));
    assert.ok(field(record, 'viewer_id', 4620));
    assert.ok(field(record, 'resource_version', '1.4.134'));
    assert.ok(record.codes.includes('C5706'));
    assert.ok(record.codes.includes('C7050'));
    assert.ok(Buffer.byteLength(`[CRASH] ${JSON.stringify(record)}`) <= LIMIT);
    assert.equal(record.received_bytes, Buffer.byteLength(raw));
    assert.ok(record.body_bytes >= Buffer.byteLength(raw));
    for (const piece of [record.report.head, record.report.tail]) {
        assert.equal(Buffer.from(piece).toString('utf8'), piece, 'split snippets must preserve Unicode scalars');
    }
    assert.equal(crashReportText(wrapped), raw, 'bounded logging must not truncate C3032 business input');
});

test('the overall log cap also covers many fields and their repeated metadata', () => {
    const payload = { message: 'HEAD' + 'x'.repeat(100000) + 'TAIL', resource_version: '1.4.134' };
    for (let index = 0; index < 1800; index++) payload[`device_property_${index}`] = '设备'.repeat(80);
    const record = recordFor(JSON.stringify(payload));
    assert.ok(Buffer.byteLength(`[CRASH] ${JSON.stringify(record)}`) <= LIMIT);
    assert.equal(record.truncated, true);
    assert.ok(reportText(record).includes('HEAD'));
    assert.ok(reportText(record).includes('设备'));
});

test('embedded JSON reports expose nested player and version evidence', () => {
    const nested = JSON.stringify({ viewer_id: 4620, device: { os: 'Android' }, resource_version: '1.4.134' });
    const record = recordFor(JSON.stringify({ message: 'C7050', context: nested }));
    assert.ok(field(record, 'context.viewer_id', 4620));
    assert.ok(field(record, 'context.device.os', 'Android'));
    assert.ok(field(record, 'context.resource_version', '1.4.134'));
});

test('redacted embedded JSON stays parseable and retains player evidence', () => {
    const raw = JSON.stringify({ report: JSON.stringify({ viewer_id: 42, token: 'fixture-session' }) });
    const wrapped = parseCrashReportBody(raw);
    const record = createCrashLogRecord(wrapped, 'request-test', receivedAt);
    assert.ok(!JSON.stringify(record).includes('fixture-session'));
    assert.ok(field(record, 'report.viewer_id', 42));
    assert.equal(crashReportText(wrapped), raw);
});

test('escaped quotes in embedded JSON passwords never leak their remaining suffix', () => {
    const raw = JSON.stringify({ message: JSON.stringify({ password: 'fixture-prefix"fixture-secret-suffix', viewer_id: 42 }) });
    const wrapped = parseCrashReportBody(raw);
    const record = createCrashLogRecord(wrapped, 'request-test', receivedAt);
    const encoded = JSON.stringify(record);
    assert.ok(!encoded.includes('fixture-prefix'));
    assert.ok(!encoded.includes('fixture-secret-suffix'));
    assert.ok(field(record, 'message.viewer_id', 42));
    assert.equal(crashReportText(wrapped), raw);
});

test('underscored private and signing keys and their inline equivalents are redacted', () => {
    const raw = JSON.stringify({ private_key: 'fixture-private-A', signing_key: 'fixture-signing-B',
        message: 'C7050 privatekey=fixture-private-C signingkey=fixture-signing-D' });
    const wrapped = parseCrashReportBody(raw);
    const encoded = JSON.stringify(createCrashLogRecord(wrapped, 'request-test', receivedAt));
    for (const secret of ['fixture-private-A', 'fixture-signing-B', 'fixture-private-C', 'fixture-signing-D']) {
        assert.ok(!encoded.includes(secret), `log must redact ${secret}`);
    }
    assert.equal(crashReportText(wrapped), raw);
});

test('a large repeated form key preserves every value without a parser exception', () => {
    const raw = 'a=&'.repeat(60000);
    const wrapped = parseCrashReportBody(raw);
    const decoded = JSON.parse(crashReportText(wrapped));
    assert.equal(decoded.a.length, 60000);
    assert.ok(decoded.a.every(value => value === ''));
    const record = createCrashLogRecord(wrapped, 'request-test', receivedAt);
    assert.equal(record.format, 'form');
    assert.equal(record.received_bytes, Buffer.byteLength(raw));
    assert.ok(Buffer.byteLength(`[CRASH] ${JSON.stringify(record)}`) <= LIMIT);
});

test('sensitive keys and embedded credentials are redacted only in the log copy', () => {
    const secrets = ['fixture-password-A', 'fixture-token-B', 'fixture-secret-C', 'fixture-proof-D', 'fixture-auth-E', 'fixture-cookie-F', 'fixture-inline-G'];
    const raw = JSON.stringify({ password: secrets[0], token: secrets[1], nested: { secret: secrets[2], proof: secrets[3] },
        authorization: `Bearer ${secrets[4]}`, cookie: `sid=${secrets[5]}`,
        message: `C3032 seed=401 movie_id=fes 結果レア度=★5 token=${secrets[6]}` });
    const wrapped = parseCrashReportBody(raw);
    const encoded = JSON.stringify(createCrashLogRecord(wrapped, 'request-test', receivedAt));
    for (const secret of secrets) assert.ok(!encoded.includes(secret), `log must redact ${secret}`);
    assert.ok(encoded.includes('C3032'));
    assert.equal(crashReportText(wrapped), raw, 'redaction must never modify the business-analysis input');
});

test('production /crash parsers accept JSON mislabeled as form, MessagePack, and text with HTTP 200', async () => {
    const { app, logs, pending, flushes } = fixture();
    try {
        const message = 'at client.LoadingTask\n'.repeat(130) + 'C3032 seed=501 movie_id=fes 結果レア度=★4';
        for (const [contentType, raw, expected] of [
            ['application/x-www-form-urlencoded', JSON.stringify({ message, viewer_id: 19 }), 'json'],
            ['application/x-www-form-urlencoded', `message=${encodeURIComponent(message)}&viewer_id=19&tag=a&tag=b`, 'form'],
            ['application/x-www-form-urlencoded', pack({ message, viewer_id: 19 }).toString('base64'), 'msgpack_base64'],
            ['application/json', JSON.stringify({ message, viewer_id: 19 }), 'json'],
            ['text/plain', message, 'text'],
            ['application/json', '{"message":', 'invalid_json'],
            ['text/plain', '', 'empty'],
        ]) {
            logs.length = 0;
            const response = await app.inject({ method: 'POST', url: '/crash', headers: { 'content-type': contentType }, payload: raw });
            assert.equal(response.statusCode, 200, response.body);
            assert.equal(response.body, 'OK');
            assert.equal(structuredLog(logs).format, expected);
        }
        assert.deepEqual(pending, Array.from({ length: 5 }, () => ['fes', 501, 1]));
        assert.equal(flushes(), 0, 'public crash requests must not wait for a disk flush');
    } finally { await app.close(); }
});

test('other game routes retain the production legacy JSON, form, and MessagePack parser behavior', async () => {
    const { app } = fixture();
    try {
        for (const [contentType, payload, expected] of [
            ['application/json', JSON.stringify({ viewer_id: 19 }), { viewer_id: 19 }],
            ['application/json', '{invalid-json', null],
            ['application/x-www-form-urlencoded', '{"viewer_id":19}', { '{"viewer_id":19}': '' }],
            ['application/x-www-form-urlencoded', 'tag=one&tag=two&message=%E4%B8%AD%E6%96%87+plus%2B', { tag: 'two', message: '中文 plus+' }],
            ['application/x-www-form-urlencoded', pack({ viewer_id: 19, param: { id: 42 } }).toString('base64'), { viewer_id: 19, param: { id: 42 } }],
        ]) {
            const response = await app.inject({ method: 'POST', url: '/api/index.php/parser-regression', headers: { 'content-type': contentType }, payload });
            assert.equal(response.statusCode, 200, response.body);
            assert.deepEqual(response.json().body, expected);
        }
    } finally { await app.close(); }
});
