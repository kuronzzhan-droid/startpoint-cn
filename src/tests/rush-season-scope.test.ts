/**
 * 20260828 四路复核修掉的那批问题的回归测试。
 *
 * 归在一个文件里的理由:它们共享同一条主线 ——「重摇塔 = 结算 + 换期 = 新的一张空榜」
 * 这条语义要真正贯通,得同时管住四处:榜(按期)、个人纪录(按期)、后台统计(当期/累计
 * 分开)、以及**换期之前必须先结算**。任何一处漏掉,作者都会在游戏里看到「新塔挂着
 * 旧塔的成绩」或者「奖励再也发不出来」。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-rush-season-scope-"));
process.env.WF_DATABASE_DIR = databaseDir;

const domain =
    require("../data/domains/rushLeaderboard") as typeof import("../data/domains/rushLeaderboard");
const settleStore =
    require("../data/domains/rushSettlement") as typeof import("../data/domains/rushSettlement");
const settleService =
    require("../lib/rush-settlement-service") as typeof import("../lib/rush-settlement-service");
const leaderboardService =
    require("../lib/rush-leaderboard-service") as typeof import("../lib/rush-leaderboard-service");
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player");
const newsLib =
    require("../lib/rush-leaderboard-news") as typeof import("../lib/rush-leaderboard-news");
const { getDb } = require("../data/db") as typeof import("../data/db");

import type { RushRunRecord } from "../data/domains/rushLeaderboard";

// 700099 folder 1 在 assets/rush_event_quest.json 里是 30 关 —— settleThenRolloverRushSeason
// 要靠 getRushTowerFolderIdSync 从资产表解出 folder,所以这里必须用真实存在的事件。
const EVENT_ID = 700099;
const FOLDER_ID = 1;
const TOTAL_ROUNDS = 30;

let accountId: number | null = null;

/** players_mails 对 players 有外键、players 对 accounts 有外键 —— 发奖要真实的两级行。 */
function makePlayer(playerId: number, name: string, rankPoint: number = 0): void {
    const db = getDb();
    if (accountId === null) {
        const iso = new Date(0).toISOString();
        accountId = Number(db.prepare(
            `INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id,
                reg_time, last_login_time, status)
             VALUES ('test', ?, '', '', '', ?, ?, 'normal')`).run(iso, iso, iso).lastInsertRowid);
    }
    const columns = (db.prepare("PRAGMA table_info(players)").all() as { name: string }[])
        .map(column => column.name);
    const values = columns.map(column => {
        if (column === "id") return playerId;
        if (column === "name") return name;
        if (column === "account_id") return accountId;
        if (column === "rank_point") return rankPoint;
        return 0;
    });
    db.prepare(`INSERT OR REPLACE INTO players (${columns.join(",")}) `
        + `VALUES (${columns.map(() => "?").join(",")})`).run(values);
}

function seedRun(
    playerId: number,
    season: number,
    battleMs: number,
    finishedAtMs: number
): number {
    const run = domain.rushLeaderboardStore.insertRun({
        playerId, playerName: `存档${playerId}`, eventId: EVENT_ID, folderId: FOLDER_ID,
        season, startedAtMs: 0, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
    });
    domain.rushLeaderboardStore.updateRun(run.id, {
        status: "completed", finishedAtMs, endedAtMs: finishedAtMs,
        durationMs: battleMs + 1_000, battleMs, roundsCleared: TOTAL_ROUNDS,
        characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
    });
    return run.id;
}

// ---------------------------------------------------------------------------
// 个人纪录也要按期(记录卡的「历史最佳」)
// ---------------------------------------------------------------------------

test("getRushPlayerFullRunsSync:传了期号就只看那一期", () => {
    makePlayer(401, "阿期");
    seedRun(401, 1, 100_000, 1_000_001);   // 上一座塔的成绩,更快
    seedRun(401, 2, 250_000, 1_000_002);   // 这一座塔的成绩

    const crossSeason = domain.getRushPlayerFullRunsSync(EVENT_ID, FOLDER_ID, 401, 500);
    assert.deepEqual(crossSeason.map(record => record.battleMs), [100_000, 250_000],
        "不传期号仍是跨期(后台排查/没有期次台账时走这条),行为与改造前一致");

    const scoped = domain.getRushPlayerFullRunsSync(EVENT_ID, FOLDER_ID, 401, 500, 2);
    assert.deepEqual(scoped.map(record => record.battleMs), [250_000],
        "传了期号就只剩当期 —— 否则重摇成更难的塔之后,玩家要打破的是上一座塔的纪录,"
        + "破纪录特效可能永远不再触发");

    assert.deepEqual(
        domain.getRushPlayerFullRunsSync(EVENT_ID, FOLDER_ID, 401, 500, 3).map(r => r.id), [],
        "当期一条都没打过 = 空,不许回退到跨期");
});

// ---------------------------------------------------------------------------
// 后台统计卡:当期与累计必须分开
// ---------------------------------------------------------------------------

test("getRushLeaderboardStatsSync:当期数与累计数分列", () => {
    const cumulative = domain.getRushLeaderboardStatsSync(EVENT_ID, FOLDER_ID);
    assert.equal(cumulative.fullRuns, 2, "累计口径不变:两期的成绩都算");
    assert.equal(cumulative.rankedPlayers, 1);
    assert.equal(cumulative.seasonFullRuns, null, "没传期号就不算当期那一份");
    assert.equal(cumulative.seasonRankedPlayers, null);

    const scoped = domain.getRushLeaderboardStatsSync(EVENT_ID, FOLDER_ID, 2);
    assert.equal(scoped.fullRuns, 2, "累计几个数**不**跟着期号变 —— 后台要看得见历史总量");
    assert.equal(scoped.seasonFullRuns, 1, "当期只有第 2 期那一条");
    assert.equal(scoped.seasonRankedPlayers, 1);

    const empty = domain.getRushLeaderboardStatsSync(EVENT_ID, FOLDER_ID, 99);
    assert.equal(empty.seasonFullRuns, 0, "当期没人打过 ⇒ 当期数是 0,而累计数照旧");
    assert.equal(empty.fullRuns, 2);
});

// ---------------------------------------------------------------------------
// 换期必须先结算
// ---------------------------------------------------------------------------

test("settleThenRolloverRushSeason:先结算再换期,而且只换一期", () => {
    domain.rushLeaderboardStore.putSeason({
        eventId: EVENT_ID, season: 2, startedAtMs: 0, fingerprint: "x", source: "test",
    });
    const cfg = settleStore.getRushSettlementConfigSync(EVENT_ID, FOLDER_ID, Date.now());
    settleStore.putRushSettlementConfigSync({
        ...cfg,
        rewardTiers: [{ fromRank: 1, toRank: 10, itemId: 2370099, count: 3 }],
        updatedAtMs: Date.now(),
    });
    const mailsBefore = (getDb().prepare("SELECT COUNT(*) c FROM players_mails")
        .get() as { c: number }).c;

    const outcome = settleService.settleThenRolloverRushSeason(EVENT_ID, "test-rollover");

    assert.equal(outcome.settled, true, outcome.reason);
    assert.equal(outcome.season, 3, "结算自己已经在同一个事务里换过期了,不许再换一次 ——"
        + "换两次的话中间那一期永远是一张没人打过的空榜");
    assert.equal(domain.rushLeaderboardStore.getSeason(EVENT_ID)?.season, 3);

    const frozen = settleStore.getSeasonResultsSync(EVENT_ID, FOLDER_ID, 2, "full-run");
    assert.deepEqual(frozen.map(row => [row.rank, row.playerId]), [[1, 401]],
        "第 2 期的名次已经冻结进 rush_season_results —— 换期之后这一期再也读不出榜了,"
        + "所以冻结必须发生在换期之前");
    const mailsAfter = (getDb().prepare("SELECT COUNT(*) c FROM players_mails")
        .get() as { c: number }).c;
    assert.equal(mailsAfter - mailsBefore, 1, "第 1 名收到了奖励邮件");
});

test("settleThenRolloverRushSeason:这一期已经结算过 ⇒ 只换期,并把原因说出来", () => {
    // 把台账退回第 2 期(它已经结算过),模拟「重摇了两次塔」
    domain.rushLeaderboardStore.putSeason({
        eventId: EVENT_ID, season: 2, startedAtMs: 0, fingerprint: "x", source: "test",
    });
    const mailsBefore = (getDb().prepare("SELECT COUNT(*) c FROM players_mails")
        .get() as { c: number }).c;

    const outcome = settleService.settleThenRolloverRushSeason(EVENT_ID, "test-again");

    assert.equal(outcome.settled, false, "已经结算过的一期不能再发一次奖");
    assert.match(outcome.reason ?? "", /已经结算过/);
    assert.equal(outcome.season, 3, "塔在物理上已经重造了 —— 结算失败也照换期,"
        + "否则新塔上会一直挂着旧塔的成绩");
    const mailsAfter = (getDb().prepare("SELECT COUNT(*) c FROM players_mails")
        .get() as { c: number }).c;
    assert.equal(mailsAfter, mailsBefore, "被拒的结算一封邮件都不能发");
});

// ---------------------------------------------------------------------------
// 换期的三条闸:空期 no-op / 幂等防重 / 真失败不换期
//
// 这三条是「结算 → 换期」原子化之后**唯一**会让人丢东西的三个缺口,
// 所以每一条都要有测试守着,而不是靠代码注释。
// ---------------------------------------------------------------------------

/** 给任意事件/folder 造一条已完成的成绩。 */
function seedRunOn(
    eventId: number,
    folderId: number,
    playerId: number,
    season: number,
    battleMs: number,
    finishedAtMs: number,
    totalRounds: number
): number {
    const run = domain.rushLeaderboardStore.insertRun({
        playerId, playerName: `存档${playerId}`, eventId, folderId,
        season, startedAtMs: 0, totalRounds, trackedFromRound: 1,
    });
    domain.rushLeaderboardStore.updateRun(run.id, {
        status: "completed", finishedAtMs, endedAtMs: finishedAtMs,
        durationMs: battleMs + 1_000, battleMs, roundsCleared: totalRounds,
        characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
    });
    return run.id;
}

function mailCount(): number {
    return (getDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number }).c;
}

/** 配一档「前 10 名有奖」,让空期/幂等这两条不能靠「压根没配奖励」蒙混过关。 */
function configureRewards(eventId: number, folderId: number): void {
    const cfg = settleStore.getRushSettlementConfigSync(eventId, folderId, Date.now());
    settleStore.putRushSettlementConfigSync({
        ...cfg,
        rewardTiers: [{ fromRank: 1, toRank: 10, itemId: 2370099, count: 3 }],
        updatedAtMs: Date.now(),
    });
}

test("空期结算 = 无声 no-op:不发邮件、不写台账、期号不动;但不挡换期", () => {
    const EMPTY_EVENT = 700012;
    const folderId = leaderboardService.getRushTowerFolderIdSync(EMPTY_EVENT)!;
    assert.ok(folderId !== null, "这个事件得有多轮 folder,否则测的是 no-folder 那条别的路");

    domain.rushLeaderboardStore.putSeason({
        eventId: EMPTY_EVENT, season: 1, startedAtMs: 0, fingerprint: "x", source: "test",
    });
    configureRewards(EMPTY_EVENT, folderId);
    const mailsBefore = mailCount();

    const outcome = settleService.settleRushSeasonNow(EMPTY_EVENT, folderId, "test-empty");

    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "empty-season");
    assert.equal(mailCount(), mailsBefore, "一封空邮件都不许发");
    assert.equal(settleStore.getSettlementHistorySync(EMPTY_EVENT, folderId).length, 0,
        "更不许写一条空的 rush_season_settlements —— 那行会把这一期标成「已结算」,"
        + "于是等真有人打出成绩之后反而永远结算不了了");
    assert.equal(settleStore.getSeasonResultsSync(EMPTY_EVENT, folderId, 1).length, 0,
        "也不许留一张空快照");
    assert.equal(domain.rushLeaderboardStore.getSeason(EMPTY_EVENT)?.season, 1,
        "结算被跳过 ⇒ 它内嵌的那次换期也不该发生");

    // 空期是**良性**跳过:一条成绩都没有,换期什么都不会丢 ⇒ 不挡。但也**不推期号**:
    // 空期 +1 换来的只是台账里一段没人打过的空榜,而期号推进不可逆
    // (20260828 三轮复核:连点两次换期端点会连烧两期)。
    const rolled = settleService.settleThenRolloverRushSeason(EMPTY_EVENT, "test-empty-roll");
    assert.equal(rolled.code, "empty-season");
    assert.equal(rolled.settled, false);
    assert.equal(rolled.blocked, false, "空期不许挡住换期 —— 那会让新塔一直挂着旧塔的榜");
    assert.equal(rolled.rolled, false, "这一期还没人打过 ⇒ 原地复用,别白烧一个不可逆的期号");
    assert.equal(rolled.season, 1);
    assert.equal(domain.rushLeaderboardStore.getSeason(EMPTY_EVENT)?.season, 1);
    assert.equal(mailCount(), mailsBefore, "走完整条 settle-then-rollover 也一封都不发");
    assert.equal(settleStore.getSettlementHistorySync(EMPTY_EVENT, folderId).length, 0);
    // 复用不是「什么都不做」:指纹必须重新对上现在这座塔,否则指纹兜底会认为塔
    // 还没收口,每个开第 1 关的玩家都再触发一次结算。
    assert.equal(leaderboardService.isRushSeasonFingerprintStaleSync(EMPTY_EVENT), false,
        "原地复用也要把指纹重新锚到当前这座塔");

    // 再点一次(操作者以为上次没生效)仍然只有这一期,不会一路烧下去。
    const again = settleService.settleThenRolloverRushSeason(EMPTY_EVENT, "test-empty-roll-2");
    assert.equal(again.rolled, false);
    assert.equal(domain.rushLeaderboardStore.getSeason(EMPTY_EVENT)?.season, 1,
        "连点两次不许把期号烧到 3");
});

test("空期原地复用:进行中的 run 照样作废 —— 空期不等于没人在爬", () => {
    // 「这一期是空的」的判据是**榜上没有成绩**,而 run 要打完才会产生榜行。
    // 有人爬到第 20 层时换塔,那一程必须作废,否则他会在一座半新半旧的塔上
    // 打出一条计入榜的成绩。
    const MID_EVENT = 700016;
    const folderId = leaderboardService.getRushTowerFolderIdSync(MID_EVENT)!;
    const totalRounds = leaderboardService.getRushFolderTotalRoundsSync(MID_EVENT, folderId);
    makePlayer(451, "半途甲");

    domain.rushLeaderboardStore.putSeason({
        eventId: MID_EVENT, season: 4, startedAtMs: 0, fingerprint: "x", source: "test",
    });
    const climbing = domain.rushLeaderboardStore.insertRun({
        playerId: 451, playerName: "半途甲", eventId: MID_EVENT, folderId,
        season: 4, startedAtMs: 0, totalRounds, trackedFromRound: 1,
    });

    const outcome = settleService.settleThenRolloverRushSeason(MID_EVENT, "test-midclimb");

    assert.equal(outcome.code, "empty-season", "没人**打完**过 ⇒ 这一期确实是空的");
    assert.equal(outcome.rolled, false, "期号不动");
    assert.equal(outcome.season, 4);
    assert.equal(domain.rushLeaderboardStore.getActiveRun(451, MID_EVENT, folderId), null,
        "但爬到一半的那一程必须作废 —— 塔已经换了");
    assert.equal(
        domain.getRushRunsSync(MID_EVENT, folderId, { limit: 10 })
            .find(row => row.id === climbing.id)?.status,
        "abandoned");
});

test("同一期不许结算两次(幂等防重):第二次一封邮件都不发", () => {
    const DUP_EVENT = 700014;
    const folderId = leaderboardService.getRushTowerFolderIdSync(DUP_EVENT)!;
    const totalRounds = leaderboardService.getRushFolderTotalRoundsSync(DUP_EVENT, folderId);

    makePlayer(431, "幂等甲");
    seedRunOn(DUP_EVENT, folderId, 431, 1, 123_000, 4_000_001, totalRounds);
    domain.rushLeaderboardStore.putSeason({
        eventId: DUP_EVENT, season: 1, startedAtMs: 0, fingerprint: "x", source: "test",
    });
    configureRewards(DUP_EVENT, folderId);

    const mailsBefore = mailCount();
    const first = settleService.settleRushSeasonNow(DUP_EVENT, folderId, "test-dup-1");
    assert.equal(first.ok, true, first.reason);
    assert.equal(first.code, "settled");
    assert.equal(mailCount() - mailsBefore, 1);
    assert.equal(domain.rushLeaderboardStore.getSeason(DUP_EVENT)?.season, 2,
        "结算成功时换期在同一个事务里做完");

    // 作者的真实操作序列:先在后台点「立即结算」,再去重摇塔(重摇那条路也会先结算)。
    // 把台账退回第 1 期就是那一刻的状态。
    domain.rushLeaderboardStore.putSeason({
        eventId: DUP_EVENT, season: 1, startedAtMs: 0, fingerprint: "x", source: "test",
    });
    const mailsAfterFirst = mailCount();

    const again = settleService.settleRushSeasonNow(DUP_EVENT, folderId, "test-dup-2");
    assert.equal(again.ok, false);
    assert.equal(again.code, "already-settled");
    assert.equal(mailCount(), mailsAfterFirst, "第二次一封都不许发(否则前 10 名领两遍奖)");
    assert.equal(settleStore.getSettlementHistorySync(DUP_EVENT, folderId).length, 1,
        "台账里还是只有一条结算记录");

    // 已经结算过也是**良性**:再点一次「结算并开启新一期」只换期,不重复发奖。
    const rolled = settleService.settleThenRolloverRushSeason(DUP_EVENT, "test-dup-roll");
    assert.equal(rolled.code, "already-settled");
    assert.equal(rolled.blocked, false);
    assert.equal(rolled.season, 2);
    assert.equal(mailCount(), mailsAfterFirst);
});

test("结算真失败 ⇒ 换期被挡下,期号一格不动,库里不留半截账", () => {
    const FAIL_EVENT = 700013;
    const folderId = leaderboardService.getRushTowerFolderIdSync(FAIL_EVENT)!;
    const totalRounds = leaderboardService.getRushFolderTotalRoundsSync(FAIL_EVENT, folderId);

    makePlayer(432, "炸库甲");
    seedRunOn(FAIL_EVENT, folderId, 432, 1, 99_000, 5_000_001, totalRounds);
    domain.rushLeaderboardStore.putSeason({
        eventId: FAIL_EVENT, season: 1, startedAtMs: 0, fingerprint: "x", source: "test",
    });
    configureRewards(FAIL_EVENT, folderId);
    const mailsBefore = mailCount();

    // 造一次**真**失败:把结算事务中途要写的那张表藏起来。
    // 用真表名而不是打桩,是为了确保走的就是生产那条 try/catch。
    const db = getDb();
    db.exec("ALTER TABLE rush_season_results RENAME TO rush_season_results_hidden");
    let outcome: ReturnType<typeof settleService.settleThenRolloverRushSeason>;
    try {
        outcome = settleService.settleThenRolloverRushSeason(FAIL_EVENT, "test-hard-fail");
    } finally {
        db.exec("ALTER TABLE rush_season_results_hidden RENAME TO rush_season_results");
    }

    assert.equal(outcome.code, "error");
    assert.equal(outcome.blocked, true,
        "真失败必须挡住换期:「塔换了榜没换」修得回来(后台点一下就补上),"
        + "「换了期没结算」修不回来(结算只能结算台账里当前那一期)");
    assert.equal(outcome.season, null, "期号没推进,所以没有新期号可报");
    assert.equal(outcome.settled, false);
    assert.equal(domain.rushLeaderboardStore.getSeason(FAIL_EVENT)?.season, 1,
        "台账里还是第 1 期 —— 这一期还结算得了");
    assert.equal(mailCount(), mailsBefore, "半路炸了不许留下已发的邮件");
    assert.equal(settleStore.getSettlementHistorySync(FAIL_EVENT, folderId).length, 0,
        "更不许留一条「已结算」的账,否则重试时会被幂等防重挡掉");

    // 修好之后重试:同一期照样结算得出来,奖一分不少。
    const retry = settleService.settleThenRolloverRushSeason(FAIL_EVENT, "test-retry");
    assert.equal(retry.settled, true, retry.reason);
    assert.equal(retry.blocked, false);
    assert.equal(retry.season, 2);
    assert.equal(mailCount() - mailsBefore, 1);
});

// ---------------------------------------------------------------------------
// 指纹兜底:第 1 关当场收口,其余关次交给调度器
//
// 20260828 三轮复核推翻的旧口径是「玩家请求里一律只挂待办」:触发检测的**那一程**
// 正是在这个请求里出生的,它会被开在旧期上,再被 30 秒后那次换期的 abandonActiveRuns
// 连根拔掉 —— 玩家白爬一整座 30 层塔,榜上一行都不留,而且没有任何提示。
// ---------------------------------------------------------------------------

test("指纹漂移:第 1 关当场结算+换期,这一程出生在新一期里(不会被 30 秒后的换期作废)", () => {
    const DRIFT_EVENT = 700015;
    const folderId = leaderboardService.getRushTowerFolderIdSync(DRIFT_EVENT)!;
    const totalRounds = leaderboardService.getRushFolderTotalRoundsSync(DRIFT_EVENT, folderId);
    makePlayer(441, "漂移甲");
    makePlayer(442, "漂移乙");

    // 第 1 期真有一条成绩 —— 这样「先结算」才有东西可结,能验到「奖没丢」。
    seedRunOn(DRIFT_EVENT, folderId, 442, 1, 88_000, 5_000_002, totalRounds);
    configureRewards(DRIFT_EVENT, folderId);
    const mailsBefore = mailCount();
    // 台账里写一个**对不上**的指纹 = 塔在服务端看得见的那一层被改过。
    domain.rushLeaderboardStore.putSeason({
        eventId: DRIFT_EVENT, season: 1, startedAtMs: 0, fingerprint: "1:999", source: "test",
    });
    assert.equal(leaderboardService.isRushSeasonFingerprintStaleSync(DRIFT_EVENT), true);

    // 玩家开第 1 关:当场「结算第 1 期 → 换到第 2 期 → 再开 run」。
    leaderboardService.noteRushRoundStart({
        playerId: 441, eventId: DRIFT_EVENT, folderId, round: 1,
    });

    assert.equal(domain.rushLeaderboardStore.getSeason(DRIFT_EVENT)?.season, 2,
        "第 1 关必须当场收口 —— 只挂待办的话这一程会开在旧期上,几十秒后被作废");
    assert.equal(leaderboardService.isRushSeasonFingerprintStaleSync(DRIFT_EVENT), false);
    assert.equal(leaderboardService.peekPendingRushSeasonRollovers().includes(DRIFT_EVENT), false,
        "当场做完了就不该再留待办");
    assert.equal(settleStore.getSeasonResultsSync(DRIFT_EVENT, folderId, 1, "full-run").length, 1,
        "第 1 期的名次冻结了 —— 换期之前先结算这条铁律没被绕过去");
    assert.equal(mailCount() - mailsBefore, 1, "第 1 期的奖照发");

    const born = domain.rushLeaderboardStore.getActiveRun(441, DRIFT_EVENT, folderId);
    assert.ok(born !== null, "这一程照常开");
    assert.equal(born!.season, 2, "而且出生在**新**一期里");
    assert.equal(born!.trackedFromRound, 1, "从第 1 关起完整跟踪 —— 否则永远不进战斗用时榜");

    // 调度器那一 tick(30 秒后):没有待办、指纹也对上了 ⇒ 什么都不做。
    // 这条断言就是这次回归的靶心:旧实现在这里把 born 那一程作废了。
    assert.deepEqual(settleService.drainPendingRushSeasonRollovers(), []);
    assert.equal(
        domain.rushLeaderboardStore.getActiveRun(441, DRIFT_EVENT, folderId)?.id, born!.id,
        "⚠ 这一程必须还活着 —— 旧实现在这里把它连根拔掉,玩家白爬一整座塔");

    // 脏待办(指纹其实已经对上了)不许造出一次假换期。
    leaderboardService.markRushSeasonRolloverPending(DRIFT_EVENT);
    assert.deepEqual(settleService.drainPendingRushSeasonRollovers(), []);
    assert.equal(domain.rushLeaderboardStore.getSeason(DRIFT_EVENT)?.season, 2);
});

test("指纹漂移:第 2 关及以后只挂待办,由调度器补上", () => {
    // 那种 run 本来就已经因为塔的轮数变了而注定作废(planRunStart 的 tower-resized),
    // 不值得在别人爬到一半时做一次结算。
    const LATE_EVENT = 700017;
    const folderId = leaderboardService.getRushTowerFolderIdSync(LATE_EVENT)!;
    makePlayer(443, "漂移丙");

    domain.rushLeaderboardStore.putSeason({
        eventId: LATE_EVENT, season: 1, startedAtMs: 0, fingerprint: "1:999", source: "test",
    });

    leaderboardService.noteRushRoundStart({
        playerId: 443, eventId: LATE_EVENT, folderId, round: 2,
    });

    assert.equal(domain.rushLeaderboardStore.getSeason(LATE_EVENT)?.season, 1,
        "不在爬塔中途做结算");
    assert.ok(leaderboardService.peekPendingRushSeasonRollovers().includes(LATE_EVENT),
        "但必须挂上待办,否则这次漂移就永远没人管了");

    const drained = settleService.drainPendingRushSeasonRollovers();
    assert.equal(drained.length, 1);
    assert.equal(drained[0].blocked, false);
    assert.equal(leaderboardService.isRushSeasonFingerprintStaleSync(LATE_EVENT), false,
        "换期/复用时写的都是**现在算出来的**指纹,否则下一 tick 会再来一次");
});

// ---------------------------------------------------------------------------
// 「当轮首通榜」发奖也要收在当期
// ---------------------------------------------------------------------------

test("reward_board=season-first:发奖名单按当期过滤,快照仍抄整张跨期榜", () => {
    const SEASON_FIRST_EVENT = 700017;   // 另一个真实事件,免得和上面的用例串味
    const folderId = 1;

    makePlayer(411, "旧期人");
    makePlayer(412, "当期人");
    for (const [playerId, season, finished] of
        [[411, 1, 3_000_001], [412, 2, 3_000_002]] as const) {
        const run = domain.rushLeaderboardStore.insertRun({
            playerId, playerName: `存档${playerId}`, eventId: SEASON_FIRST_EVENT, folderId,
            season, startedAtMs: 0, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
        });
        domain.rushLeaderboardStore.updateRun(run.id, {
            status: "completed", finishedAtMs: finished, endedAtMs: finished,
            durationMs: 200_000, battleMs: 200_000, roundsCleared: TOTAL_ROUNDS,
            characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
        });
    }
    domain.rushLeaderboardStore.putSeason({
        eventId: SEASON_FIRST_EVENT, season: 2, startedAtMs: 0, fingerprint: "x", source: "test",
    });

    const cfg = settleStore.getRushSettlementConfigSync(SEASON_FIRST_EVENT, folderId, Date.now());
    settleStore.putRushSettlementConfigSync({
        ...cfg,
        rewardBoard: "season-first",
        rewardTiers: [{ fromRank: 1, toRank: 10, itemId: 2370099, count: 1 }],
        updatedAtMs: Date.now(),
    });

    const outcome = settleService.settleRushSeasonNow(SEASON_FIRST_EVENT, folderId, "test");
    assert.equal(outcome.ok, true, outcome.reason);
    assert.equal(outcome.mailCount, 1,
        "「当轮首通榜」是跨期历史册(刻意不按期过滤),照它发奖会把已经结算过的旧期"
        + "成绩再发一次 —— 发奖名单必须再收窄到当期");

    const frozen = settleStore.getSeasonResultsSync(SEASON_FIRST_EVENT, folderId, 2, "season-first");
    assert.deepEqual(frozen.map(row => row.playerId), [412, 411],
        "快照仍抄整张跨期榜(ORDER BY season DESC),只有发奖名单收窄");
    const rewarded = frozen.filter(row => row.mailId !== null).map(row => row.playerId);
    assert.deepEqual(rewarded, [412], "旧期那一行进了快照但拿不到邮件");
});

// ---------------------------------------------------------------------------
// 榜行渲染的批量取数(端点整体不随行数线性增长)
// ---------------------------------------------------------------------------

test("getPlayersRankPointsSync:一次取一批,查不到的存档不出现在结果里", () => {
    makePlayer(421, "甲", 1_000);
    makePlayer(422, "乙", 2_000);

    const points = playerDomain.getPlayersRankPointsSync([421, 422, 422, 999_999, -1, NaN]);
    assert.equal(points.get(421), 1_000);
    assert.equal(points.get(422), 2_000);
    assert.equal(points.has(999_999), false, "查不到的存档不进结果 —— 调用方据此退回逐行现查");
    assert.equal(points.size, 2, "重复 id 和非法 id 都被过滤掉了");
    assert.equal(playerDomain.getPlayersRankPointsSync([]).size, 0);
});

test("toNewsRow:给了 prefetched 就一次数据库都不碰", () => {
    const record: RushRunRecord = {
        id: 1, playerId: 421, playerName: "甲", displayName: "甲", playerExists: true,
        eventId: EVENT_ID, folderId: FOLDER_ID, season: 1, status: "completed",
        startedAtMs: 0, finishedAtMs: 1, endedAtMs: 1, durationMs: 1_000, battleMs: 1_000,
        roundsCleared: TOTAL_ROUNDS, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
        fullRun: true, characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
    };

    const live = newsLib.toNewsRow(record, 1, null);
    const prefetched = newsLib.toNewsRow(record, 1, null, { rankPoint: 1_000 });
    assert.equal(prefetched.userRank, live.userRank,
        "预取路径和现查路径必须给出同一个 RANK —— 不同就说明批查询取错了列");

    // 存档号故意指向一个**不存在**的行:现查会退回 RANK1,预取则照样算出真值。
    // 这就是「一次数据库都不碰」的判据。
    const orphan: RushRunRecord = { ...record, playerId: 999_998 };
    assert.equal(newsLib.toNewsRow(orphan, 1, null).userRank, 1);
    assert.equal(newsLib.toNewsRow(orphan, 1, null, { rankPoint: 1_000 }).userRank, live.userRank);
});

test("rankPointFacet:取不到就返回 undefined(单行退化,不是整屏退化)", () => {
    const record = { playerId: 421 } as RushRunRecord;
    const missing = { playerId: 999_997 } as RushRunRecord;
    const points = new Map<number, number>([[421, 1_000]]);

    assert.deepEqual(newsLib.rankPointFacet(points, record), { rankPoint: 1_000 });
    assert.equal(newsLib.rankPointFacet(points, missing), undefined);
});

test("newsRowRankPoints:只查活着的存档,坏库退回空表而不是抛", () => {
    const alive = { playerId: 421, playerExists: true } as RushRunRecord;
    const deleted = { playerId: 999_996, playerExists: false } as RushRunRecord;

    const points = newsLib.newsRowRankPoints([alive, deleted]);
    assert.equal(points.get(421), 1_000);
    assert.equal(points.has(999_996), false, "已删存档不进批查询 —— 它本来就没有 rank_point");
});

// ---------------------------------------------------------------------------
// 重摇在途标记:服务端在重摇窗口里重启,换期不许静默丢掉
// ---------------------------------------------------------------------------

test("重摇在途标记:落 → 取(读一次即删)→ 启动告警", () => {
    // 换期挂在重摇子进程的 exit 事件上,服务端在那几十秒里退出就永远收不到 ——
    // 塔换了、榜留在旧期,而指纹兜底看不见(重摇不改轮数,fingerprint 恒为 1:30)。
    const inflight =
        require("../lib/rogue-reroll-inflight") as typeof import("../lib/rogue-reroll-inflight");
    // 标记必须落在 WF_DATABASE_DIR 里 —— 写死 .database 的话,跑一次测试就会
    // 往作者的真实工作目录里落文件。
    const markerFile = path.join(databaseDir, "rogue-reroll-inflight.json");

    assert.equal(inflight.takeRogueRerollMarker(), null, "没重摇过就没有标记");

    inflight.markRogueRerollInFlight(700099, 1_700_000_000_000);
    assert.equal(require("node:fs").existsSync(markerFile), true, markerFile);
    assert.deepEqual(inflight.takeRogueRerollMarker(),
        { eventId: 700099, startedAtMs: 1_700_000_000_000 });
    assert.equal(inflight.takeRogueRerollMarker(), null,
        "读一次即删:这条告警是一次性的,留着会每次启动都喊一遍");

    // 子进程正常退出那条路:标记清掉,下次启动不该再喊。
    inflight.markRogueRerollInFlight(700099);
    inflight.clearRogueRerollInFlight();
    assert.equal(inflight.takeRogueRerollMarker(), null);

    // 启动检查:有残留就喊(而且**不自动换期** —— 那一刻无从判断塔换没换)。
    inflight.markRogueRerollInFlight(700099);
    const seasonBefore = domain.rushLeaderboardStore.getSeason(700099)?.season ?? null;
    const errors: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
    try {
        inflight.warnOnStaleRogueReroll();
    } finally {
        console.error = realError;
    }
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0]!, /结算并开启新一期/, "告警必须给出补救动作,否则喊了也没用");
    assert.equal(domain.rushLeaderboardStore.getSeason(700099)?.season ?? null, seasonBefore,
        "启动告警不许自己换期:换期不可逆,而这一刻判断不了塔到底换没换");
    assert.equal(inflight.takeRogueRerollMarker(), null, "喊过就清掉");
});
