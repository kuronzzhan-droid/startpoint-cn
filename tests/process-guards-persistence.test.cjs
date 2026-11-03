'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')

test('fatal shutdown stops retention, drains admitted writes and rejects new writes before exiting', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fatal-retention-'))
    const root = path.resolve(__dirname, '..')
    const script = `
        const assert = require('node:assert/strict');
        const { AsyncResource } = require('node:async_hooks');
        const externalRequest = new AsyncResource('external-request');
        const { getDb } = require('./out/data/db');
        const { insertAccountSync } = require('./out/data/domains/account');
        const { insertDefaultPlayerSync } = require('./out/data/domains/player');
        const { insertBattleSettlementSync, BATTLE_REPLAY_RETENTION_MS } = require('./out/data/domains/battle-settlement-ledger');
        const { insertPlayerOperationReceiptSync } = require('./out/data/domains/player-operation-receipt');
        const { createBattleReceiptRetentionService } = require('./out/lib/battle-receipt-retention');
        const coordinator = require('./out/lib/persistence-coordinator');
        const shutdown = require('./out/lib/shutdown-state');
        const { installProcessGuards } = require('./out/lib/process-guards');
        const { createGracefulShutdown } = require('./out/lib/graceful-shutdown');
        const db = getDb();
        const account = insertAccountSync({ appId:'wf_cn',idpAlias:'',idpCode:'test',idpId:'fatal-retention',status:'normal' });
        const player = insertDefaultPlayerSync(account.id);
        const timestamp = Date.now() - BATTLE_REPLAY_RETENTION_MS - 1000;
        coordinator.runPersistenceTransactionSync({domain:'single-quest',playerId:player.id,operation:'fixture'}, () => {
            insertBattleSettlementSync(player.id,'fatal-play','single',timestamp);
            insertPlayerOperationReceiptSync({playerId:player.id,operation:'quest_finish.single',requestKey:'fatal-play',response:{data_headers:{},data:{}}},timestamp);
        });
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        let entered = false;
        let producerStop;
        const service = createBattleReceiptRetentionService(db, {
            initialDelayMs:0, pauseMs:0, logger:{log(){},warn(){}},
            executeTransaction: (context, operation) => shutdown.withServerWorkAdmission(async () => {
                if (!entered) {
                    entered = true;
                    setImmediate(() => { throw new Error('fatal-during-retention'); });
                    await gate;
                }
                return coordinator.runPersistenceTransaction(context,operation);
            }),
        });
        const close = createGracefulShutdown({
            timeoutMs:10000,
            quiesce() { shutdown.beginServerShutdown(); producerStop = service.stop(); },
            async close() {
                await assert.rejects(externalRequest.runInAsyncScope(() => coordinator.runPersistenceTransaction({domain:'maintenance',operation:'new-after-fatal'}, () => assert.fail('late write'))), {code:'SERVER_CLOSING'});
                release();
                await producerStop;
                await shutdown.drainServerWork();
                await coordinator.drainPersistence();
                assert.equal(db.prepare('SELECT COUNT(*) n FROM battle_settlement_ledger').get().n,1);
                assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
                db.close();
                console.log('fatal-drained-and-closed');
            },
            cancel() { throw new Error('unexpected drain timeout'); },
            async terminate() { throw new Error('unexpected termination'); },
            failed(error) { console.error(error); process.exit(3); },
        });
        installProcessGuards({onFatal() { process.exitCode=1; void close('uncaughtException').then(() => process.exit(1)); }});
        service.start();
        setTimeout(() => { console.error('retention did not enter'); process.exit(4); },15000);
    `
    try {
        const result = spawnSync(process.execPath, ['-e', script], {
            cwd: root,
            encoding: 'utf8',
            timeout: 20000,
            env: { ...process.env, DATA_DIR: directory, CN_WRITER_THREAD: '0', GAME_ROUTINE_LOGS: 'off' },
        })
        assert.equal(result.error, undefined, String(result.error))
        assert.equal(result.status, 1, result.stdout + result.stderr)
        assert.match(result.stdout, /fatal-drained-and-closed/)
        assert.match(result.stderr, /uncaughtException.*fatal-during-retention/)
        const db = new Database(path.join(directory, 'wdfp_data.db'), { readonly: true })
        try {
            assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
            assert.equal(db.prepare('SELECT COUNT(*) n FROM battle_settlement_ledger').get().n, 1)
        } finally { db.close() }
    } finally {
        assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()))
        fs.rmSync(directory, { recursive: true })
    }
})
