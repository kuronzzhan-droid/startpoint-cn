require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "player-snapshot-v2-"))
const previousDataDirectory = process.env.DATA_DIR
const sourceDatabasePath = process.argv[2] || process.env.PLAYER_SNAPSHOT_SOURCE_DB
process.env.DATA_DIR = databaseDirectory

let db

function cleanup() {
    if (db?.open) db.close()
    fs.rmSync(databaseDirectory, { recursive: true, force: true })
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDirectory
}

process.once("exit", cleanup)

async function prepareDatabaseCopy() {
    if (!sourceDatabasePath) return
    const Database = require("better-sqlite3")
    const resolvedSource = path.resolve(sourceDatabasePath)
    const source = new Database(resolvedSource, { readonly: true, fileMustExist: true })
    try {
        assert.equal(source.pragma("integrity_check", { simple: true }), "ok")
        await source.backup(path.join(databaseDirectory, "wdfp_data.db"))
    } finally {
        source.close()
    }
    const versionSource = `${resolvedSource}.version`
    assert.equal(fs.existsSync(versionSource), true, `missing version file: ${versionSource}`)
    fs.copyFileSync(versionSource, path.join(databaseDirectory, "wdfp_data.db.version"))
}

function createAccount(insertAccountSync, label) {
    return insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "snapshot-test",
        idpId: `${label}-${randomUUID()}`,
        status: "normal",
    })
}

function businessDatabaseDigest(database) {
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    return JSON.stringify(tables.map(({ name }) => {
        const quote = identifier => '"' + identifier.replace(/"/g, '""') + '"'
        const statement = database.prepare(`SELECT * FROM ${quote(name)}`)
        const columns = statement.columns().map(column => column.name)
        const rows = statement.safeIntegers(true).raw().all().map(row => JSON.stringify(row.map(value =>
            Buffer.isBuffer(value) ? { blob: value.toString('hex') }
                : typeof value === 'bigint' ? { integer: value.toString() } : value))).sort()
        return { name, columns, rows }
    }))
}

function identityState() {
    return Object.fromEntries(["accounts", "sessions", "device_bindings", "player_login_credentials", "player_login_sessions"]
        .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

function seedLoginIdentity(playerId, label) {
    const accountId = db.prepare("SELECT account_id FROM players WHERE id=?").get(playerId).account_id
    db.prepare("UPDATE accounts SET username=?,admin_note=? WHERE id=?").run(`snapshot_${label}`, `identity-${label}`, accountId)
    db.prepare("INSERT INTO player_login_credentials(account_id,password,created_at) VALUES(?,?,?)")
        .run(accountId, "SnapshotFixture11", 123456)
    const viewer = 710000000 + playerId
    db.prepare("INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)")
        .run(String(viewer), accountId, "2099-01-01T00:00:00.000Z")
    db.prepare("INSERT INTO device_bindings(device_id,account_id,last_seen) VALUES(?,?,'2026-08-20T00:00:00.000Z')")
        .run(910000000 + playerId, accountId)
    db.prepare("INSERT INTO player_login_sessions(token,account_id,viewer_id,udid,expires_at) VALUES(?,?,?,?,?)")
        .run(playerId.toString(16).padStart(64, "0"), accountId, viewer, `fixture-${label}`, 4070908800000)
}

function dailyState(playerId) {
    const grants = db.prepare("SELECT * FROM daily_vmoney_mail_grants WHERE player_id=? ORDER BY bucket").all(playerId)
    return grants.map(grant => ({ grant, mail: db.prepare("SELECT * FROM players_mails WHERE id=? AND player_id=?")
        .get(grant.mail_id, playerId) }))
}

function assertDailyMailsPreserved(playerId, before, remapped) {
    const after = dailyState(playerId)
    assert.equal(after.length, before.length)
    for (let index = 0; index < before.length; index++) {
        const old = before[index], current = after[index]
        assert.ok(current.mail, "preserved grant must reference a mail owned by the target")
        assert.deepEqual({ ...current.grant, mail_id: old.grant.mail_id }, old.grant)
        assert.deepEqual({ ...current.mail, id: old.mail.id }, old.mail, "all daily mail fields and claim status survive")
        assert.equal(current.grant.mail_id, current.mail.id)
        if (remapped) assert.notEqual(current.mail.id, old.mail.id, "V2 archive restore must remap the target daily mail id")
        else assert.equal(current.mail.id, old.mail.id, "skipped/rejected imports must keep the original mail id")
    }
}

function targetState(playerId) {
    return {
        snapshot: require("../src/data/snapshots/player-snapshot").createPlayerSaveSnapshotV2Sync(playerId).data,
        daily: dailyState(playerId),
        identity: identityState(),
    }
}

function seedLeaderboardRecord(playerId, competitionKey) {
    const run = db.prepare(`INSERT INTO leaderboard_runs
        (competition_key, player_id, player_name, season, status, started_at_ms, finished_at_ms,
         server_duration_ms, client_battle_ms, rounds_cleared, total_rounds, tracked_from_round)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(competitionKey, playerId, `榜单玩家-${playerId}`, 1, "completed", 1000, 2000, 1000, 800, 1, 1, 1)
    db.prepare(`INSERT INTO leaderboard_run_rounds
        (run_id, round_number, quest_id, client_battle_ms, server_elapsed_ms, started_at_ms, finished_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(Number(run.lastInsertRowid), 1, 999001, 800, 1000, 1000, 2000)
}

function seedRepresentativeState(playerId, otherPlayerId) {
    db.prepare(`UPDATE players SET name = ?, comment = ?, exp_pool = ?, free_vmoney = ? WHERE id = ?`)
        .run("完整存档来源", "snapshot-v2", 4321, 8765, playerId)
    db.prepare(`INSERT INTO players_encyclopedia_keywords (encyclopedia_id, read, player_id) VALUES (?, ?, ?)`)
        .run(991001, 1, playerId)
    db.prepare(`INSERT INTO players_player_history_settings
        (player_id, player_history_id, background_card_id, degree_id, character_ids, unison_character_ids, topic_visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(playerId, 3, 1002, 1, "[101001,null,null]", "[null,null,null]", '{"1":true}')
    db.prepare(`INSERT INTO players_triggered_tutorials (id, player_id) VALUES (?, ?)`).run(88001, playerId)
    db.prepare(`INSERT INTO players_mails
        (id, player_id, reason_id, subject, description, type, type_id, number, receive_time, create_time, reward_period_limited, reward_limit_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(700001, playerId, 99, "V2 邮件", "邮件正文", 1, 123, 5, "0000-00-00 00:00:00", "2026-08-22T00:00:00.000Z", 0, null)
    db.prepare(`INSERT INTO players_mails (id,player_id,subject,description,type,number,receive_time,create_time)
        VALUES(700002,?,'来源日邮','must stay on source',4,321,'2026-08-20T01:00:00.000Z','2026-08-20T00:00:00.000Z')`).run(playerId)
    db.prepare("INSERT INTO daily_vmoney_mail_grants(bucket,player_id,mail_id,created_at_ms) VALUES('2026-08-20',?,700002,1234567)").run(playerId)
    db.prepare(`INSERT INTO players_receive_history
        (id, player_id, type, type_id, number, reason_id, create_time)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(710001, playerId, 2, 456, 7, 98, "2026-08-22T00:01:00.000Z")
    db.prepare(`INSERT INTO players_practice_battle_history
        (id, player_id, play_id, category_id, character_1_total_damage, character_id_1,
         clear_rank, create_time, elapsed_time_ms, finish_kind, quest_id, score, total_damage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
            720001, playerId, "snapshot-practice-battle", 15, 7654, 101001,
            4, "2026-08-22 00:01:30", 45678, 0, 92015, 123456, 8765,
        )
    db.prepare(`INSERT INTO players_cleared_regular_missions (id, value, player_id) VALUES (?, ?, ?)`)
        .run(99001, 12, playerId)
    db.prepare(`INSERT INTO players_items (id, amount, player_id) VALUES (?, ?, ?)`)
        .run(901, 345, playerId)
    db.prepare(`INSERT INTO players_collected_items (player_id, item_id, total_obtained) VALUES (?, ?, ?)`)
        .run(playerId, 901, 678)
    db.prepare(`INSERT INTO players_equipment (id, level, enhancement_level, protection, stack, player_id)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(990001, 5, 3, 1, 2, playerId)
    db.prepare(`INSERT INTO players_quest_progress
        (section, quest_id, finished, unlocked, high_score, clear_rank, best_elapsed_time_ms, leader_character_id, multi_clear_count, player_id, host_finished, s_plus_reward_received)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(9, 990001, 1, 1, 123456, 4, 45678, 101001, 3, playerId, 1, 1)
    db.prepare(`INSERT INTO players_character_quest_clears
        (player_id, character_id, clear_count, multi_count, leader_clear_count, leader_multi_count, leader_power_flip_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(playerId, 101001, 8, 7, 6, 5, 4)
    db.prepare(`INSERT INTO players_party_member_co_clears (player_id, char_id_a, char_id_b, co_clear_count)
        VALUES (?, ?, ?, ?)`)
        .run(playerId, 101001, 101002, 9)
    db.prepare(`INSERT INTO players_party_race_clears (player_id, race_key, clear_count) VALUES (?, ?, ?)`)
        .run(playerId, "human:beast", 10)
    db.prepare(`INSERT INTO players_mission_battle_counters
        (player_id, single_play_count, single_clear_count, multi_play_count, multi_clear_count, multi_host_clear_count, multi_guest_clear_count, single_rank_ss_count, rank_ss_count, rank_s_count, rank_a_count, rank_b_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(playerId, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
    db.prepare(`INSERT INTO players_active_missions (id, progress, player_id) VALUES (?, ?, ?)`)
        .run(98001, 6, playerId)
    db.prepare(`INSERT INTO players_active_missions_stages (id, status, player_id, mission_id) VALUES (?, ?, ?, ?)`)
        .run(1, 2, playerId, 98001)
    db.prepare(`INSERT INTO players_category_missions (category, id, progress, player_id) VALUES (?, ?, ?, ?)`)
        .run(8, 97001, 4, playerId)
    db.prepare(`INSERT INTO players_category_mission_stages (category, id, status, player_id, mission_id) VALUES (?, ?, ?, ?, ?)`)
        .run(8, 1, 2, playerId, 97001)
    db.prepare(`INSERT INTO players_mission_counters
        (player_id, counter_key, dimension, scope_type, scope_key, qualifier_json, value, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(playerId, "snapshot-test", "battle", "all", "*", "{}", 77, "2026-08-22T00:02:00.000Z")
    db.prepare(`INSERT INTO players_mission_counter_snapshots
        (player_id, period_type, counter_key, value, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .run(playerId, "weekly", "snapshot-test", 66, "2026-08-22T00:03:00.000Z")
    db.prepare(`INSERT INTO players_pass_cards (player_id, event_id, point, is_buy, login_baseline) VALUES (?, ?, ?, ?, ?)`)
        .run(playerId, 96001, 55, 1, 123)
    db.prepare(`INSERT INTO players_pass_card_rewards
        (player_id, event_id, reward_id, is_received_1, is_received_2) VALUES (?, ?, ?, ?, ?)`)
        .run(playerId, 96001, 2, 1, 0)
    db.prepare(`INSERT INTO players_raid_event_overall_rewards
        (player_id, event_id, received_up_to, updated_at) VALUES (?, ?, ?, ?)`)
        .run(playerId, 95001, 7, 1777777)
    db.prepare(`INSERT INTO players_carnival_event_records
        (player_id, event_id, folder_id, best_score, previous_score, previous_character_ids, previous_unison_character_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(playerId, 94001, 3, 5000, 4500, "[101001]", "[]")
    db.prepare(`INSERT INTO players_carnival_event_rewards (player_id, event_id, reward_id) VALUES (?, ?, ?)`)
        .run(playerId, 94001, 4)
    db.prepare(`INSERT INTO players_carnival_event_reward_claims
        (player_id, event_id, reward_id, claimed_at) VALUES (?, ?, ?, ?)`)
        .run(playerId, 94001, 5, 1888888)
    db.prepare(`INSERT INTO players_shop_purchases (player_id, shop_item_id, count) VALUES (?, ?, ?)`)
        .run(playerId, 93001, 8)
    db.prepare(`INSERT INTO players_active_quests
        (player_id, play_id, quest_id, category, use_boss_boost_point, use_boost_point, is_auto_start_mode, is_multi, room_number, entry_item_id, event_id, continue_count, is_multi_host)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(playerId, "source-active-battle", 92001, 1, 0, 0, 0, 0, null, null, null, 0, 0)
    db.prepare(`INSERT INTO players_repair_versions
        (player_id, repair_key, repair_version, applied_at) VALUES (?, ?, ?, ?)`)
        .run(playerId, "snapshot-source-repair", 1, "2026-08-22T00:04:00.000Z")
    db.prepare(`INSERT INTO players_follows (follower_player_id, followed_player_id, created_at) VALUES (?, ?, ?)`)
        .run(playerId, otherPlayerId, Date.now())
    seedLeaderboardRecord(playerId, "snapshot-source")
}

function assertHistoryWasRemapped(sourcePlayerId, targetPlayerId) {
    const sourceMail = db.prepare(`SELECT id, subject FROM players_mails WHERE player_id = ? AND id=700001`).get(sourcePlayerId)
    const targetMails = db.prepare(`SELECT id, subject FROM players_mails WHERE player_id = ? AND subject=? AND reason_id=99`).all(targetPlayerId, sourceMail.subject)
    assert.equal(targetMails.length, 1, "source history mail must be imported exactly once")
    const targetMail = targetMails[0]
    assert.equal(targetMail.subject, sourceMail.subject)
    assert.notEqual(targetMail.id, sourceMail.id, "mail id must be remapped")
    const sourceHistory = db.prepare(`SELECT id, reason_id FROM players_receive_history WHERE player_id = ?`).get(sourcePlayerId)
    const targetHistory = db.prepare(`SELECT id, reason_id FROM players_receive_history WHERE player_id = ?`).get(targetPlayerId)
    assert.equal(targetHistory.reason_id, sourceHistory.reason_id)
    assert.notEqual(targetHistory.id, sourceHistory.id, "receive-history id must be remapped")
    const sourcePractice = db.prepare(`
        SELECT id, play_id, quest_id, total_damage
        FROM players_practice_battle_history WHERE player_id = ?
    `).get(sourcePlayerId)
    const targetPractice = db.prepare(`
        SELECT id, play_id, quest_id, total_damage
        FROM players_practice_battle_history WHERE player_id = ?
    `).get(targetPlayerId)
    assert.equal(targetPractice.play_id, sourcePractice.play_id)
    assert.equal(targetPractice.quest_id, sourcePractice.quest_id)
    assert.equal(targetPractice.total_damage, sourcePractice.total_damage)
    assert.notEqual(targetPractice.id, sourcePractice.id, "practice-battle history id must be remapped")
}

function runFreshDatabaseTests(api) {
    const { insertAccountSync, insertDefaultPlayerSync } = api
    const source = insertDefaultPlayerSync(createAccount(insertAccountSync, "source").id)
    const target = insertDefaultPlayerSync(createAccount(insertAccountSync, "target").id)
    const other = insertDefaultPlayerSync(createAccount(insertAccountSync, "other").id)
    seedLoginIdentity(source.id, "source")
    seedLoginIdentity(target.id, "target")
    seedRepresentativeState(source.id, other.id)

    const targetMail = db.prepare(`INSERT INTO players_mails
        (player_id, subject, description, type, number, create_time)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(target.id, "目标旧邮件", "old", 1, 1, "2026-08-20T00:00:00.000Z")
    db.prepare(`INSERT INTO daily_vmoney_mail_grants (bucket, player_id, mail_id, created_at_ms)
        VALUES (?, ?, ?, ?)`)
        .run("2026-08-20", target.id, Number(targetMail.lastInsertRowid), 2026082000000)
    const claimedMail = db.prepare(`INSERT INTO players_mails
        (player_id,subject,description,type,number,receive_time,create_time)
        VALUES(?,'目标已领取日邮','keep claimed',4,222,'2026-08-19T01:00:00.000Z','2026-08-19T00:00:00.000Z')`).run(target.id)
    db.prepare("INSERT INTO daily_vmoney_mail_grants(bucket,player_id,mail_id,created_at_ms) VALUES('2026-08-19',?,?,1234568)")
        .run(target.id, Number(claimedMail.lastInsertRowid))
    db.prepare(`INSERT INTO players_active_quests
        (player_id, play_id, quest_id, category) VALUES (?, ?, ?, ?)`)
        .run(target.id, "target-active-battle", 1, 1)
    db.prepare(`INSERT INTO players_follows (follower_player_id, followed_player_id, created_at) VALUES (?, ?, ?)`)
        .run(target.id, other.id, Date.now())
    db.prepare(`INSERT INTO players_repair_versions
        (player_id, repair_key, repair_version, applied_at) VALUES (?, ?, ?, ?)`)
        .run(target.id, "snapshot-target-repair", 1, "2026-08-22T00:05:00.000Z")
    seedLeaderboardRecord(target.id, "snapshot-target")

    const snapshot = api.createPlayerSaveSnapshotV2Sync(source.id)
    assert.equal(snapshot.version, 2)
    assert.equal(snapshot.summary.includedTableCount, api.PLAYER_SNAPSHOT_V2_TABLES.length)
    assert.equal(Object.hasOwn(snapshot.data.tables, "players_repair_versions"), false)
    assert.ok(snapshot.summary.excludedState.some(entry =>
        entry.policy === "reset" && entry.tables.includes("players_repair_versions")))
    assert.equal(Object.hasOwn(snapshot.data.tables, "daily_vmoney_mail_grants"), false)
    assert.ok(snapshot.summary.excludedState.some(entry =>
        entry.policy === "preserve-target" && entry.tables.includes("daily_vmoney_mail_grants")))
    assert.deepEqual(snapshot.dailyMailBasis, { version: 1, mails: [{ bucket: "2026-08-20", mailId: 700002 }] })
    assert.equal(Object.hasOwn(snapshot.data.tables, "leaderboard_runs"), false)
    assert.ok(snapshot.summary.excludedState.some(entry =>
        entry.policy === "preserve-target" && entry.tables.includes("leaderboard_runs")))
    assert.ok(snapshot.data.tables.players_carnival_event_reward_claims.rows.length > 0)
    assert.equal(snapshot.data.tables.players_practice_battle_history.rows.length, 1)

    const targetAccountId = db.prepare(`SELECT account_id FROM players WHERE id = ?`).get(target.id).account_id
    const originalIdentity = identityState(), sourceBefore = targetState(source.id), targetDailyBefore = dailyState(target.id)
    const result = api.restorePlayerSaveSnapshotV2Sync(snapshot, target.id, { includeArchiveHistory: true })
    assert.equal(result.skippedTables.length, 0)
    assert.ok(result.restoredRows > 1)
    const restoredPlayer = db.prepare(`SELECT account_id, name, exp_pool, free_vmoney FROM players WHERE id = ?`).get(target.id)
    assert.equal(restoredPlayer.account_id, targetAccountId, "target account binding must survive")
    assert.equal(restoredPlayer.name, "完整存档来源")
    assert.equal(restoredPlayer.exp_pool, 4321)
    assert.equal(restoredPlayer.free_vmoney, 8765)
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM players_active_quests WHERE player_id = ?`).get(target.id).count, 0)
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM players_repair_versions WHERE player_id = ?`).get(target.id).count, 0)
    assertDailyMailsPreserved(target.id, targetDailyBefore, true)
    assert.deepEqual(identityState(), originalIdentity, "credentials, UID, device bindings and account metadata stay on the target")
    assert.deepEqual(targetState(source.id), sourceBefore, "export/import must leave source identity, progress and daily grants intact")
    assert.equal(db.prepare("SELECT count(*) n FROM players_mails WHERE player_id=? AND subject='来源日邮'").get(target.id).n, 0)
    assert.equal(db.prepare("SELECT count(*) n FROM players_mails WHERE player_id=?").get(target.id).n, 3)
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM players_follows WHERE follower_player_id = ? AND followed_player_id = ?`).get(target.id, other.id).count, 1)
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM leaderboard_runs WHERE player_id = ? AND competition_key = ?`).get(target.id, "snapshot-target").count, 1)
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM leaderboard_runs WHERE player_id = ? AND competition_key = ?`).get(target.id, "snapshot-source").count, 0)
    assert.equal(db.prepare(`SELECT claimed_at FROM players_carnival_event_reward_claims WHERE player_id = ?`).get(target.id).claimed_at, 1888888)
    assertHistoryWasRemapped(source.id, target.id)

    const noHistoryTarget = insertDefaultPlayerSync(createAccount(insertAccountSync, "no-history-target").id)
    const noHistoryMail = db.prepare(`INSERT INTO players_mails
        (player_id, subject, description, type, number, create_time)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(noHistoryTarget.id, "保留目标历史", "keep", 1, 1, "2026-08-21T00:00:00.000Z")
    db.prepare("INSERT INTO daily_vmoney_mail_grants(bucket,player_id,mail_id,created_at_ms) VALUES('2026-08-21',?,?,1234569)")
        .run(noHistoryTarget.id, Number(noHistoryMail.lastInsertRowid))
    seedLoginIdentity(noHistoryTarget.id, "nohistory")
    const noHistoryDailyBefore = dailyState(noHistoryTarget.id), noHistoryIdentity = identityState()
    db.prepare(`INSERT INTO players_practice_battle_history
        (id, player_id, play_id, category_id, create_time, elapsed_time_ms, finish_kind, quest_id, total_damage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(730001, noHistoryTarget.id, "keep-target-practice-battle", 15, "2026-08-21 00:01:00", 1000, 1, 92016, 50)
    const noHistoryResult = api.restorePlayerSaveSnapshotV2Sync(snapshot, noHistoryTarget.id, {
        includeArchiveHistory: false,
    })
    assert.deepEqual(noHistoryResult.skippedTables.sort(), [
        "players_mails",
        "players_practice_battle_history",
        "players_receive_history",
    ].sort())
    const keptMails = db.prepare(`SELECT subject FROM players_mails WHERE player_id = ?`).all(noHistoryTarget.id)
    assert.deepEqual(keptMails, [{ subject: "保留目标历史" }])
    assertDailyMailsPreserved(noHistoryTarget.id, noHistoryDailyBefore, false)
    assert.deepEqual(identityState(), noHistoryIdentity)
    const keptPracticeHistory = db.prepare(`
        SELECT play_id FROM players_practice_battle_history WHERE player_id = ?
    `).all(noHistoryTarget.id)
    assert.deepEqual(keptPracticeHistory, [{ play_id: "keep-target-practice-battle" }])

    const beforeRollback = api.createPlayerSaveSnapshotV2Sync(noHistoryTarget.id)
    const rawBeforeRollback = targetState(noHistoryTarget.id)
    const invalid = JSON.parse(JSON.stringify(snapshot))
    assert.ok(invalid.data.tables.players_items.rows.length > 0)
    invalid.data.tables.players_items.rows.push([...invalid.data.tables.players_items.rows[0]])
    invalid.summary.rowCount += 1
    assert.throws(
        () => api.restorePlayerSaveSnapshotV2Sync(invalid, noHistoryTarget.id),
        /UNIQUE constraint failed/,
    )
    const afterRollback = api.createPlayerSaveSnapshotV2Sync(noHistoryTarget.id)
    assert.deepEqual(afterRollback.data, beforeRollback.data, "failed restore must roll back every write")
    assert.deepEqual(targetState(noHistoryTarget.id), rawBeforeRollback, "rollback also preserves excluded grants and all login identity")

    const lateFailureBefore = targetState(target.id)
    db.exec(`CREATE TEMP TRIGGER fail_snapshot_daily_mapping AFTER UPDATE OF mail_id ON daily_vmoney_mail_grants
        WHEN NEW.player_id=${target.id}
        BEGIN SELECT RAISE(ABORT,'fixture daily mapping failure'); END`)
    try {
        assert.throws(() => api.restorePlayerSaveSnapshotV2Sync(snapshot, target.id), /fixture daily mapping failure/)
    } finally { db.exec("DROP TRIGGER fail_snapshot_daily_mapping") }
    assert.deepEqual(targetState(target.id), lateFailureBefore, "failure after mail insertion and grant remapping rolls back exact rows and IDs")
    const retryDailyBefore = dailyState(target.id)
    api.restorePlayerSaveSnapshotV2Sync(snapshot, target.id)
    assertDailyMailsPreserved(target.id, retryDailyBefore, true)
    assert.equal(db.prepare("SELECT count(*) n FROM players_mails WHERE player_id=?").get(target.id).n, 3, "retry does not duplicate target grants or source mail")
    assert.deepEqual(identityState(), lateFailureBefore.identity)
    assert.deepEqual(targetState(source.id).daily, sourceBefore.daily)

    db.prepare(`CREATE TABLE snapshot_unknown_player_state (
        player_id INTEGER PRIMARY KEY,
        value INTEGER NOT NULL,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()
    assert.throws(() => api.assertPlayerSnapshotCoverageSync(db), /snapshot_unknown_player_state/)
    db.prepare(`DROP TABLE snapshot_unknown_player_state`).run()
    api.assertPlayerSnapshotCoverageSync(db)
    return { sourcePlayerId: source.id, snapshot }
}

function createMultipartJson(value, filename = "save.json") {
    const boundary = `----snapshot-v2-${randomUUID()}`
    const json = Buffer.from(JSON.stringify(value), "utf8")
    const body = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            "Content-Type: application/json\r\n\r\n",
            "utf8",
        ),
        json,
        Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ])
    return {
        body,
        headers: {
            accept: "application/json",
            "content-type": `multipart/form-data; boundary=${boundary}`,
        },
    }
}

async function runHttpIntegrationTests(api, fixture) {
    const Fastify = require("fastify")
    const webApiRoutes = require("../src/routes/web_api").default
    const app = Fastify()
    await app.register(webApiRoutes, { prefix: "/api" })
    await app.ready()
    try {
        const automaticBackupRoot = path.join(databaseDirectory, "admin-backups")
        fs.mkdirSync(automaticBackupRoot, { recursive: true })
        for (let index = 1; index <= 7; index++) {
            const name = `player-import-999-2020010${index}-000000-000`
            const directory = path.join(automaticBackupRoot, name)
            fs.mkdirSync(directory)
            fs.writeFileSync(path.join(directory, "marker.txt"), "old automatic import backup")
            const oldTime = new Date(`2020-01-0${index}T00:00:00.000Z`)
            fs.utimesSync(directory, oldTime, oldTime)
        }
        const manualBackup = path.join(automaticBackupRoot, "manual-full-20200108-000000-000")
        const accountCleanupBackup = path.join(automaticBackupRoot, "unnoted-accounts-20200108-000000-000")
        fs.mkdirSync(manualBackup)
        fs.mkdirSync(accountCleanupBackup)
        fs.writeFileSync(path.join(manualBackup, "marker.txt"), "keep manual")
        fs.writeFileSync(path.join(accountCleanupBackup, "marker.txt"), "keep cleanup")

        const exported = await app.inject({
            method: "GET",
            url: `/api/player/save?id=${fixture.sourcePlayerId}`,
            headers: { accept: "application/json" },
        })
        assert.equal(exported.statusCode, 200, exported.body)
        assert.match(exported.headers["content-disposition"], /save_\d+\.json/)
        const exportedSnapshot = exported.json()
        assert.equal(exportedSnapshot.version, 2)

        const importAccount = createAccount(api.insertAccountSync, "http-import")
        const importTarget = api.insertDefaultPlayerSync(importAccount.id)
        seedLoginIdentity(importTarget.id, "httpimport")
        const importMail = db.prepare(`INSERT INTO players_mails(player_id,subject,description,type,number,receive_time,create_time)
            VALUES(?,'HTTP目标日邮','preserve HTTP target',4,789,'2026-08-20T02:00:00.000Z','2026-08-20T00:00:00.000Z')`).run(importTarget.id)
        db.prepare("INSERT INTO daily_vmoney_mail_grants(bucket,player_id,mail_id,created_at_ms) VALUES('2026-08-20',?,?,1234570)")
            .run(importTarget.id, Number(importMail.lastInsertRowid))
        const importBefore = targetState(importTarget.id), importDailyBefore = dailyState(importTarget.id)
        const imported = await app.inject({
            method: "POST",
            url: `/api/player/save?id=${importTarget.id}`,
            ...createMultipartJson(exportedSnapshot),
        })
        assert.equal(imported.statusCode, 200, imported.body)
        const importedResult = imported.json()
        assert.equal(importedResult.snapshotVersion, 2)
        assert.equal(importedResult.legacyPartialSnapshot, undefined)
        assert.equal(importedResult.retainedBackups, 5)
        assert.equal(importedResult.removedBackups, 3)
        assert.equal(importedResult.backupCleanupError, null)
        const backupDirectory = path.join(
            databaseDirectory,
            importedResult.backup.replace(/^\.database[\\/]admin-backups[\\/]/, "admin-backups/"),
        )
        assert.equal(fs.existsSync(path.join(backupDirectory, "wdfp_data.db")), false)
        const rollbackSnapshot = JSON.parse(fs.readFileSync(path.join(backupDirectory, "player-save.json"), "utf8"))
        assert.equal(rollbackSnapshot.version, 2)
        assert.equal(rollbackSnapshot.playerId, importTarget.id)
        assert.equal(rollbackSnapshot.summary.playerName, "冒险者")
        assert.deepEqual(rollbackSnapshot.data, importBefore.snapshot, "automatic backup is the destination before replacement")
        assert.deepEqual(rollbackSnapshot.dailyMailBasis, { version: 1, mails: [{ bucket: "2026-08-20", mailId: Number(importMail.lastInsertRowid) }] })
        const rollbackInfo = JSON.parse(fs.readFileSync(path.join(backupDirectory, "backup-info.json"), "utf8"))
        assert.equal(rollbackInfo.includesFullDatabase, false)
        assert.equal(rollbackInfo.sourceSnapshotVersion, 2)
        assert.equal(
            fs.readdirSync(automaticBackupRoot, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && /^player-import-/.test(entry.name)).length,
            5,
        )
        assert.equal(fs.existsSync(path.join(manualBackup, "marker.txt")), true)
        assert.equal(fs.existsSync(path.join(accountCleanupBackup, "marker.txt")), true)
        assert.equal(db.prepare(`SELECT name FROM players WHERE id = ?`).get(importTarget.id).name, "完整存档来源")
        assert.equal(db.prepare("SELECT account_id FROM players WHERE id=?").get(importTarget.id).account_id, importAccount.id)
        assertDailyMailsPreserved(importTarget.id, importDailyBefore, true)
        assert.deepEqual(identityState(), importBefore.identity)
        assertHistoryWasRemapped(fixture.sourcePlayerId, importTarget.id)
        assert.equal(db.prepare("SELECT count(*) n FROM players_mails WHERE player_id=? AND subject='来源日邮'").get(importTarget.id).n, 0)

        const failedImportBefore = targetState(importTarget.id)
        db.exec(`CREATE TEMP TRIGGER fail_http_daily_mapping AFTER UPDATE OF mail_id ON daily_vmoney_mail_grants
            WHEN NEW.player_id=${importTarget.id}
            BEGIN SELECT RAISE(ABORT,'fixture HTTP daily mapping failure'); END`)
        try {
            const failedImport = await app.inject({ method: "POST", url: `/api/player/save?id=${importTarget.id}`,
                ...createMultipartJson(exportedSnapshot) })
            assert.equal(failedImport.statusCode, 500, failedImport.body)
            assert.deepEqual(targetState(importTarget.id), failedImportBefore, "HTTP late SQL failure preserves exact mail/grant/identity rows")
        } finally { db.exec("DROP TRIGGER fail_http_daily_mapping") }

        const legacyAccount = createAccount(api.insertAccountSync, "http-v1-import")
        const legacyTarget = api.insertDefaultPlayerSync(legacyAccount.id)
        seedLoginIdentity(legacyTarget.id, "httplegacy")
        db.prepare(`INSERT INTO players_follows (follower_player_id, followed_player_id, created_at) VALUES (?, ?, ?)`)
            .run(legacyTarget.id, fixture.sourcePlayerId, 2000001)
        db.prepare(`INSERT INTO published_parties
            (code, owner_player_id, party_name, battle_party_json, schema_version, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`)
            .run(`legacy-${legacyTarget.id}`, legacyTarget.id, "保留公开队伍", "{}", 1, 2000002)
        db.prepare(`INSERT INTO quest_npc_party_pool
            (quest_category, quest_id, source_player_id, party_slot, battle_power, party_element, party_payload, cleared_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(1, 999001, legacyTarget.id, 1, 12345, 0, "{}", 2000003)
        db.prepare(`INSERT INTO raid_event_global_kill_ledger
            (event_id, play_id, player_id, quest_id, created_at) VALUES (?, ?, ?, ?, ?)`)
            .run(999002, `legacy-play-${legacyTarget.id}`, legacyTarget.id, 999003, 2000004)
        const legacyMail = db.prepare(`INSERT INTO players_mails
            (player_id, subject, description, type, number, create_time)
            VALUES (?, ?, ?, ?, ?, ?)`)
            .run(legacyTarget.id, "旧版目标邮件", "keep?", 1, 1, "2026-08-20T00:00:00.000Z")
        db.prepare(`INSERT INTO daily_vmoney_mail_grants (bucket, player_id, mail_id, created_at_ms)
            VALUES (?, ?, ?, ?)`)
            .run("2026-08-20", legacyTarget.id, Number(legacyMail.lastInsertRowid), 2026082000001)
        seedLeaderboardRecord(legacyTarget.id, "legacy-target")
        const legacySnapshot = {
            schema: "starpoint-cn-save",
            version: 1,
            exportedAt: new Date().toISOString(),
            playerId: fixture.sourcePlayerId,
            data: api.getMergedPlayerDataSync(fixture.sourcePlayerId),
        }
        const legacyStateBefore = businessDatabaseDigest(db)
        const legacyBefore = targetState(legacyTarget.id), legacyDailyBefore = dailyState(legacyTarget.id)
        const backupsBeforeLegacy = fs.readdirSync(automaticBackupRoot).sort()
        const legacyImported = await app.inject({
            method: "POST",
            url: `/api/player/save?id=${legacyTarget.id}`,
            ...createMultipartJson(legacySnapshot, "legacy-v1.json"),
        })
        assert.equal(legacyImported.statusCode, 400, legacyImported.body)
        assert.match(legacyImported.json().error, /仅支持 V2 完整存档/)
        assert.equal(businessDatabaseDigest(db), legacyStateBefore,
            "rejected V1 HTTP import must preserve all target player state")
        assert.deepEqual(targetState(legacyTarget.id), legacyBefore, "unsupported V1 must fail before any destination mutation")
        assertDailyMailsPreserved(legacyTarget.id, legacyDailyBefore, false)
        assert.deepEqual(fs.readdirSync(automaticBackupRoot).sort(), backupsBeforeLegacy, "rejected V1 must not create/prune safety backups")
        assert.equal(db.prepare(`SELECT account_id FROM players WHERE id = ?`).get(legacyTarget.id).account_id, legacyAccount.id)
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM players_follows WHERE follower_player_id = ?`).get(legacyTarget.id).count, 1)
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM published_parties WHERE owner_player_id = ?`).get(legacyTarget.id).count, 1)
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM quest_npc_party_pool WHERE source_player_id = ?`).get(legacyTarget.id).count, 1)
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM raid_event_global_kill_ledger WHERE player_id = ?`).get(legacyTarget.id).count, 1)
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM leaderboard_runs WHERE player_id = ? AND competition_key = ?`).get(legacyTarget.id, "legacy-target").count, 1)
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM daily_vmoney_mail_grants WHERE player_id = ?`).get(legacyTarget.id).count, 1)

        const defaultUploaded = await app.inject({
            method: "POST",
            url: "/api/server/defaultSave",
            ...createMultipartJson(exportedSnapshot),
        })
        assert.equal(defaultUploaded.statusCode, 200, defaultUploaded.body)
        assert.equal(defaultUploaded.json().version, 2)
        const defaultAccount = createAccount(api.insertAccountSync, "http-default")
        const defaultCreated = await app.inject({
            method: "POST",
            url: `/api/server/newSave?accountId=${defaultAccount.id}`,
            headers: { accept: "application/json" },
        })
        assert.equal(defaultCreated.statusCode, 200, defaultCreated.body)
        assert.equal(defaultCreated.json().appliedTemplate, true)
        const defaultPlayerId = defaultCreated.json().playerId
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM players_carnival_event_reward_claims WHERE player_id = ?`).get(defaultPlayerId).count, 1)
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM players_mails WHERE player_id = ?`).get(defaultPlayerId).count, 0)

        const cloneAccount = createAccount(api.insertAccountSync, "http-clone")
        const cloned = await app.inject({
            method: "POST",
            url: `/api/server/cloneSave?playerId=${fixture.sourcePlayerId}&accountId=${cloneAccount.id}`,
            headers: { accept: "application/json" },
        })
        assert.equal(cloned.statusCode, 200, cloned.body)
        assert.equal(cloned.json().snapshotVersion, 2)
        const clonedPlayerId = cloned.json().newPlayerId
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM players_carnival_event_reward_claims WHERE player_id = ?`).get(clonedPlayerId).count, 1)
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM players_mails WHERE player_id = ?`).get(clonedPlayerId).count, 0)
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM players_follows WHERE follower_player_id = ? OR followed_player_id = ?`).get(clonedPlayerId, clonedPlayerId).count, 0)

        const invalidTemplate = JSON.parse(JSON.stringify(exportedSnapshot))
        invalidTemplate.schemaFingerprint = "incompatible-schema"
        const templatePath = path.join(databaseDirectory, "default_save.json")
        const previousTemplate = fs.readFileSync(templatePath)
        assert.throws(() => api.saveDefaultSaveTemplate(invalidTemplate), /数据库结构/)
        assert.deepEqual(fs.readFileSync(templatePath), previousTemplate, "invalid uploads preserve the configured template")
        // Exercise legacy/on-disk corruption separately from the validated
        // upload API; neither recovery location may silently become an empty save.
        fs.writeFileSync(templatePath, JSON.stringify(invalidTemplate))
        fs.writeFileSync(`${templatePath}.bak`, JSON.stringify(invalidTemplate))
        const rejectedTemplateAccount = createAccount(api.insertAccountSync, "http-invalid-default")
        const playerCountBeforeRejectedTemplate = db.prepare(`SELECT COUNT(*) count FROM players`).get().count
        const rejectedTemplate = await app.inject({
            method: "POST",
            url: `/api/server/newSave?accountId=${rejectedTemplateAccount.id}`,
            headers: { accept: "application/json" },
        })
        assert.equal(rejectedTemplate.statusCode, 409, rejectedTemplate.body)
        assert.match(rejectedTemplate.json().error, /未创建新存档/)
        assert.equal(db.prepare(`SELECT COUNT(*) count FROM players`).get().count, playerCountBeforeRejectedTemplate)
    } finally {
        await app.close()
    }
}

function runCopiedDatabaseTest(api) {
    api.assertPlayerSnapshotCoverageSync(db)
    const source = db.prepare(`SELECT id FROM players ORDER BY id LIMIT 1`).get()
    assert.ok(source, "copied database must contain at least one player")
    const exportStartedAt = Date.now()
    const snapshot = api.createPlayerSaveSnapshotV2Sync(source.id)
    const exportMilliseconds = Date.now() - exportStartedAt
    const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8")
    const account = createAccount(api.insertAccountSync, "copied-target")
    const target = api.insertDefaultPlayerSync(account.id)
    const restoreStartedAt = Date.now()
    const result = api.restorePlayerSaveSnapshotV2Sync(snapshot, target.id, { includeArchiveHistory: true })
    const restoreMilliseconds = Date.now() - restoreStartedAt
    assert.ok(result.restoredTables > 1)
    assert.equal(db.prepare(`SELECT account_id FROM players WHERE id = ?`).get(target.id).account_id, account.id)
    assert.equal(db.pragma("foreign_key_check").length, 0)
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok")
    console.log(JSON.stringify({
        copiedSourcePlayerId: source.id,
        snapshotRows: snapshot.summary.rowCount,
        restoredRows: result.restoredRows,
        restoredTables: result.restoredTables,
        snapshotBytes,
        exportMilliseconds,
        restoreMilliseconds,
    }))
}

async function main() {
    await prepareDatabaseCopy()
    const { initializeDatabase } = require("../src/data")
    const { getDb } = require("../src/data/db")
    const { insertAccountSync } = require("../src/data/domains/account")
    const { insertDefaultPlayerSync } = require("../src/data/domains/player")
    const { getMergedPlayerDataSync } = require("../src/data/utils")
    const { saveDefaultSaveTemplate } = require("../src/data/defaultSave")
    const snapshotApi = require("../src/data/snapshots/player-snapshot")
    initializeDatabase()
    db = getDb()
    require("../src/lib/player-login").initializePlayerLogin()
    const api = { ...snapshotApi, insertAccountSync, insertDefaultPlayerSync, getMergedPlayerDataSync, saveDefaultSaveTemplate }
    if (sourceDatabasePath) runCopiedDatabaseTest(api)
    else {
        const fixture = runFreshDatabaseTests(api)
        await runHttpIntegrationTests(api, fixture)
    }
    console.log(sourceDatabasePath
        ? "player snapshot V2 copied-database test passed"
        : "player snapshot V2 tests passed")
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
}).finally(() => {
    cleanup()
    process.removeListener("exit", cleanup)
}).then(() => {
    // Importing the full admin route tree also imports multiplayer cleanup
    // timers. The assertions and Fastify instance are already closed here.
    process.exit(process.exitCode ?? 0)
})
