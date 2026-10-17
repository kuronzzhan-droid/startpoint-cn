const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const Fastify = require("fastify")

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "startpoint-deadline-"))
process.env.DATA_DIR = dataDir
const { getDb } = require("../out/data/db")
const { insertAccountSync } = require("../out/data/domains/account")
const { insertPlayerSync } = require("../out/data/domains/player")
const { getDefaultPlayerData } = require("../out/data/utils")
const { countLeaderboardRanksSync, getActiveLeaderboardRunSync } = require("../out/data/domains/leaderboard")
const { getLeaderboardCompetition, getLeaderboardCompetitionSeasonSync } = require("../out/lib/leaderboard/competition")
const { getLeaderboardAvailabilitySync, isLeaderboardEnabledSync, setLeaderboardAvailabilitySync } = require("../out/lib/leaderboard/availability")
const { getLeaderboardSettlementConfigSync, putLeaderboardSettlementConfigSync, runDueLeaderboardSettlementsSync,
    settleLeaderboardSeasonSync, rolloverLeaderboardSeasonSync, createLeaderboardSettlementScheduler } = require("../out/lib/leaderboard/settlement")
const { buildNativeLeaderboardPayload } = require("../out/lib/leaderboard/presentation")
const { startLeaderboardQuestSync, finishLeaderboardQuestSync } = require("../out/lib/leaderboard/service")
const adminRoutes = require("../out/routes/web_api/leaderboards").default
const db = getDb()
const competition = getLeaderboardCompetition("rush:700099:1")
const deadline = Date.UTC(2026, 8, 13, 15, 59)
const party = { characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
    equipmentIds: [null, null, null], abilitySoulIds: [null, null, null],
    evolutionImgLevels: [0, null, null], unisonEvolutionImgLevels: [null, null, null] }
const quest = { category: competition.category, eventId: competition.eventId, folderId: competition.folderId,
    round: 1, questId: 700099001, totalRounds: 1 }
let now, season, identity = 0

test.beforeEach(t => {
    now = deadline - 10_000
    t.mock.method(Date, "now", () => now)
    for (const table of ["leaderboard_settlement_results", "leaderboard_settlements", "leaderboard_run_rounds",
        "leaderboard_runs", "leaderboard_settlement_configs", "leaderboard_seasons", "leaderboard_availability",
        "players_mails", "players_degrees", "players", "accounts"]) db.prepare(`DELETE FROM ${table}`).run()
    season = getLeaderboardCompetitionSeasonSync(competition.key)
})
test.after(() => {
    db.close()
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()))
    fs.rmSync(dataDir, { recursive: true, force: true })
})

function player(name) {
    const account = insertAccountSync({ appId: "wf_cn", idpAlias: String(++identity), idpCode: "leiting", idpId: "", status: "normal" })
    return insertPlayerSync(account.id, { ...getDefaultPlayerData(), name })
}
function finish(id, finishedAtMs = now) {
    finishLeaderboardQuestSync({ playerId: id, quest, accomplished: true, clientBattleMs: 1000, party, finishedAtMs })
}
function completedPlayer() {
    const id = player("Ranked")
    assert.ok(startLeaderboardQuestSync(id, quest, now - 2000))
    finish(id, now - 1000)
    return id
}
function config(patch) {
    putLeaderboardSettlementConfigSync({ ...getLeaderboardSettlementConfigSync(competition.key), ...patch, updatedAtMs: now })
    return getLeaderboardSettlementConfigSync(competition.key)
}
function mailCount() { return db.prepare("SELECT COUNT(*) n FROM players_mails").get().n }
async function admin(t) {
    const app = Fastify()
    await app.register(adminRoutes, { prefix: "/leaderboards" })
    t.after(() => app.close())
    return app
}
const adminUrl = `/leaderboards/${encodeURIComponent(competition.key)}`

test("只保存时间而关闭两个开关不会冻结、发奖或向客户端宣称有效截止时间", () => {
    const id = completedPlayer()
    assert.equal(buildNativeLeaderboardPayload(competition, id).time, "实时更新")
    config({ settleAtMs: deadline, autoEnabled: false, freezeEnabled: false })
    assert.equal(buildNativeLeaderboardPayload(competition, id).time, "未启用定时结算")
    now = deadline + 1000
    runDueLeaderboardSettlementsSync()
    assert.equal(isLeaderboardEnabledSync(competition.key), true)
    assert.ok(startLeaderboardQuestSync(id, quest))
    finish(id)
    assert.equal(mailCount(), 0)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM leaderboard_settlements").get().n, 0)
})

test("到时冻结独立于发奖；精确截止拦截已开始挑战的完成请求，审核后手动发奖", async t => {
    const id = completedPlayer()
    const late = player("Late")
    config({ settleAtMs: deadline, freezeEnabled: true, autoEnabled: false })
    assert.equal(buildNativeLeaderboardPayload(competition, id).time, "截止：09-13 23:59")
    now = deadline - 1
    assert.ok(startLeaderboardQuestSync(late, quest))
    assert.equal(isLeaderboardEnabledSync(competition.key), true)
    now = deadline
    // No scheduler tick has run: the write path must already enforce the cutoff.
    finish(late)
    assert.equal(isLeaderboardEnabledSync(competition.key), false)
    assert.equal(getActiveLeaderboardRunSync(late, competition.key), null)
    assert.equal(startLeaderboardQuestSync(late, quest), null)
    assert.equal(countLeaderboardRanksSync(competition.key, season), 1)
    runDueLeaderboardSettlementsSync()
    assert.equal(mailCount(), 0)
    assert.equal(buildNativeLeaderboardPayload(competition, id).time, "已冻结，待结算")
    const firstFreeze = getLeaderboardAvailabilitySync(competition.key).updatedAtMs
    now += 60_000
    runDueLeaderboardSettlementsSync()
    assert.equal(getLeaderboardAvailabilitySync(competition.key).updatedAtMs, firstFreeze)
    assert.equal(getLeaderboardSettlementConfigSync(competition.key).settleAtMs, deadline)
    const app = await admin(t)
    const award = await app.inject({ method: "POST", url: `${adminUrl}/settle` })
    assert.equal(award.statusCode, 200, award.payload)
    assert.equal(award.json().rewardedPlayers, 1)
    assert.equal(mailCount(), 2)
    assert.equal(buildNativeLeaderboardPayload(competition, id).time, "已结算")
    const repeatedAward = await app.inject({ method: "POST", url: `${adminUrl}/settle` })
    assert.equal(repeatedAward.statusCode, 429)
    assert.equal(repeatedAward.json().code, "LEADERBOARD_BUSY")
    assert.equal(mailCount(), 2)
})

test("自动发奖强制冻结；邮件失败仍保持停榜且重试不重复发奖", () => {
    const id = completedPlayer()
    const saved = config({ settleAtMs: deadline, freezeEnabled: false, autoEnabled: true })
    assert.equal(saved.freezeEnabled, true)
    assert.equal(buildNativeLeaderboardPayload(competition, id).time, "结算：09-13 23:59")
    db.exec("CREATE TEMP TRIGGER fail_deadline_mail BEFORE INSERT ON players_mails BEGIN SELECT RAISE(ABORT, 'mail-failed'); END")
    now = deadline
    try {
        assert.throws(() => runDueLeaderboardSettlementsSync(), /mail-failed/)
        assert.equal(isLeaderboardEnabledSync(competition.key), false)
        assert.equal(mailCount(), 0)
        assert.equal(db.prepare("SELECT COUNT(*) n FROM leaderboard_settlements").get().n, 0)
        assert.equal(getLeaderboardSettlementConfigSync(competition.key).autoEnabled, true)
        assert.equal(buildNativeLeaderboardPayload(competition, id).time, "已冻结，待结算")
    } finally { db.exec("DROP TRIGGER fail_deadline_mail") }
    runDueLeaderboardSettlementsSync()
    assert.equal(mailCount(), 2)
    const after = getLeaderboardSettlementConfigSync(competition.key)
    assert.equal(after.autoEnabled, false)
    assert.equal(after.freezeEnabled, false)
    assert.equal(after.settleAtMs, null)
    assert.equal(buildNativeLeaderboardPayload(competition, id).time, "已结算")
    runDueLeaderboardSettlementsSync()
    assert.equal(mailCount(), 2)
    assert.equal(getLeaderboardCompetitionSeasonSync(competition.key), season)
})

test("自动发奖重复计划推进到未来，但已结算页不显示下一期时间，也不自动开榜或换季", () => {
    const id = completedPlayer()
    config({ settleAtMs: deadline, freezeEnabled: true, autoEnabled: true, repeatIntervalMs: 3600_000 })
    now = deadline + 90_000
    runDueLeaderboardSettlementsSync()
    const next = getLeaderboardSettlementConfigSync(competition.key)
    assert.equal(next.settleAtMs, deadline + 3600_000)
    assert.equal(next.autoEnabled, true)
    assert.equal(next.freezeEnabled, true)
    assert.equal(isLeaderboardEnabledSync(competition.key), false)
    assert.equal(buildNativeLeaderboardPayload(competition, id).time, "已结算")
    assert.equal(getLeaderboardCompetitionSeasonSync(competition.key), season)
    assert.equal(mailCount(), 2)
})

test("后台校验开关与时间；到点后不能误操作重新开榜", async t => {
    const app = await admin(t)
    let response = await app.inject({ method: "PATCH", url: `${adminUrl}/config`, payload: {
        settleAtMs: deadline, autoEnabled: true, freezeEnabled: false,
    } })
    assert.equal(response.statusCode, 200, response.payload)
    assert.equal(response.json().config.freezeEnabled, true)
    response = await app.inject({ method: "PATCH", url: `${adminUrl}/config`, payload: { autoEnabled: false } })
    assert.equal(response.json().config.freezeEnabled, true)
    for (const payload of [{ freezeEnabled: "false" }, { autoEnabled: "true" }, { settleAtMs: null },
        { settleAtMs: -1 }, { settleAtMs: 9e15 }]) {
        response = await app.inject({ method: "PATCH", url: `${adminUrl}/config`, payload })
        assert.equal(response.statusCode, 400, response.payload)
    }
    now = deadline
    assert.equal((await app.inject({ method: "GET", url: adminUrl })).json().availability.enabled, false)
    response = await app.inject({ method: "PATCH", url: `${adminUrl}/availability`, payload: { enabled: true } })
    assert.equal(response.statusCode, 409, response.payload)
    await app.inject({ method: "PATCH", url: `${adminUrl}/config`, payload: { settleAtMs: deadline + 3600_000 } })
    assert.equal(isLeaderboardEnabledSync(competition.key), false)
    assert.equal((await app.inject({ method: "PATCH", url: `${adminUrl}/availability`, payload: { enabled: true } })).statusCode, 200)
    settleLeaderboardSeasonSync(competition.key, "manual")
    response = await app.inject({ method: "PATCH", url: `${adminUrl}/availability`, payload: { enabled: true } })
    assert.equal(response.statusCode, 409, response.payload)
})

test("空赛季到期显示当前期待结算；结算后为空也不会误显示上一期榜单", () => {
    const id = completedPlayer()
    settleLeaderboardSeasonSync(competition.key, "previous")
    rolloverLeaderboardSeasonSync(competition.key, "next")
    setLeaderboardAvailabilitySync(competition.key, true)
    config({ settleAtMs: deadline, freezeEnabled: true, autoEnabled: false })
    now = deadline
    const empty = buildNativeLeaderboardPayload(competition, id)
    assert.equal(empty.time, "已冻结，待结算")
    assert.equal(empty.total, 0)
    assert.equal(empty.reward.length, 5)
    assert.match(empty.name, /按100人参榜预览/)
    settleLeaderboardSeasonSync(competition.key, "empty")
    assert.equal(buildNativeLeaderboardPayload(competition, id).time, "已结算")
    assert.equal(buildNativeLeaderboardPayload(competition, id).total, 0)
})

test("服务启动立即补做逾期冻结，无需等待首个一分钟检查", async () => {
    completedPlayer()
    config({ settleAtMs: deadline, freezeEnabled: true, autoEnabled: false })
    now = deadline + 3600_000
    const scheduler = createLeaderboardSettlementScheduler()
    try {
        scheduler.start()
        const raw = db.prepare("SELECT enabled FROM leaderboard_availability WHERE competition_key = ?").get(competition.key)
        assert.equal(raw.enabled, 0)
        assert.equal(mailCount(), 0)
    } finally { await scheduler.stop() }
})

test("后台和客户端共用北京时间转换，在洛杉矶、UTC、上海时区均不漂移", () => {
    const modulePath = path.resolve(__dirname, "../out/lib/leaderboard/schedule-time.js")
    for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Shanghai"]) {
        const result = spawnSync(process.execPath, ["-e", `
            const assert = require('node:assert/strict');
            const { parseLeaderboardDeadlineInput: parse, formatLeaderboardDeadlineInput: format } = require(${JSON.stringify(modulePath)});
            const timestamp = parse('2026-09-13T23:59');
            assert.equal(timestamp, Date.UTC(2026, 8, 13, 15, 59));
            assert.equal(format(timestamp), '2026-09-13T23:59');
            assert.equal(parse('2027-01-01T00:01'), Date.UTC(2026, 11, 31, 16, 1));
            assert.equal(parse(''), null);
            for (const invalid of ['2026-02-30T23:59', '2026-09-13T24:01', 'not-a-date']) assert.throws(() => parse(invalid));
        `], { env: { ...process.env, TZ: timezone }, encoding: "utf8" })
        assert.equal(result.status, 0, `${timezone}: ${result.stdout}\n${result.stderr}`)
    }
})
