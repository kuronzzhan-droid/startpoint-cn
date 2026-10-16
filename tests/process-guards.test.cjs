const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');

const guardsPath = path.resolve(__dirname, '../out/lib/process-guards.js');
const { installProcessGuards, describeFailure } = require(guardsPath);

function fakeProcess() {
    const target = new EventEmitter();
    return { target, emitRejection: reason => target.emit('unhandledRejection', reason, Promise.resolve()) };
}

test('unhandled rejections are logged with stack and do not request shutdown', () => {
    const { target, emitRejection } = fakeProcess();
    const logs = [];
    let fatal = 0;
    const guards = installProcessGuards({ target, log: m => logs.push(m), onFatal: () => { fatal++; } });
    emitRejection(new Error('async task failed'));
    emitRejection('plain reason');
    assert.equal(fatal, 0);
    assert.equal(guards.stats.unhandledRejections, 2);
    assert.match(logs[0], /^\[PROCESS\] unhandledRejection \(total 1\); server keeps running: Error: async task failed\n\s+at /);
    assert.match(logs[1], /plain reason$/);
    guards.uninstall();
    assert.equal(target.listenerCount('unhandledRejection'), 0);
    assert.equal(target.listenerCount('uncaughtException'), 0);
});

test('rejection logging is bounded per window and reports the suppressed count', () => {
    const { target, emitRejection } = fakeProcess();
    const logs = [];
    let now = 0;
    const guards = installProcessGuards({
        target, log: m => logs.push(m), onFatal() {}, now: () => now,
        rejectionLogLimit: 2, rejectionLogWindowMs: 1000,
    });
    for (let i = 0; i < 5; i++) emitRejection(new Error(`r${i}`));
    assert.equal(logs.length, 2);
    now = 1000;
    emitRejection(new Error('next window'));
    assert.equal(guards.stats.unhandledRejections, 6);
    assert.match(logs[2], /3 further rejection\(s\) not logged/);
    assert.match(logs[3], /next window/);
    guards.uninstall();
});

test('uncaught exceptions are logged and request graceful shutdown exactly once', () => {
    const { target } = fakeProcess();
    const logs = [];
    const reasons = [];
    const guards = installProcessGuards({ target, log: m => logs.push(m), onFatal: r => reasons.push(r) });
    target.emit('uncaughtException', new TypeError('bad state'), 'uncaughtException');
    target.emit('uncaughtException', new Error('during shutdown'), 'uncaughtException');
    assert.deepEqual(reasons, ['uncaughtException']);
    assert.equal(guards.stats.uncaughtExceptions, 2);
    assert.match(logs[0], /^\[PROCESS\] uncaughtException \(uncaughtException\); starting graceful shutdown: TypeError: bad state/);
    guards.uninstall();
});

test('describeFailure handles non-error values', () => {
    assert.equal(describeFailure({ code: 7 }), 'non-error value: {"code":7}');
    const circular = {}; circular.self = circular;
    assert.match(describeFailure(circular), /^non-error value: /);
});

test('a real process survives an unhandled rejection once guards are installed', () => {
    const script = `
        const { installProcessGuards } = require(${JSON.stringify(guardsPath)});
        installProcessGuards({ onFatal: () => process.exit(3) });
        Promise.reject(new Error('stray'));
        setTimeout(() => { console.log('still-alive'); }, 50);
    `;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /still-alive/);
    assert.match(result.stderr, /\[PROCESS\] unhandledRejection .*Error: stray/);
});

test('a real process routes an uncaught exception to the shutdown callback', () => {
    const script = `
        const { installProcessGuards } = require(${JSON.stringify(guardsPath)});
        installProcessGuards({ onFatal: () => { console.log('shutdown-requested'); process.exit(1); } });
        setTimeout(() => { throw new Error('sync failure'); }, 0);
    `;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /shutdown-requested/);
    assert.match(result.stderr, /\[PROCESS\] uncaughtException .*Error: sync failure/);
});
