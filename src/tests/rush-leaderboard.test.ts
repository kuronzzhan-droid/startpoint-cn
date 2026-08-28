import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import SqliteDatabase from "better-sqlite3";
import initWdfpData from "../data/initializers/wdfpData";

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-rush-leaderboard-"));
process.env.WF_DATABASE_DIR = databaseDir;

const {
    computeRushSeasonFingerprint,
    ensureRushSeason,
    isFullRunRecord,
    planRoundFinish,
    planRunStart,
    reanchorRushSeason,
    rolloverRushSeason,
} = require("../lib/rush-leaderboard") as typeof import("../lib/rush-leaderboard");

import type {
    NewRushRun,
    RushLeaderboardStore,
    RushRun,
    RushRunPatch,
    RushSeason,
} from "../lib/rush-leaderboard";

const EVENT_ID = 700099;
const FOLDER_ID = 1;
const TOTAL_ROUNDS = 30;

/** RushLeaderboardStore 的内存实现,用来在不碰 SQLite 的情况下验规则。 */
class MemoryStore implements RushLeaderboardStore {
    runs: RushRun[] = [];
    seasons = new Map<number, RushSeason>();
    private nextId = 1;

    getActiveRun(playerId: number, eventId: number, folderId: number): RushRun | null {
        return this.runs.find(run => run.playerId === playerId && run.eventId === eventId
            && run.folderId === folderId && run.status === "active") ?? null;
    }

    insertRun(run: NewRushRun): RushRun {
        const created: RushRun = {
            id: this.nextId++,
            playerId: run.playerId,
            playerName: run.playerName,
            eventId: run.eventId,
            folderId: run.folderId,
            season: run.season,
            status: "active",
            startedAtMs: run.startedAtMs,
            finishedAtMs: null,
            endedAtMs: null,
            durationMs: null,
            battleMs: 0,
            roundsCleared: Math.max(0, run.trackedFromRound - 1),
            totalRounds: run.totalRounds,
            trackedFromRound: run.trackedFromRound,
            characterIds: [null, null, null],
            unisonCharacterIds: [null, null, null],
        };
        this.runs.push(created);
        return created;
    }

    updateRun(runId: number, patch: RushRunPatch): void {
        const run = this.runs.find(candidate => candidate.id === runId);
        if (run === undefined) throw new Error(`no run ${runId}`);
        Object.assign(run, patch);
    }

    getSeason(eventId: number): RushSeason | null {
        return this.seasons.get(eventId) ?? null;
    }

    putSeason(season: RushSeason): void {
        this.seasons.set(season.eventId, season);
    }

    abandonActiveRuns(eventId: number, endedAtMs: number, folderId?: number): number {
        let changed = 0;
        for (const run of this.runs) {
            if (run.eventId !== eventId || run.status !== "active") continue;
            if (folderId !== undefined && run.folderId !== folderId) continue;
            run.status = "abandoned";
            run.endedAtMs = endedAtMs;
            changed += 1;
        }
        return changed;
    }
}

function startContext(round: number, overrides: Partial<Parameters<typeof planRunStart>[1]> = {}) {
    return {
        playerId: 1,
        playerName: "作者",
        eventId: EVENT_ID,
        folderId: FOLDER_ID,
        round,
        totalRounds: TOTAL_ROUNDS,
        season: 1,
        nowMs: 1_000,
        ...overrides,
    };
}

/** 走一整程:第 1 关起跑,逐关打赢,最终关收榜。 */
function playFullRun(store: MemoryStore, options: {
    playerId?: number
    season?: number
    startMs?: number
    perRoundMs?: number
    gapMs?: number
} = {}): RushRun {
    const playerId = options.playerId ?? 1;
    const season = options.season ?? 1;
    const perRoundMs = options.perRoundMs ?? 30_000;
    const gapMs = options.gapMs ?? 5_000;
    let clock = options.startMs ?? 1_000;

    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
        const plan = planRunStart(store.getActiveRun(playerId, EVENT_ID, FOLDER_ID),
            startContext(round, { playerId, season, nowMs: clock }));
        if (plan.abandonRunId !== null) store.updateRun(plan.abandonRunId, { status: "abandoned", endedAtMs: clock });
        if (plan.open !== null) store.insertRun(plan.open);

        clock += perRoundMs;
        const finish = planRoundFinish(store.getActiveRun(playerId, EVENT_ID, FOLDER_ID), {
            round,
            totalRounds: TOTAL_ROUNDS,
            accomplished: true,
            elapsedMs: perRoundMs,
            nowMs: clock,
            characterIds: [101, 102, 103],
            unisonCharacterIds: [null, null, null],
        });
        assert.notEqual(finish, null);
        store.updateRun(finish!.runId, finish!.patch);
        clock += gapMs;
    }

    const completed = store.runs.filter(run => run.playerId === playerId && run.status === "completed");
    return completed[completed.length - 1]!;
}

test("第 1 关开一条新 run,后续关沿用同一条", () => {
    const store = new MemoryStore();

    const first = planRunStart(null, startContext(1));
    assert.equal(first.reason, "restart");
    assert.equal(first.abandonRunId, null);
    assert.equal(first.open?.trackedFromRound, 1);
    const run = store.insertRun(first.open!);

    const second = planRunStart(run, startContext(2, { nowMs: 60_000 }));
    assert.equal(second.reason, "continue");
    assert.equal(second.open, null);
    assert.equal(second.abandonRunId, null);
});

test("中途从第 1 关重开:旧 run 作废,新 run 从头计时", () => {
    const store = new MemoryStore();
    const run = store.insertRun(planRunStart(null, startContext(1)).open!);
    store.updateRun(run.id, { roundsCleared: 7, battleMs: 210_000 });

    const restart = planRunStart(store.getActiveRun(1, EVENT_ID, FOLDER_ID), startContext(1, { nowMs: 900_000 }));
    assert.equal(restart.reason, "restart");
    assert.equal(restart.abandonRunId, run.id);
    assert.equal(restart.open?.startedAtMs, 900_000);
    assert.equal(restart.open?.trackedFromRound, 1);
});

test("没有在跟踪时中途进关:接管但标为不完整计时,不进全程榜", () => {
    const store = new MemoryStore();
    const plan = planRunStart(null, startContext(12));
    assert.equal(plan.reason, "adopt");
    assert.equal(plan.open?.trackedFromRound, 12);

    const run = store.insertRun(plan.open!);
    assert.equal(run.roundsCleared, 11, "接管时把已过的关算进进度");

    const finish = planRoundFinish(run, {
        round: TOTAL_ROUNDS,
        totalRounds: TOTAL_ROUNDS,
        accomplished: true,
        elapsedMs: 20_000,
        nowMs: 500_000,
        characterIds: [1, 2, 3],
        unisonCharacterIds: [null, null, null],
    });
    store.updateRun(finish!.runId, finish!.patch);

    const completed = store.runs[0]!;
    assert.equal(completed.status, "completed");
    assert.equal(isFullRunRecord(completed), false, "半途接管的成绩不算完整一程");
});

test("换期后旧 run 作废;塔长度变了也作废", () => {
    const store = new MemoryStore();
    const run = store.insertRun(planRunStart(null, startContext(1)).open!);

    const seasonChanged = planRunStart(run, startContext(5, { season: 2 }));
    assert.equal(seasonChanged.reason, "season-changed");
    assert.equal(seasonChanged.abandonRunId, run.id);

    const resized = planRunStart(run, startContext(5, { totalRounds: 15 }));
    assert.equal(resized.reason, "tower-resized");
    assert.equal(resized.abandonRunId, run.id);
});

test("失败一关不推进进度、不计净战斗时间,墙钟照走", () => {
    const store = new MemoryStore();
    const run = store.insertRun(planRunStart(null, startContext(1)).open!);
    store.updateRun(run.id, { roundsCleared: 3, battleMs: 90_000 });

    const failed = planRoundFinish(store.getActiveRun(1, EVENT_ID, FOLDER_ID), {
        round: 4,
        totalRounds: TOTAL_ROUNDS,
        accomplished: false,
        elapsedMs: 44_000,
        nowMs: 400_000,
        characterIds: [1, 2, 3],
        unisonCharacterIds: [null, null, null],
    });
    assert.equal(failed, null);
    assert.equal(store.runs[0]!.roundsCleared, 3);
    assert.equal(store.runs[0]!.battleMs, 90_000);
});

test("最终关结算:成绩(battleMs)=各关之和,墙钟(durationMs)照常继续记", () => {
    const store = new MemoryStore();
    const run = playFullRun(store, { startMs: 10_000, perRoundMs: 30_000, gapMs: 5_000 });

    assert.equal(run.status, "completed");
    assert.equal(run.roundsCleared, TOTAL_ROUNDS);
    assert.equal(run.battleMs, TOTAL_ROUNDS * 30_000, "榜上的成绩只累计战斗本身");
    // 起跑 10_000;每关 30s 战斗 + 5s 关间,最后一关结算时还没走关间隙
    const expected = TOTAL_ROUNDS * 30_000 + (TOTAL_ROUNDS - 1) * 5_000;
    assert.equal(run.durationMs, expected, "墙钟含关间整备时间,继续记、但不再参与排序");
    assert.ok(run.durationMs! > run.battleMs, "墙钟必然长于战斗用时");
    assert.equal(isFullRunRecord(run), true);
    // battle_ms 是 NOT NULL DEFAULT 0:0 = 客户端一关都没报出有效计时。
    // 少了这道闸它会渲染成 00:00.00,排在所有真成绩之前。
    assert.equal(isFullRunRecord({ ...run, battleMs: 0 }), false,
        "battle_ms=0 不算完整一程");
});

test("时钟被往回拨也不会写出负数用时", () => {
    const store = new MemoryStore();
    const run = store.insertRun(planRunStart(null, startContext(1, { nowMs: 900_000 })).open!);
    const finish = planRoundFinish(run, {
        round: TOTAL_ROUNDS,
        totalRounds: TOTAL_ROUNDS,
        accomplished: true,
        elapsedMs: 1_000,
        nowMs: 100_000,
        characterIds: [1, 2, 3],
        unisonCharacterIds: [null, null, null],
    });
    assert.equal(finish!.patch.durationMs, 0);
});

// ⚠ 这一条说的是「塔**没**被重造」的那半边:重摇钩子关着,或者钩子在 120 秒冷却里
// 根本没拉起子进程。本机 .env 开着 WF_ROGUE_REROLL_ON_RESET,所以游戏里正常按一次
// 整段重置是**换塔换期**(见 routes/api/rushEvent.ts 里的裁定),别拿这条去反推。
test("整段重置但塔没被重造(钩子关着/冷却中):期号不变,历史成绩都留着", () => {
    const store = new MemoryStore();
    ensureRushSeason(store, EVENT_ID, "1:30", 0);

    const first = playFullRun(store, { startMs: 0, perRoundMs: 40_000 });
    // 整段重置:作废进行中的 run(此刻没有),期号不动
    store.abandonActiveRuns(EVENT_ID, 5_000_000, FOLDER_ID);
    assert.equal(store.getSeason(EVENT_ID)!.season, 1);

    const second = playFullRun(store, { startMs: 6_000_000, perRoundMs: 20_000 });
    assert.equal(store.runs.filter(run => run.status === "completed").length, 2, "历史成绩都记");
    assert.equal(first.season, second.season, "同一座塔上的两次挑战属于同一期");
    assert.ok(second.durationMs! < first.durationMs!);
});

test("塔被重造 = 换期,进行中的 run 一并作废", () => {
    const store = new MemoryStore();
    ensureRushSeason(store, EVENT_ID, "1:30", 0);
    const running = store.insertRun(planRunStart(null, startContext(1)).open!);

    const rolled = rolloverRushSeason(store, EVENT_ID, "1:30", 7_000, "reroll-hook");
    assert.equal(rolled.season, 2);
    assert.equal(rolled.source, "reroll-hook");
    assert.equal(store.runs.find(run => run.id === running.id)!.status, "abandoned");
});

test("reanchorRushSeason:期号不动,但指纹重锚 + 进行中的 run 照样作废", () => {
    // 「这一期还没人打过」时换塔走这条:空期 +1 只会在台账里留下一段没人打过的
    // 空榜,而期号推进不可逆。但它不是「什么都不做」——
    //   · 指纹要重锚,否则指纹兜底会一直认为塔没收口,来一个人触发一次结算;
    //   · run 要作废,因为「空期」的判据是**榜上**没成绩,而 run 打完才上榜。
    const store = new MemoryStore();
    ensureRushSeason(store, EVENT_ID, "1:30", 0);
    const running = store.insertRun(planRunStart(null, startContext(1)).open!);

    const reanchored = reanchorRushSeason(store, EVENT_ID, "1:15", 9_000, "reroll-hook");

    assert.equal(reanchored!.season, 1, "期号一格没动");
    assert.equal(reanchored!.fingerprint, "1:15");
    assert.equal(reanchored!.startedAtMs, 9_000);
    assert.equal(store.getSeason(EVENT_ID)!.fingerprint, "1:15");
    assert.equal(store.runs.find(run => run.id === running.id)!.status, "abandoned");

    // 台账里压根没有这个事件时没有可复用的期 —— 返回 null 让调用方喊出来,
    // 而不是默默造一期出来。
    assert.equal(reanchorRushSeason(new MemoryStore(), EVENT_ID, "1:30", 1, "x"), null);
});

test("轮数指纹变了只报告、不就地换期;没变则维持原期", () => {
    const store = new MemoryStore();
    const created = ensureRushSeason(store, EVENT_ID, "1:30", 0);
    assert.equal(created.season.season, 1);
    assert.equal(created.staleFingerprint, false);

    const same = ensureRushSeason(store, EVENT_ID, "1:30", 100);
    assert.equal(same.season.season, 1, "同一座塔不换期");
    assert.equal(same.staleFingerprint, false);

    // 20260828 语义变更:指纹兜底**不再自己换期**,只报告。
    // 换期之前必须先结算,一旦这个纯函数悄悄推走期号,上一期的名次冻结和奖励邮件
    // 就永远补不回来。真正动手的是调用方 `noteRushRoundStart`:第 1 关当场
    // 「结算 + 换期」再开 run(不那么做的话这一程会开在旧期上、几十秒后被作废),
    // 第 2 关及以后挂待办交给结算调度器。见 rush-season-scope.test.ts。
    const drifted = ensureRushSeason(store, EVENT_ID, "1:15", 200);
    assert.equal(drifted.season.season, 1, "期号一格没动");
    assert.equal(drifted.staleFingerprint, true, "但必须报出来,否则没人知道塔变了");
    assert.equal(store.getSeason(EVENT_ID)!.fingerprint, "1:30",
        "台账里还是旧指纹 ⇒ 待办丢了也自愈:下一个开第 1 关的人会再报一次");
    assert.equal(store.runs.filter(run => run.status === "abandoned").length, 0,
        "更不许顺手作废进行中的 run —— 那等于把玩家正在打的一程当场作废");
});

test("指纹只认 folder→轮数,顺序无关", () => {
    assert.equal(computeRushSeasonFingerprint({ 1: 30, 2: 0 }), "1:30,2:0");
    assert.equal(computeRushSeasonFingerprint({ 2: 0, 1: 30 }), "1:30,2:0");
    assert.notEqual(computeRushSeasonFingerprint({ 1: 30 }), computeRushSeasonFingerprint({ 1: 15 }));
});

// ---------------------------------------------------------------------------
// SQLite 落地层:验建表、唯一活动索引、两张榜的排序 SQL
// ---------------------------------------------------------------------------

const {
    abandonPlayerRushRunSync,
    getRushFullRunLeaderboardSync,
    getRushLeaderboardEventKeysSync,
    getRushLeaderboardStatsSync,
    getRushPlayerFullRunsSync,
    getRushRunsSync,
    getRushSeasonFirstClearLeaderboardSync,
    rushLeaderboardStore,
} = require("../data/domains/rushLeaderboard") as typeof import("../data/domains/rushLeaderboard");

const DB_EVENT_ID = 700098;

function insertCompletedRun(options: {
    playerId: number
    season: number
    durationMs: number
    /** 不给就按 0.8 派生;要验口径切换的用例**必须**显式传。 */
    battleMs?: number
    finishedAtMs: number
    trackedFromRound?: number
}): void {
    const run = rushLeaderboardStore.insertRun({
        playerId: options.playerId,
        playerName: `存档${options.playerId}`,
        eventId: DB_EVENT_ID,
        folderId: FOLDER_ID,
        season: options.season,
        startedAtMs: options.finishedAtMs - options.durationMs,
        totalRounds: TOTAL_ROUNDS,
        trackedFromRound: options.trackedFromRound ?? 1,
    });
    rushLeaderboardStore.updateRun(run.id, {
        status: "completed",
        finishedAtMs: options.finishedAtMs,
        endedAtMs: options.finishedAtMs,
        durationMs: options.durationMs,
        // 默认仍按 0.8 派生,但**必须可以单独指定** —— 等比派生是单调变换,
        // ORDER BY duration_ms 和 ORDER BY battle_ms 会给出完全相同的名次,
        // 整套排序/去重断言对本次口径切换是瞎的。
        battleMs: options.battleMs ?? Math.floor(options.durationMs * 0.8),
        roundsCleared: TOTAL_ROUNDS,
        characterIds: [101, 102, 103],
        unisonCharacterIds: [null, null, null],
    });
}

test("sqlite: 每个存档同时只允许一条进行中的 run", () => {
    const first = rushLeaderboardStore.insertRun({
        playerId: 42, playerName: "作者", eventId: DB_EVENT_ID, folderId: 9,
        season: 1, startedAtMs: 1_000, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
    });
    const second = rushLeaderboardStore.insertRun({
        playerId: 42, playerName: "作者", eventId: DB_EVENT_ID, folderId: 9,
        season: 1, startedAtMs: 2_000, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
    });

    const active = rushLeaderboardStore.getActiveRun(42, DB_EVENT_ID, 9);
    assert.equal(active?.id, second.id, "插新 run 会自动收掉上一条 active");
    assert.notEqual(first.id, second.id);

    assert.equal(abandonPlayerRushRunSync(42, DB_EVENT_ID, 9, 3_000), 1);
    assert.equal(rushLeaderboardStore.getActiveRun(42, DB_EVENT_ID, 9), null);
});

test("sqlite: 战斗用时榜按 battle_ms 升序,且排除半途接管的成绩", () => {
    insertCompletedRun({ playerId: 1, season: 1, durationMs: 900_000, finishedAtMs: 10_000_000 });
    insertCompletedRun({ playerId: 1, season: 1, durationMs: 700_000, finishedAtMs: 20_000_000 });
    insertCompletedRun({ playerId: 2, season: 2, durationMs: 800_000, finishedAtMs: 30_000_000 });
    insertCompletedRun({ playerId: 2, season: 2, durationMs: 10_000, finishedAtMs: 40_000_000, trackedFromRound: 20 });
    // 同一期里的第二个存档 —— 首通榜必须两个都留,按期分组不能把它吞掉
    insertCompletedRun({ playerId: 3, season: 1, durationMs: 950_000, finishedAtMs: 15_000_000 });
    // 反例:墙钟最长但战斗最短 —— 两种口径给出相反的名次,
    // 把 ORDER BY 改回 duration_ms 这条会立刻红。
    insertCompletedRun({ playerId: 4, season: 1, durationMs: 1_200_000, battleMs: 100_000,
        finishedAtMs: 50_000_000 });

    const board = getRushFullRunLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50);
    assert.deepEqual(board.map(row => row.battleMs), [100_000, 560_000, 640_000, 760_000],
        "按 battle_ms 升序;墙钟最长的那一程排第一");
    assert.equal(board[0]!.playerId, 4, "排序键是 battle_ms,不是墙钟");
    assert.ok(board.every(row => row.fullRun), "半途接管的 10 秒不该混进战斗用时榜");
    // 存档行不存在(测试库里没建 players),回落到成绩快照名
    assert.equal(board[1]!.displayName, "存档1");
    assert.equal(board[1]!.playerExists, false);
});

test("sqlite: 战斗用时榜按存档去重 —— 一位玩家只留 battle_ms 最短那一程(作者裁定 20260828)", () => {
    // 同一存档两程,两种口径给出相反的答案:A 墙钟更短、B 战斗更短。
    // 去重必须留 B —— 只改外层 ORDER BY 而漏改窗口函数里的排序键时,留下的会是 A。
    insertCompletedRun({ playerId: 5, season: 1, durationMs: 300_000, battleMs: 900_000,
        finishedAtMs: 60_000_000 });
    insertCompletedRun({ playerId: 5, season: 1, durationMs: 1_000_000, battleMs: 200_000,
        finishedAtMs: 70_000_000 });

    const board = getRushFullRunLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50);
    const playerIds = board.map(row => row.playerId);
    assert.deepEqual(playerIds, [4, 5, 1, 2, 3], "名次表里不许出现同一个存档两次");
    assert.equal(new Set(playerIds).size, playerIds.length);
    // 存档 1 有 900 000 和 700 000 两程(battle 720 000 / 560 000),榜上只剩快的那一程
    assert.equal(board.find(row => row.playerId === 1)!.battleMs, 560_000);
    assert.ok(!board.some(row => row.battleMs === 720_000), "被去重吃掉的慢成绩不该在榜上");
    // 存档 5:留下的必须是 battle 更短的 B 程,而不是墙钟更短的 A 程
    assert.equal(board.find(row => row.playerId === 5)!.battleMs, 200_000);
    assert.equal(board.find(row => row.playerId === 5)!.durationMs, 1_000_000,
        "留下的是 battle 最短那一程,它的墙钟反而是这个存档里最长的");
});

test("sqlite: 去重只影响榜,存档自己的全部成绩仍查得到(破纪录特效靠它)", () => {
    const mine = getRushPlayerFullRunsSync(DB_EVENT_ID, FOLDER_ID, 1);
    assert.deepEqual(mine.map(row => row.battleMs), [560_000, 720_000],
        "该存档的两程都要在,且按 battle_ms 升序");
    const other = getRushPlayerFullRunsSync(DB_EVENT_ID, FOLDER_ID, 2);
    assert.deepEqual(other.map(row => row.battleMs), [640_000],
        "半途接管的成绩不算完整成绩");
    // rush-endless-card.ts 的 bestBattleMs 不自己算 min,靠这条 SQL 的 ORDER BY
    // 「取第一条即最佳」—— 首行必须是 battle 最短那一程,不是墙钟最短那一程。
    const swapped = getRushPlayerFullRunsSync(DB_EVENT_ID, FOLDER_ID, 5);
    assert.deepEqual(swapped.map(row => row.battleMs), [200_000, 900_000]);
    assert.equal(swapped[0]!.durationMs, 1_000_000, "首行是 battle 最短那一程");
});

test("sqlite: 当轮首通榜每期每存档只取第一次通关,按期号倒序", () => {
    const board = getRushSeasonFirstClearLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50);

    assert.deepEqual(board.map(row => [row.season, row.playerId, row.finishedAtMs]), [
        [2, 2, 30_000_000],
        [1, 1, 10_000_000],
        [1, 3, 15_000_000],
        [1, 4, 50_000_000],
        [1, 5, 60_000_000],
    ], "第 2 期在前;每期每存档只留最早那次,同期多存档都要在");
    // 首通榜排的是「谁先通关」,时间长度不是它的排序键 —— 换口径不该动它一行。
    assert.equal(board.find(row => row.playerId === 5)!.durationMs, 300_000,
        "首通榜留的是最早那一程(墙钟 300 000),不是 battle 最短那一程");
});

test("sqlite: battle_ms<=0 与半途接管的行进不了战斗用时榜,但首通榜照收", () => {
    // ① battle_ms = 0:列是 NOT NULL DEFAULT 0,0 的意思是「客户端一关都没报出
    //    有效时间」而不是「0 秒通关」。写成 `battle_ms IS NOT NULL` 会恒真,
    //    这条行就会以 00:00.00 排在所有真成绩之前。
    insertCompletedRun({ playerId: 6, season: 1, durationMs: 500_000, battleMs: 0,
        finishedAtMs: 80_000_000 });
    // ② 半途接管:battle_ms 只是接管之后那几关的部分和,不能当成绩比。
    insertCompletedRun({ playerId: 7, season: 4, durationMs: 400_000, battleMs: 50_000,
        finishedAtMs: 90_000_000, trackedFromRound: 20 });

    const board = getRushFullRunLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50);
    assert.ok(board.every(row => row.battleMs > 0), "0 会渲染成 00:00.00 霸榜首");
    assert.ok(!board.some(row => row.playerId === 6), "battle_ms=0 不进榜");
    assert.ok(!board.some(row => row.playerId === 7), "半途接管的部分和不进榜");
    assert.deepEqual(getRushPlayerFullRunsSync(DB_EVENT_ID, FOLDER_ID, 6), [],
        "个人全量成绩也要挡住它 —— 记录卡的「历史最佳」直接取它的第一行");

    // 首通榜排的是「谁先通关」,不过滤 tracked_from_round —— 这两行必须还在,
    // 它们只是 fullRun=false,时间列由展示层发 --:--.-- 哨兵。
    const first = getRushSeasonFirstClearLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50);
    const adopted = first.find(row => row.playerId === 7);
    assert.ok(adopted, "半途接管的成绩不该被首通榜删掉");
    assert.equal(adopted!.fullRun, false);
    assert.equal(first.find(row => row.playerId === 6)!.fullRun, false,
        "battle_ms=0 同样不算完整一程");
});

test("sqlite: 统计与明细可用", () => {
    const stats = getRushLeaderboardStatsSync(DB_EVENT_ID, FOLDER_ID);
    assert.equal(stats.completedRuns, 10);
    assert.equal(stats.fullRuns, 8);
    assert.equal(stats.bestBattleMs, 100_000, "最好成绩 = 最小的 battle_ms,不是最小的墙钟");
    // 8 条「完整」成绩里,存档 6 那条 battle_ms=0 是废行(MIN 会忽略 NULL 但不会
    // 忽略 0,所以 SQL 里显式写了 battle_ms > 0),剩下 7 条来自 5 个存档
    // ⇒ 去重后榜上 5 行。两个数都要显示,否则作者会以为成绩丢了。
    assert.equal(stats.rankedPlayers, 5);

    const mine = getRushRunsSync(DB_EVENT_ID, FOLDER_ID, { playerId: 1 });
    assert.equal(mine.length, 2);
    assert.ok(mine.every(row => row.playerId === 1));

    const keys = getRushLeaderboardEventKeysSync();
    assert.ok(keys.some(key => key.eventId === DB_EVENT_ID && key.folderId === FOLDER_ID));
});

// ---------------------------------------------------------------------------
// 战斗用时榜按期分桶(作者裁定 2026-08-28 晚:「重 roll 塔 = 新榜」)
// ---------------------------------------------------------------------------

test("sqlite: 传 season 只列当期成绩,不传照旧跨期", () => {
    // 现有种子:第 1 期有存档 1/3/4/5,第 2 期只有存档 2,第 4 期只有那条半途接管的。
    const all = getRushFullRunLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50);
    assert.deepEqual(all.map(row => row.playerId), [4, 5, 1, 2, 3],
        "不传 season = 旧行为(跨期历史最优),后台排查和老调用点都靠它");

    const s1 = getRushFullRunLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50, 1);
    assert.deepEqual(s1.map(row => row.playerId), [4, 5, 1, 3],
        "第 1 期里没有存档 2");
    assert.ok(s1.every(row => row.season === 1));

    const s2 = getRushFullRunLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50, 2);
    assert.deepEqual(s2.map(row => row.playerId), [2]);

    assert.deepEqual(getRushFullRunLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50, 3), [],
        "换到一座没人爬过的新塔 ⇒ 榜是空的,这正是作者要的「新塔新榜」");
});

test("sqlite: 期条件写在窗口函数里 —— 上一期更快不会把这一期的人挤掉", () => {
    // 存档 8:第 1 期 50 000(全表最快),第 2 期 800 000(全表最慢)。
    // 期条件若被挪到外层 WHERE,ROW_NUMBER 会先跨期选中第 1 期那一程,
    // 再被 `season = 2` 筛掉 ⇒ 存档 8 在第 2 期榜上**整行消失**。
    insertCompletedRun({ playerId: 8, season: 1, durationMs: 100_000, battleMs: 50_000,
        finishedAtMs: 100_000_000 });
    insertCompletedRun({ playerId: 8, season: 2, durationMs: 900_000, battleMs: 800_000,
        finishedAtMs: 110_000_000 });

    const s2 = getRushFullRunLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50, 2);
    const mine = s2.find(row => row.playerId === 8);
    assert.ok(mine, "存档 8 必须出现在第 2 期榜上");
    assert.equal(mine!.battleMs, 800_000, "第 2 期算的是他第 2 期那一程,不是历史最优");

    const s1 = getRushFullRunLeaderboardSync(DB_EVENT_ID, FOLDER_ID, 50, 1);
    assert.equal(s1[0]!.playerId, 8, "第 1 期里他仍然是最快的");
    assert.equal(s1[0]!.battleMs, 50_000);
});

// ---------------------------------------------------------------------------
// 客户端排名活动(RankingEvent)界面映射
// ---------------------------------------------------------------------------

const { buildRushBoardRankingSummary, getRushBoardBinding } =
    require("../lib/rush-leaderboard-ranking-event") as typeof import("../lib/rush-leaderboard-ranking-event");

const BOARD_EVENT_ID = 700097;

/** `battleMsOverride` 不给就按 0.8 派生;要验口径切换的用例必须显式传。 */
function seedBoardRun(playerId: number, durationMs: number, finishedAtMs: number,
                      season = 1, battleMsOverride?: number): void {
    const run = rushLeaderboardStore.insertRun({
        playerId, playerName: `存档${playerId}`, eventId: BOARD_EVENT_ID, folderId: FOLDER_ID,
        season, startedAtMs: finishedAtMs - durationMs, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
    });
    rushLeaderboardStore.updateRun(run.id, {
        status: "completed", finishedAtMs, endedAtMs: finishedAtMs, durationMs,
        battleMs: battleMsOverride ?? Math.floor(durationMs * 0.8), roundsCleared: TOTAL_ROUNDS,
        characterIds: [129999, 139999, null], unisonCharacterIds: [null, null, null],
    });
}

test("默认不劫持任何官方排名活动(1000/1001 已还原成试炼)", () => {
    for (const id of [1, 5, 1000, 1001]) {
        assert.equal(getRushBoardBinding(id), null, `活动 ${id} 必须交回官方逻辑`);
    }
});

test("榜上没成绩时摘要仍可生成(界面要能打开)", () => {
    const binding = { eventId: BOARD_EVENT_ID, folderId: FOLDER_ID, board: "full-run" as const, label: "t" };
    const summary = buildRushBoardRankingSummary(binding, 1);

    assert.equal(summary.best_record.is_accomplished, false);
    assert.equal(summary.best_record.elapsed_time_ms, 0);
    assert.equal(summary.rank_border_top, null, "没人上榜就没有榜首门槛");
    assert.equal(summary.rank_percentage, 100, "没上榜=垫底(客户端值域 0~100)");
});

test("摘要:我的最好成绩 + 榜首成绩 + 名次占比", () => {
    seedBoardRun(1, 900_000, 10_000_000);   // 存档1:15分00秒
    seedBoardRun(2, 600_000, 20_000_000);   // 存档2:10分00秒 ← 榜首
    seedBoardRun(3, 1_200_000, 30_000_000); // 存档3:20分00秒 ← 垫底
    const binding = { eventId: BOARD_EVENT_ID, folderId: FOLDER_ID, board: "full-run" as const, label: "t" };

    const mine = buildRushBoardRankingSummary(binding, 1);
    // 界面上的三个数全部改吃 battleMs(夹具按 0.8 派生 => 900 000 * 0.8)
    assert.equal(mine.best_record.elapsed_time_ms, 720_000);
    assert.equal(mine.best_record.is_accomplished, true);
    assert.equal(mine.best_record.score, TOTAL_ROUNDS);
    assert.equal(mine.rank_border_top?.elapsed_time_ms, 480_000, "门槛=榜首的战斗用时");
    assert.equal(mine.rank_percentage, 50, "三条成绩里排第二 => 正中间(0~100)");
    assert.equal(mine.leader_character_id, 129999, "队长取我那一程的首位角色");

    const top = buildRushBoardRankingSummary(binding, 2);
    assert.equal(top.rank_percentage, 0, "榜首占比 0");
    assert.equal(top.rank_border_top?.elapsed_time_ms, 480_000);

    const last = buildRushBoardRankingSummary(binding, 3);
    assert.equal(last.rank_percentage, 100, "垫底占比 100");

    const stranger = buildRushBoardRankingSummary(binding, 999);
    assert.equal(stranger.best_record.is_accomplished, false, "没上榜的存档只看得到榜首");
    assert.equal(stranger.rank_border_top?.elapsed_time_ms, 480_000);
});

test("同一个存档多次通关,摘要取它 battle_ms 最好的一次", () => {
    // 刻意让这一程**墙钟最长**(25 分钟)而**战斗最短**(4 分钟):
    // 摘要要是还按墙钟挑,这条既当不上「我的最好成绩」也当不上榜首。
    seedBoardRun(1, 1_500_000, 40_000_000, 1, 240_000);
    const binding = { eventId: BOARD_EVENT_ID, folderId: FOLDER_ID, board: "full-run" as const, label: "t" };

    const mine = buildRushBoardRankingSummary(binding, 1);
    assert.equal(mine.best_record.elapsed_time_ms, 240_000, "取 battle 最短的一次,不是墙钟最短的一次");
    assert.equal(mine.rank_percentage, 0, "它现在是榜首");
    assert.equal(buildRushBoardRankingSummary(binding, 2).rank_border_top?.elapsed_time_ms, 240_000,
        "榜首门槛跟着换成这条墙钟最长的成绩");
});

test("默认绑定为空时不拦任何关卡;开了绑定才拦榜门面关卡", () => {
    const { isRushBoardRankingQuest } =
        require("../lib/rush-leaderboard-ranking-event") as typeof import("../lib/rush-leaderboard-ranking-event");
    const { QuestCategory } = require("../lib/types") as typeof import("../lib/types");
    const RANKING_EVENT_SINGLE = QuestCategory.RANKING_EVENT_SINGLE;

    // 默认无绑定 => 一个关卡都不拦(官方活动完全不受影响)
    assert.equal(isRushBoardRankingQuest(RANKING_EVENT_SINGLE, 1000001), false);
    assert.equal(isRushBoardRankingQuest(RANKING_EVENT_SINGLE, 1001001), false);
    assert.equal(isRushBoardRankingQuest(RANKING_EVENT_SINGLE, 1001), false, "官方时间挑战关卡不能被误伤");
    assert.equal(isRushBoardRankingQuest(RANKING_EVENT_SINGLE, 5001), false);
    assert.equal(isRushBoardRankingQuest(QuestCategory.MAIN, 1000001), false, "只管排名活动分类");
});

// ---------------------------------------------------------------------------
// kind=2 原生「无尽战斗」记录卡字段(master quest_kind 1→2 之后服务端要补的那组)
// ---------------------------------------------------------------------------

const { buildRushEndlessCardFields, isEndlessCardFolder } =
    require("../lib/rush-endless-card") as typeof import("../lib/rush-endless-card");

const CARD_EVENT = 700099;   // 需显式开启绑定;默认已停用
const CARD_FOLDER = 1;

/** `battleMsOverride` 不给就按 0.8 派生;要验口径切换的用例必须显式传。 */
function completedCardRun(playerId: number, durationMs: number, finishedAtMs: number,
                          battleMsOverride?: number): void {
    const run = rushLeaderboardStore.insertRun({
        playerId, playerName: `存档${playerId}`, eventId: CARD_EVENT, folderId: CARD_FOLDER,
        season: 1, startedAtMs: finishedAtMs - durationMs, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
    });
    rushLeaderboardStore.updateRun(run.id, {
        status: "completed", finishedAtMs, endedAtMs: finishedAtMs, durationMs,
        battleMs: battleMsOverride ?? Math.floor(durationMs * 0.8), roundsCleared: TOTAL_ROUNDS,
        characterIds: [129999, null, null], unisonCharacterIds: [null, null, null],
    });
}

test("记录卡注入默认全关(2026-08-27 真机回归后回滚)", () => {
    delete process.env.WF_RUSH_ENDLESS_CARD_FOLDERS;
    // quest_kind 是 folder 的模式而非结算卡开关,30 关塔与无尽模式结构不兼容。
    // master 已回滚,这里必须同步为空 —— kind=1 下客户端契约要求那些字段为 None。
    assert.equal(isEndlessCardFolder(700099, 1), false, "folder 1 已回滚成 kind=1");
    assert.equal(isEndlessCardFolder(700099, 2), false, "folder 2 是真无尽,服务端不插手");
    assert.equal(isEndlessCardFolder(700007, 1), false, "官方连战不受影响");
});

/** 回滚后默认不注入;规则本身仍需可用,用环境变量显式开启来验。 */
function enableCardBinding(): void {
    process.env.WF_RUSH_ENDLESS_CARD_FOLDERS = JSON.stringify({ 700099: [1] });
}

test("打输的一关不出记录卡字段(响应保持 null)", () => {
    enableCardBinding();
    const fields = buildRushEndlessCardFields({
        playerId: 77, eventId: CARD_EVENT, folderId: CARD_FOLDER,
        round: 5, totalRounds: TOTAL_ROUNDS, accomplished: false,
    });
    assert.equal(fields, null);
});

test("非记录卡 folder 一律返回 null", () => {
    enableCardBinding();
    const fields = buildRushEndlessCardFields({
        playerId: 77, eventId: CARD_EVENT, folderId: 2,
        round: 1, totalRounds: 1, accomplished: true,
    });
    assert.equal(fields, null);
});

test("跑到一半:本次层数=已通关层数,本次用时=已通关各关战斗之和", () => {
    enableCardBinding();
    const run = rushLeaderboardStore.insertRun({
        playerId: 78, playerName: "作者", eventId: CARD_EVENT, folderId: CARD_FOLDER,
        season: 1, startedAtMs: Date.now() - 90_000, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
    });
    rushLeaderboardStore.updateRun(run.id, { roundsCleared: 7, battleMs: 60_000 });

    const args = {
        playerId: 78, eventId: CARD_EVENT, folderId: CARD_FOLDER,
        round: 7, totalRounds: TOTAL_ROUNDS, accomplished: true,
    };
    const fields = buildRushEndlessCardFields(args)!;
    assert.notEqual(fields, null);
    assert.equal(fields.endless_battle_max_round, 7, "卡上「本次」层数 = 这一程已通关层数");
    // 夹具刻意让「起跑到现在」约 90 秒而各关战斗之和 = 60 秒:两种口径的值不同。
    assert.equal(fields.high_score, 60_000, "本次用时 = 已通关各关战斗用时之和");
    assert.equal(fields.old_best_elapsed_time_ms, null, "还没通关过 => 没有历史最佳");
    assert.equal(fields.endless_battle_next_round, 8);

    // 把起跑时刻再往前推一个多小时:旧口径(Date.now()-startedAtMs)会跟着涨,
    // 新口径必须一动不动 —— 关间整备/挂机/掉线不该让「本次」变慢。
    settleDb().prepare("UPDATE players_rush_event_runs SET started_at_ms = ? WHERE id = ?")
        .run(Date.now() - 3_690_000, run.id);
    assert.equal(buildRushEndlessCardFields(args)!.high_score, 60_000,
        "本次用时不随现实时间走");

    rushLeaderboardStore.updateRun(run.id, { status: "abandoned", endedAtMs: Date.now() });
});

test("打通第 30 关:本次=这一程的战斗用时,旧最佳排除本程(破纪录特效据此判定)", () => {
    enableCardBinding();
    completedCardRun(79, 1_500_000, 10_000_000);   // 第一程 墙钟 25 分钟 / 战斗 20 分钟
    let fields = buildRushEndlessCardFields({
        playerId: 79, eventId: CARD_EVENT, folderId: CARD_FOLDER,
        round: TOTAL_ROUNDS, totalRounds: TOTAL_ROUNDS, accomplished: true,
    })!;
    assert.equal(fields.high_score, 1_200_000, "本次 = 刚跑完这一程的战斗用时,不是墙钟 1 500 000");
    assert.equal(fields.old_best_elapsed_time_ms, null, "首次通关没有旧纪录");
    assert.equal(fields.best_elapsed_time_ms, 1_200_000);
    assert.equal(fields.endless_battle_max_round, TOTAL_ROUNDS);
    assert.equal(fields.old_endless_battle_max_round, null, "首次通关:旧层数纪录必须为空,客户端才当成首个纪录");
    assert.equal(fields.endless_battle_next_round, TOTAL_ROUNDS, "塔是有限的,不能算出第 31 关");

    completedCardRun(79, 1_200_000, 20_000_000);   // 第二程 墙钟 20 分钟 / 战斗 16 分钟,破纪录
    fields = buildRushEndlessCardFields({
        playerId: 79, eventId: CARD_EVENT, folderId: CARD_FOLDER,
        round: TOTAL_ROUNDS, totalRounds: TOTAL_ROUNDS, accomplished: true,
    })!;
    assert.equal(fields.high_score, 960_000, "本次 = 最近跑完的那一程,不是最好的那一程");
    assert.equal(fields.old_best_elapsed_time_ms, 1_200_000, "旧纪录必须排除本程,否则永远打不破");
    assert.equal(fields.best_elapsed_time_ms, 960_000, "新纪录");
    assert.equal(fields.old_endless_battle_max_round, TOTAL_ROUNDS, "第二程时旧层数纪录=上一程的 30");
    assert.ok(fields.high_score < fields.old_best_elapsed_time_ms!, "本次快于旧纪录 => 客户端放破纪录特效");
});

test("没破纪录时旧纪录仍是旧纪录,最佳不被拉慢", () => {
    enableCardBinding();
    completedCardRun(80, 900_000, 30_000_000);     // 墙钟 15 分钟 / 战斗 12 分钟
    completedCardRun(80, 1_800_000, 40_000_000);   // 墙钟 30 分钟 / 战斗 24 分钟,比之前慢
    const fields = buildRushEndlessCardFields({
        playerId: 80, eventId: CARD_EVENT, folderId: CARD_FOLDER,
        round: TOTAL_ROUNDS, totalRounds: TOTAL_ROUNDS, accomplished: true,
    })!;
    assert.equal(fields.high_score, 1_440_000, "本次是慢的那一程");
    assert.equal(fields.old_best_elapsed_time_ms, 720_000);
    assert.equal(fields.best_elapsed_time_ms, 720_000, "最佳仍是 12 分钟战斗,不能被这次拖慢");
});

// ---------------------------------------------------------------------------
// 赛季结算:规则层
// ---------------------------------------------------------------------------

const {
    defaultRushSettlementConfig,
    isSettlementDue,
    matchConfiguredRewardTier,
    matchRewardTier,
    nextSettleAtMs,
    planRewardMails,
    renderMailBody,
    validateRewardTiers,
} = require("../lib/rush-settlement") as typeof import("../lib/rush-settlement");

import type { RushSettlementConfig } from "../lib/rush-settlement";

function settlementConfig(overrides: Partial<RushSettlementConfig> = {}): RushSettlementConfig {
    return { ...defaultRushSettlementConfig(700099, 1, 0), ...overrides };
}

test("奖励档位:区间重叠时第一条命中的生效(配置顺序即优先级)", () => {
    const tiers = [
        { fromRank: 1, toRank: 1, itemId: 111, count: 10 },
        { fromRank: 1, toRank: 10, itemId: 222, count: 1 },
    ];
    assert.equal(matchRewardTier(tiers, 1)?.itemId, 111, "第 1 名命中更靠前的专属档");
    assert.equal(matchRewardTier(tiers, 5)?.itemId, 222);
    assert.equal(matchRewardTier(tiers, 11), null, "超出所有档位");
});

test("奖励档位:toRank=null 合法并覆盖第 16 名直到榜尾", () => {
    const tiers = [
        { fromRank: 16, toRank: null, itemId: null, count: 1, degreeId: 9900005 },
    ];

    assert.deepEqual(validateRewardTiers(tiers), [], "null 是显式的到榜尾,不是缺字段");
    assert.equal(matchRewardTier(tiers, 16)?.degreeId, 9900005);
    assert.equal(matchRewardTier(tiers, 99)?.degreeId, 9900005);
});

test("出厂四档不叠加:第 2 名只拿亚季军称号,不拿参与称号", () => {
    const config = settlementConfig();
    assert.equal(config.rewardRankLimit, 15);
    assert.deepEqual(config.rewardTiers, [
        { fromRank: 1, toRank: 1, itemId: 999015, count: 10, degreeId: 9900002 },
        { fromRank: 2, toRank: 3, itemId: 999015, count: 5, degreeId: 9900003 },
        { fromRank: 4, toRank: 15, itemId: 999015, count: 2, degreeId: 9900004 },
        { fromRank: 16, toRank: null, itemId: null, count: 1, degreeId: 9900005 },
    ]);
    const plan = planRewardMails([{ rank: 2, playerId: 102 }], config);

    assert.deepEqual(plan.degrees, [
        { rank: 2, playerId: 102, degreeId: 9900003 },
    ]);
    assert.ok(!plan.degrees.some(grant => grant.degreeId === 9900005),
        "按配置顺序首个命中后必须停止,不能叠加尾档");
});

test("rewardRankLimit 只截断有限档,null 尾档仍覆盖第 16/99 名", () => {
    const tailPlan = planRewardMails(
        [{ rank: 16, playerId: 116 }, { rank: 99, playerId: 199 }],
        settlementConfig({
            rewardRankLimit: 15,
            rewardTiers: [
                { fromRank: 16, toRank: null, itemId: null, count: 1, degreeId: 9900005 },
            ],
        }));
    assert.deepEqual(tailPlan.degrees.map(grant => [grant.rank, grant.degreeId]),
        [[16, 9900005], [99, 9900005]], "尾档不受有限名次截断线影响");

    const finitePlan = planRewardMails(
        [{ rank: 16, playerId: 216 }],
        settlementConfig({
            rewardRankLimit: 15,
            rewardTiers: [
                { fromRank: 16, toRank: 99, itemId: null, count: 1, degreeId: 123456789 },
            ],
        }));
    assert.deepEqual(finitePlan.degrees, [], "有限档超过 rewardRankLimit 仍应被截断");
});

test("有限档被 rewardRankLimit 截断后继续匹配后置 null 尾档", () => {
    const config = settlementConfig({
        rewardRankLimit: 15,
        rewardTiers: [
            { fromRank: 16, toRank: 99, itemId: null, count: 1, degreeId: 123456789 },
            { fromRank: 16, toRank: null, itemId: null, count: 1, degreeId: 9900005 },
        ],
    });

    assert.equal(matchConfiguredRewardTier(config, 16)?.degreeId, 9900005,
        "被有限截断线淘汰的区间不算有效命中,不能遮住后置到榜尾档");
    assert.deepEqual(planRewardMails([{ rank: 16, playerId: 116 }], config).degrees, [
        { rank: 16, playerId: 116, degreeId: 9900005 },
    ]);
});

test("只配任意正整数 degree 的 null 尾档:有称号计划且无邮件", () => {
    const tiers = [
        { fromRank: 16, toRank: null, itemId: null, count: 1, degreeId: 123456789 },
    ];
    assert.deepEqual(validateRewardTiers(tiers), [], "degree 不使用固定白名单");

    const plan = planRewardMails(
        [{ rank: 99, playerId: 299 }],
        settlementConfig({ rewardRankLimit: 15, rewardTiers: tiers }));
    assert.deepEqual(plan.mails, []);
    assert.deepEqual(plan.degrees, [
        { rank: 99, playerId: 299, degreeId: 123456789 },
    ]);
});

test("发奖计划:只发到前 N 名,item id 没配的档位跳过而不是乱发", () => {
    const config = settlementConfig({
        rewardRankLimit: 10,
        rewardTiers: [
            { fromRank: 1, toRank: 1, itemId: 2370099, count: 10 },
            { fromRank: 2, toRank: 3, itemId: null, count: 5 },
            { fromRank: 4, toRank: 10, itemId: 2370099, count: 2 },
        ],
    });
    const rows = Array.from({ length: 15 }, (_, i) => ({ rank: i + 1, playerId: 100 + i }));

    const plan = planRewardMails(rows, config);
    assert.deepEqual(plan.mails.map(m => m.rank), [1, 4, 5, 6, 7, 8, 9, 10],
        "第 11 名起不发;2-3 名因未配置跳过");
    assert.deepEqual(plan.skippedUnconfigured, [2, 3]);
    assert.equal(plan.mails[0]!.count, 10);
    assert.equal(plan.mails[0]!.itemId, 2370099);
    assert.ok(plan.mails[0]!.body.includes("第 1 名"), "邮件正文渲染名次");
});

test("完全没配 item id 时一封都不发,但不报错", () => {
    const plan = planRewardMails(
        [{ rank: 1, playerId: 1 }, { rank: 2, playerId: 2 }],
        settlementConfig({
            rewardTiers: [
                { fromRank: 1, toRank: 1, itemId: null, count: 1, degreeId: null },
                { fromRank: 2, toRank: 2, itemId: null, count: 1, degreeId: null },
            ],
        }));
    assert.equal(plan.mails.length, 0);
    assert.deepEqual(plan.skippedUnconfigured, [1, 2]);
});

test("邮件正文占位符", () => {
    assert.equal(renderMailBody("恭喜第 {rank} 名, {rank} 号", 3), "恭喜第 3 名, 3 号");
});

test("顺延排期:停机跨过多个周期时推到下一个还没到的时刻,不会连环触发", () => {
    const day = 86_400_000;
    const config = settlementConfig({ settleAtMs: 1000, repeatIntervalMs: day });
    const next = nextSettleAtMs(config, 1000 + day * 3 + 5000)!;
    assert.ok(next > 1000 + day * 3 + 5000, "下次排期必须在结算时刻之后");
    assert.equal((next - 1000) % day, 0, "仍然踩在原来的周期节拍上");

    assert.equal(nextSettleAtMs(settlementConfig({ settleAtMs: 1000 }), 2000), null,
        "一次性排期结算后清空");
});

test("到点判定:要同时满足开关打开、有排期、时刻已过", () => {
    assert.equal(isSettlementDue(settlementConfig({ autoEnabled: true, settleAtMs: 500 }), 600), true);
    assert.equal(isSettlementDue(settlementConfig({ autoEnabled: true, settleAtMs: 500 }), 400), false);
    assert.equal(isSettlementDue(settlementConfig({ autoEnabled: false, settleAtMs: 500 }), 600), false,
        "开关关着不结算");
    assert.equal(isSettlementDue(settlementConfig({ autoEnabled: true, settleAtMs: null }), 600), false);
});

test("奖励档位校验挡住非法输入", () => {
    assert.deepEqual(validateRewardTiers([{ fromRank: 1, toRank: 1, itemId: 1, count: 1 }]), []);
    assert.ok(validateRewardTiers([]).length > 0, "空表非法");
    assert.ok(validateRewardTiers("nope").length > 0);
    assert.ok(validateRewardTiers([{ fromRank: 5, toRank: 2, itemId: 1, count: 1 }]).length > 0, "区间倒挂");
    assert.ok(validateRewardTiers([{ fromRank: 1, toRank: 2, itemId: 1, count: 0 }]).length > 0, "数量必须 >=1");
    assert.ok(validateRewardTiers([{ fromRank: 0, toRank: 2, itemId: 1, count: 1 }]).length > 0, "名次从 1 起");
    assert.deepEqual(validateRewardTiers([{ fromRank: 1, toRank: 2, itemId: null, count: 1 }]), [],
        "itemId 留空是合法的「未配置」");
});

test("老库初始化幂等:exclude_bots 只加一次且已有结算配置不被改写", () => {
    const legacyDir = mkdtempSync(path.join(tmpdir(), "wf-rush-settlement-legacy-"));
    const legacyDb = new SqliteDatabase(path.join(legacyDir, "legacy.db"));
    const tiersJson = '[{"fromRank":1,"toRank":10,"itemId":999015,"count":7,"degreeId":777777}]';
    try {
        legacyDb.exec(`CREATE TABLE rush_settlement_config (
            event_id INTEGER NOT NULL,
            folder_id INTEGER NOT NULL,
            auto_enabled INTEGER NOT NULL DEFAULT 0,
            settle_at_ms INTEGER,
            repeat_interval_ms INTEGER,
            reward_board TEXT NOT NULL DEFAULT 'full-run',
            reward_rank_limit INTEGER NOT NULL DEFAULT 10,
            reward_tiers TEXT NOT NULL,
            mail_subject TEXT NOT NULL,
            mail_body TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (event_id, folder_id)
        )`);
        legacyDb.prepare(`INSERT INTO rush_settlement_config
            (event_id, folder_id, auto_enabled, settle_at_ms, repeat_interval_ms,
             reward_board, reward_rank_limit, reward_tiers, mail_subject, mail_body, updated_at_ms)
            VALUES (700099, 1, 0, NULL, NULL, 'season-first', 10, ?, '旧标题', '旧正文', 123)`
        ).run(tiersJson);

        assert.doesNotThrow(() => initWdfpData(legacyDb, true));
        assert.doesNotThrow(() => initWdfpData(legacyDb, true));

        const columns = legacyDb.prepare("PRAGMA table_info(rush_settlement_config)").all() as { name: string }[];
        assert.equal(columns.filter(column => column.name === "exclude_bots").length, 1);
        const preserved = legacyDb.prepare(`SELECT reward_board, reward_rank_limit, reward_tiers,
            mail_subject, mail_body, updated_at_ms, exclude_bots
            FROM rush_settlement_config WHERE event_id = 700099 AND folder_id = 1`).get() as any;
        assert.deepEqual(preserved, {
            reward_board: "season-first",
            reward_rank_limit: 10,
            reward_tiers: tiersJson,
            mail_subject: "旧标题",
            mail_body: "旧正文",
            updated_at_ms: 123,
            exclude_bots: 1,
        });
    } finally {
        legacyDb.close();
    }
});

// ---------------------------------------------------------------------------
// 赛季结算:落地 + 事务
// ---------------------------------------------------------------------------

const settleStore =
    require("../data/domains/rushSettlement") as typeof import("../data/domains/rushSettlement");
const settleService =
    require("../lib/rush-settlement-service") as typeof import("../lib/rush-settlement-service");
const { getDb: settleDb } = require("../data/db") as typeof import("../data/db");
const { getRushBoardRecordsSync } =
    require("../lib/rush-leaderboard-ranking") as typeof import("../lib/rush-leaderboard-ranking");

const SETTLE_EVENT = 700096;   // 专用事件,避开前面用例在 700099 上留下的成绩
const SETTLE_FOLDER = 1;
const REWARD_ITEM = 2370099;

let sharedAccountId: number | null = null;

/** players_mails 对 players 有外键、players 对 accounts 有外键 —— 发奖测试要真实的两级行。 */
function makePlayerRow(playerId: number, name: string): void {
    const db = settleDb();
    if (sharedAccountId === null) {
        const iso = new Date(0).toISOString();
        sharedAccountId = Number(db.prepare(
            `INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id,
                reg_time, last_login_time, status)
             VALUES ('test', ?, '', '', '', ?, ?, 'normal')`).run(iso, iso, iso).lastInsertRowid);
    }
    const columns = (db.prepare("PRAGMA table_info(players)").all() as { name: string }[]).map(c => c.name);
    const values = columns.map(col => {
        if (col === "id") return playerId;
        if (col === "name") return name;
        if (col === "account_id") return sharedAccountId;
        return 0;
    });
    db.prepare(`INSERT OR REPLACE INTO players (${columns.join(",")}) `
        + `VALUES (${columns.map(() => "?").join(",")})`).run(values);
}

test("结算配置只在缺行时 lazy-create,读取已有行不改写原 JSON", () => {
    const eventId = 700091;
    const originalJson = ' [ { "fromRank": 1, "toRank": 9, "itemId": 999015, "count": 7, "degreeId": 7654321 } ] ';
    settleDb().prepare(`INSERT INTO rush_settlement_config
        (event_id, folder_id, auto_enabled, settle_at_ms, repeat_interval_ms,
         reward_board, reward_rank_limit, reward_tiers, mail_subject, mail_body,
         updated_at_ms, exclude_bots)
        VALUES (?, ?, 0, NULL, NULL, 'season-first', 9, ?, '作者标题', '作者正文', 456, 0)`
    ).run(eventId, SETTLE_FOLDER, originalJson);

    const read = settleStore.getRushSettlementConfigSync(eventId, SETTLE_FOLDER, Date.now());
    assert.equal(read.rewardRankLimit, 9);
    assert.equal(read.rewardTiers[0]!.degreeId, 7654321);
    assert.equal(read.excludeBots, false);
    const stored = settleDb().prepare(`SELECT reward_tiers FROM rush_settlement_config
        WHERE event_id = ? AND folder_id = ?`).get(eventId, SETTLE_FOLDER) as { reward_tiers: string };
    assert.equal(stored.reward_tiers, originalJson, "读取已有配置不能顺手按新默认重写 JSON 字节");
});

test("结算:空期直接调用无声 no-op,不写邮件、台账或结果快照", () => {
    const eventId = 700090;
    const mailsBefore = (settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number }).c;
    const ledgerBefore = (settleDb().prepare(`SELECT COUNT(*) c FROM rush_season_settlements
        WHERE event_id = ? AND folder_id = ?`).get(eventId, SETTLE_FOLDER) as { c: number }).c;
    const resultsBefore = (settleDb().prepare(`SELECT COUNT(*) c FROM rush_season_results
        WHERE event_id = ? AND folder_id = ?`).get(eventId, SETTLE_FOLDER) as { c: number }).c;

    const outcome = settleService.settleRushSeasonNow(eventId, SETTLE_FOLDER, "test-empty-direct");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "empty-season");
    assert.equal((settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number }).c,
        mailsBefore);
    assert.equal((settleDb().prepare(`SELECT COUNT(*) c FROM rush_season_settlements
        WHERE event_id = ? AND folder_id = ?`).get(eventId, SETTLE_FOLDER) as { c: number }).c,
        ledgerBefore);
    assert.equal((settleDb().prepare(`SELECT COUNT(*) c FROM rush_season_results
        WHERE event_id = ? AND folder_id = ?`).get(eventId, SETTLE_FOLDER) as { c: number }).c,
        resultsBefore);
});

test("结算:冻结名次 + 前十发奖 + 换期,一个事务", () => {
    // 墙钟与战斗用时的名次**故意相反**:墙钟最快的是 202,战斗最快的是 203。
    // 发奖名单必须跟新口径 —— 夹具写成等比就永远发现不了改错了排序键。
    for (const [playerId, duration, battle] of
        [[201, 500_000, 300_000], [202, 400_000, 380_000], [203, 600_000, 200_000]] as const) {
        makePlayerRow(playerId, `存档${playerId}`);
        const run = rushLeaderboardStore.insertRun({
            playerId, playerName: `存档${playerId}`, eventId: SETTLE_EVENT, folderId: SETTLE_FOLDER,
            season: 1, startedAtMs: 0, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
        });
        rushLeaderboardStore.updateRun(run.id, {
            status: "completed", finishedAtMs: 1_000_000 + playerId, endedAtMs: 1_000_000 + playerId,
            durationMs: duration, battleMs: battle, roundsCleared: TOTAL_ROUNDS,
            characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
        });
    }
    const cfg = settleStore.getRushSettlementConfigSync(SETTLE_EVENT, SETTLE_FOLDER, Date.now());
    settleStore.putRushSettlementConfigSync({
        ...cfg,
        rewardTiers: [
            { fromRank: 1, toRank: 1, itemId: REWARD_ITEM, count: 10 },
            { fromRank: 2, toRank: 3, itemId: REWARD_ITEM, count: 5 },
        ],
        updatedAtMs: Date.now(),
    });

    const seasonBefore = rushLeaderboardStore.getSeason(SETTLE_EVENT)?.season ?? 1;
    const mailsBefore = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };

    const outcome = settleService.settleRushSeasonNow(SETTLE_EVENT, SETTLE_FOLDER, "test");
    assert.equal(outcome.ok, true, outcome.reason);
    assert.equal(outcome.season, seasonBefore);
    assert.equal(outcome.nextSeason, seasonBefore + 1, "结算后自动换期");
    assert.equal(outcome.mailCount, 3, "三个人都在前十档位里");

    const frozen = settleStore.getSeasonResultsSync(SETTLE_EVENT, SETTLE_FOLDER, seasonBefore, "full-run");
    assert.deepEqual(frozen.map(r => [r.rank, r.playerId, r.battleMs]),
        [[1, 203, 200_000], [2, 201, 300_000], [3, 202, 380_000]],
        "冻结名次跟的是 battle_ms:墙钟最快的 202 只排第三");
    assert.deepEqual(frozen.map(r => r.durationMs), [600_000, 500_000, 400_000],
        "墙钟两列都要继续写,老快照才可解释");

    assert.deepEqual(frozen.map(r => r.rewardCount), [10, 5, 5]);
    assert.ok(frozen.every(r => r.mailId !== null), "每一档都留下了邮件 id");

    const mailsAfter = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };
    assert.equal(mailsAfter.c - mailsBefore.c, 3);
    const topMail = settleDb().prepare(
        "SELECT type, type_id, number FROM players_mails WHERE id = ?").get(frozen[0]!.mailId) as any;
    assert.equal(topMail.type, 1, "type 1 = 道具");
    assert.equal(topMail.type_id, REWARD_ITEM);
    assert.equal(topMail.number, 10);

    assert.equal(rushLeaderboardStore.getSeason(SETTLE_EVENT)?.season, seasonBefore + 1);
});

test("同一期不能结算两次(自动调度和手动按钮撞车也不会重复发奖)", () => {
    const season = rushLeaderboardStore.getSeason(SETTLE_EVENT)!.season;
    rushLeaderboardStore.putSeason({
        eventId: SETTLE_EVENT, season: season - 1, startedAtMs: 0, fingerprint: "x", source: "test",
    });
    const mailsBefore = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };

    const again = settleService.settleRushSeasonNow(SETTLE_EVENT, SETTLE_FOLDER, "test-duplicate");
    assert.equal(again.ok, false);
    assert.match(again.reason ?? "", /已经结算过/);

    const mailsAfter = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };
    assert.equal(mailsAfter.c, mailsBefore.c, "被拒的结算一封邮件都不能发");

    rushLeaderboardStore.putSeason({
        eventId: SETTLE_EVENT, season, startedAtMs: 0, fingerprint: "x", source: "test",
    });
});

// ---------------------------------------------------------------------------
// 机器人发不发奖(作者裁定 2026-08-28 晚:做成开关,默认不发)
// ---------------------------------------------------------------------------

const BOT_EVENT = 700095;   // 又一个专用事件,免得和上面的结算用例串味

let botAccountId: number | null = null;

/** 建一个挂在 `accounts.idp_code='rushbot'` 下的存档 —— 判据是账号级的。 */
function makeBotPlayerRow(playerId: number, name: string): void {
    const db = settleDb();
    if (botAccountId === null) {
        const iso = new Date(0).toISOString();
        botAccountId = Number(db.prepare(
            `INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id,
                reg_time, last_login_time, status)
             VALUES ('test', ?, '', 'rushbot', '', ?, ?, 'normal')`).run(iso, iso, iso).lastInsertRowid);
    }
    const columns = (db.prepare("PRAGMA table_info(players)").all() as { name: string }[]).map(c => c.name);
    const values = columns.map(col => {
        if (col === "id") return playerId;
        if (col === "name") return name;
        if (col === "account_id") return botAccountId;
        return 0;
    });
    db.prepare(`INSERT OR REPLACE INTO players (${columns.join(",")}) `
        + `VALUES (${columns.map(() => "?").join(",")})`).run(values);
}

function seedBotEventRun(playerId: number, battleMs: number, season: number): void {
    const run = rushLeaderboardStore.insertRun({
        playerId, playerName: `存档${playerId}`, eventId: BOT_EVENT, folderId: SETTLE_FOLDER,
        season, startedAtMs: 0, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
    });
    rushLeaderboardStore.updateRun(run.id, {
        status: "completed", finishedAtMs: 2_000_000 + playerId, endedAtMs: 2_000_000 + playerId,
        durationMs: battleMs + 1_000, battleMs, roundsCleared: TOTAL_ROUNDS,
        characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
    });
}

function seedSettlementEventRun(options: {
    eventId: number
    playerId: number
    battleMs: number
    season: number
    finishedAtMs?: number
    trackedFromRound?: number
    durationMs?: number | null
}): void {
    const run = rushLeaderboardStore.insertRun({
        playerId: options.playerId,
        playerName: `存档${options.playerId}`,
        eventId: options.eventId,
        folderId: SETTLE_FOLDER,
        season: options.season,
        startedAtMs: 0,
        totalRounds: TOTAL_ROUNDS,
        trackedFromRound: options.trackedFromRound ?? 1,
    });
    rushLeaderboardStore.updateRun(run.id, {
        status: "completed",
        finishedAtMs: options.finishedAtMs ?? 3_000_000 + options.playerId,
        endedAtMs: options.finishedAtMs ?? 3_000_000 + options.playerId,
        durationMs: options.durationMs === undefined ? options.battleMs + 1_000 : options.durationMs,
        battleMs: options.battleMs,
        roundsCleared: TOTAL_ROUNDS,
        characterIds: [1, null, null],
        unisonCharacterIds: [null, null, null],
    });
}

test("结算:机器人默认占名次但不发奖,快照上标出原因", () => {
    // 名次 1=bot / 2=真人 / 3=bot —— 「占名次不发奖」的关键就在这里:
    // 真人拿的必须是**第 2 名**那一档(×5),而不是被顶上来的第 1 名(×10)。
    makeBotPlayerRow(301, "夜刃");
    makePlayerRow(302, "作者");
    makeBotPlayerRow(303, "青雀");
    seedBotEventRun(301, 100_000, 1);
    seedBotEventRun(302, 200_000, 1);
    seedBotEventRun(303, 300_000, 1);

    const cfg = settleStore.getRushSettlementConfigSync(BOT_EVENT, SETTLE_FOLDER, Date.now());
    assert.equal(cfg.excludeBots, true, "出厂默认就是排除机器人");
    settleStore.putRushSettlementConfigSync({
        ...cfg,
        rewardTiers: [
            { fromRank: 1, toRank: 1, itemId: REWARD_ITEM, count: 10 },
            { fromRank: 2, toRank: 3, itemId: REWARD_ITEM, count: 5 },
        ],
        updatedAtMs: Date.now(),
    });

    const mailsBefore = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };
    const outcome = settleService.settleRushSeasonNow(BOT_EVENT, SETTLE_FOLDER, "test-bot");
    assert.equal(outcome.ok, true, outcome.reason);
    assert.deepEqual(outcome.skippedBotRanks, [1, 3]);
    assert.equal(outcome.mailCount, 1, "三个名次里只有真人那一个发得出邮件");

    const frozen = settleStore.getSeasonResultsSync(BOT_EVENT, SETTLE_FOLDER, outcome.season!, "full-run");
    assert.deepEqual(frozen.map(r => [r.rank, r.playerId]), [[1, 301], [2, 302], [3, 303]],
        "机器人**照常占名次** —— 剔除法会让真人第 2 名收到第 1 名的奖励");
    assert.deepEqual(frozen.map(r => r.skipReason), ["bot", null, "bot"],
        "快照上要看得出这一行为什么没奖励");
    assert.equal(frozen[1]!.rewardCount, 5, "真人拿的是他自己那一档(第 2 名 ×5)");
    assert.ok(frozen[1]!.mailId !== null);
    assert.equal(frozen[0]!.mailId, null);
    assert.equal(frozen[2]!.mailId, null);

    const mailsAfter = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };
    assert.equal(mailsAfter.c - mailsBefore.c, 1);

    const ledger = settleStore.getSettlementHistorySync(BOT_EVENT, SETTLE_FOLDER, 1)[0]!;
    assert.match(ledger.note ?? "", /机器人不发奖,跳过名次: 1,3/);
});

test("结算:关掉开关就恢复给机器人发奖;换期后旧成绩不再入榜", () => {
    // 上一条用例已经把 BOT_EVENT 换到第 2 期。战斗用时榜只列当期
    // ⇒ 不补新成绩的话这张榜是空的。这本身就是「新塔新榜」的端到端断言。
    const season2 = rushLeaderboardStore.getSeason(BOT_EVENT)!.season;
    assert.equal(season2, 2);
    const empty = getRushBoardRecordsSync(BOT_EVENT, SETTLE_FOLDER, "full-run");
    assert.deepEqual(empty, [], "换期之后当期榜是空的,上一期的三条成绩不再出现");

    seedBotEventRun(301, 120_000, season2);
    seedBotEventRun(302, 220_000, season2);

    const cfg = settleStore.getRushSettlementConfigSync(BOT_EVENT, SETTLE_FOLDER, Date.now());
    settleStore.putRushSettlementConfigSync({ ...cfg, excludeBots: false, updatedAtMs: Date.now() });
    assert.equal(
        settleStore.getRushSettlementConfigSync(BOT_EVENT, SETTLE_FOLDER, Date.now()).excludeBots,
        false, "开关要真的落盘(老库缺列时 ALTER TABLE 没跑就会一直读回 true)");

    const outcome = settleService.settleRushSeasonNow(BOT_EVENT, SETTLE_FOLDER, "test-bot-off");
    assert.equal(outcome.ok, true, outcome.reason);
    assert.deepEqual(outcome.skippedBotRanks, [], "开关关掉 = 照发");
    assert.equal(outcome.mailCount, 2);

    const frozen = settleStore.getSeasonResultsSync(BOT_EVENT, SETTLE_FOLDER, season2, "full-run");
    assert.deepEqual(frozen.map(r => [r.rank, r.playerId]), [[1, 301], [2, 302]],
        "这一期只有这一期的两条成绩");
    assert.deepEqual(frozen.map(r => r.skipReason), [null, null]);
    assert.ok(frozen.every(r => r.mailId !== null), "机器人这次也收到了邮件");
});

test("结算:null 参与尾档继续排除榜尾机器人,真人只获 degree", () => {
    const eventId = 700094;
    const degreeId = 123450001;
    for (let rank = 1; rank <= 17; rank += 1) {
        const playerId = 4000 + rank;
        if (rank === 16) makeBotPlayerRow(playerId, `机器人${rank}`);
        else makePlayerRow(playerId, `真人${rank}`);
        seedSettlementEventRun({ eventId, playerId, battleMs: rank * 1_000, season: 1 });
    }
    const cfg = settleStore.getRushSettlementConfigSync(eventId, SETTLE_FOLDER, Date.now());
    settleStore.putRushSettlementConfigSync({
        ...cfg,
        rewardRankLimit: 15,
        rewardTiers: [
            { fromRank: 16, toRank: null, itemId: null, count: 1, degreeId },
        ],
        updatedAtMs: Date.now(),
    });
    const rawConfig = settleDb().prepare(`SELECT reward_tiers FROM rush_settlement_config
        WHERE event_id = ? AND folder_id = ?`).get(eventId, SETTLE_FOLDER) as { reward_tiers: string };
    assert.equal(JSON.parse(rawConfig.reward_tiers)[0].toRank, null,
        "API/SQLite 共用的 JSON 形状必须显式保存 toRank:null");

    const mailsBefore = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };
    const outcome = settleService.settleRushSeasonNow(eventId, SETTLE_FOLDER, "test-tail-bot");
    assert.equal(outcome.ok, true, outcome.reason);
    assert.deepEqual(outcome.skippedBotRanks, [16]);
    assert.equal(outcome.mailCount, 0, "参与档只配称号,不能生成邮件");

    const owned = settleDb().prepare(`SELECT player_id FROM players_degrees
        WHERE degree_id = ? ORDER BY player_id`).all(degreeId) as { player_id: number }[];
    assert.deepEqual(owned.map(row => row.player_id), [4017], "机器人不授予,真人榜尾授予");
    const frozen = settleStore.getSeasonResultsSync(eventId, SETTLE_FOLDER, 1, "full-run");
    assert.equal(frozen[15]!.skipReason, "bot");
    assert.equal(frozen[16]!.skipReason, null);
    const mailsAfter = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };
    assert.equal(mailsAfter.c, mailsBefore.c);
});

test("结算:degree-only 档只写 players_degrees,不增加 players_mails", () => {
    const eventId = 700093;
    const playerId = 5001;
    const degreeId = 123456789;
    makePlayerRow(playerId, "任意称号玩家");
    seedSettlementEventRun({ eventId, playerId, battleMs: 10_000, season: 1 });
    const cfg = settleStore.getRushSettlementConfigSync(eventId, SETTLE_FOLDER, Date.now());
    settleStore.putRushSettlementConfigSync({
        ...cfg,
        rewardTiers: [
            { fromRank: 1, toRank: null, itemId: null, count: 1, degreeId },
        ],
        updatedAtMs: Date.now(),
    });

    const mailsBefore = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };
    const outcome = settleService.settleRushSeasonNow(eventId, SETTLE_FOLDER, "test-degree-only");
    assert.equal(outcome.ok, true, outcome.reason);
    assert.equal(outcome.mailCount, 0);
    assert.equal(outcome.degreeCount, 1);
    const owned = settleDb().prepare(`SELECT COUNT(*) c FROM players_degrees
        WHERE player_id = ? AND degree_id = ?`).get(playerId, degreeId) as { c: number };
    assert.equal(owned.c, 1);
    const mailsAfter = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };
    assert.equal(mailsAfter.c, mailsBefore.c);
});

test("结算:null 尾档按当前期全量发到 rank 600,不受 UI 500 行上限截断", () => {
    const eventId = 700089;
    const degreeId = 123456790;
    settleDb().transaction(() => {
        for (let rank = 1; rank <= 600; rank += 1) {
            const playerId = 10_000 + rank;
            makePlayerRow(playerId, `全量玩家${rank}`);
            seedSettlementEventRun({
                eventId,
                playerId,
                battleMs: rank * 1_000,
                season: 1,
            });
        }
    })();
    const cfg = settleStore.getRushSettlementConfigSync(eventId, SETTLE_FOLDER, Date.now());
    settleStore.putRushSettlementConfigSync({
        ...cfg,
        rewardRankLimit: 15,
        rewardTiers: [
            { fromRank: 16, toRank: null, itemId: null, count: 1, degreeId },
        ],
        updatedAtMs: Date.now(),
    });

    const outcome = settleService.settleRushSeasonNow(eventId, SETTLE_FOLDER, "test-tail-all");
    assert.equal(outcome.ok, true, outcome.reason);
    assert.equal(outcome.fullRunRows, 600, "结算冻结的是当前期全量,不是 UI 的前 500 行");
    assert.equal(outcome.degreeCount, 585, "rank 16..600 共 585 人都应进入参与档");
    const owned = settleDb().prepare(`SELECT player_id FROM players_degrees
        WHERE degree_id = ? AND player_id IN (?, ?) ORDER BY player_id`).all(
            degreeId, 10_501, 10_600) as { player_id: number }[];
    assert.deepEqual(owned.map(row => row.player_id), [10_501, 10_600],
        "rank 501 与 rank 600 都必须真正落入 players_degrees");
    const frozen = settleStore.getSeasonResultsSync(eventId, SETTLE_FOLDER, 1, "full-run");
    assert.equal(frozen.length, 600);
    assert.deepEqual([frozen[500]!.rank, frozen[500]!.playerId], [501, 10_501]);
    assert.deepEqual([frozen[599]!.rank, frozen[599]!.playerId], [600, 10_600]);
});

test("结算:season-first 的非 full-run 记录不得拿参与 degree", () => {
    const eventId = 700092;
    const finiteDegree = 123460001;
    const participantDegree = 123460002;
    for (const [playerId, trackedFromRound, finishedAtMs, battleMs, durationMs] of [
        [6001, 1, 4_000_001, 10_000, 11_000],
        [6002, 2, 4_000_002, 20_000, 21_000],
        [6004, 1, 4_000_003, 25_000, null],
        [6005, 1, 4_000_004, 0, 1_000],
        [6003, 1, 4_000_005, 30_000, 31_000],
    ] as const) {
        makePlayerRow(playerId, `首通玩家${playerId}`);
        seedSettlementEventRun({
            eventId, playerId, trackedFromRound, finishedAtMs, battleMs, durationMs, season: 1,
        });
    }
    const cfg = settleStore.getRushSettlementConfigSync(eventId, SETTLE_FOLDER, Date.now());
    settleStore.putRushSettlementConfigSync({
        ...cfg,
        rewardBoard: "season-first",
        rewardRankLimit: 15,
        rewardTiers: [
            { fromRank: 1, toRank: 1, itemId: null, count: 1, degreeId: finiteDegree },
            { fromRank: 2, toRank: null, itemId: null, count: 1, degreeId: participantDegree },
        ],
        updatedAtMs: Date.now(),
    });

    const outcome = settleService.settleRushSeasonNow(eventId, SETTLE_FOLDER, "test-season-first-full-run");
    assert.equal(outcome.ok, true, outcome.reason);
    const owned = settleDb().prepare(`SELECT player_id, degree_id FROM players_degrees
        WHERE player_id IN (6001, 6002, 6003, 6004, 6005) ORDER BY player_id, degree_id`).all() as { player_id: number, degree_id: number }[];
    assert.deepEqual(owned.map(row => [row.player_id, row.degree_id]), [
        [6001, finiteDegree],
        [6003, participantDegree],
    ], "有限第1名仍按 season-first；接管、无 duration、battle=0 都不能拿参与尾档");
});

test("调度器只结算到点的那些", () => {
    // 当期(前面的用例已经把它推到第 2 期)得先有一条完整成绩,否则命中的是
    // 「空期 = 无声 no-op」那条闸,测不到结算本身。
    const season = rushLeaderboardStore.getSeason(SETTLE_EVENT)!.season;
    makePlayerRow(204, "存档204");
    const run = rushLeaderboardStore.insertRun({
        playerId: 204, playerName: "存档204", eventId: SETTLE_EVENT, folderId: SETTLE_FOLDER,
        season, startedAtMs: 0, totalRounds: TOTAL_ROUNDS, trackedFromRound: 1,
    });
    rushLeaderboardStore.updateRun(run.id, {
        status: "completed", finishedAtMs: 2_000_204, endedAtMs: 2_000_204,
        durationMs: 700_000, battleMs: 640_000, roundsCleared: TOTAL_ROUNDS,
        characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
    });

    const cfg = settleStore.getRushSettlementConfigSync(SETTLE_EVENT, SETTLE_FOLDER, Date.now());
    settleStore.putRushSettlementConfigSync({
        ...cfg, autoEnabled: true, settleAtMs: Date.now() + 3_600_000, updatedAtMs: Date.now() });
    assert.equal(settleService.runDueRushSettlements().length, 0, "还没到点不结算");

    settleStore.putRushSettlementConfigSync({
        ...cfg, autoEnabled: true, settleAtMs: Date.now() - 1000, updatedAtMs: Date.now() });
    const fired = settleService.runDueRushSettlements();
    assert.equal(fired.length, 1);
    assert.equal(fired[0]!.ok, true, fired[0]!.reason);

    const after = settleStore.getRushSettlementConfigSync(SETTLE_EVENT, SETTLE_FOLDER, Date.now());
    assert.equal(after.settleAtMs, null);
    assert.equal(settleService.runDueRushSettlements().length, 0);
});

test("到点了但这一期是空的:不结算、不发奖,但排期照样用掉", () => {
    // 上一条用例刚把 SETTLE_EVENT 结算完并换了期 ⇒ 当期一条成绩都没有。
    const emptySeason = rushLeaderboardStore.getSeason(SETTLE_EVENT)!.season;
    const cfg = settleStore.getRushSettlementConfigSync(SETTLE_EVENT, SETTLE_FOLDER, Date.now());
    settleStore.putRushSettlementConfigSync({
        ...cfg, autoEnabled: true, settleAtMs: Date.now() - 1000, updatedAtMs: Date.now() });
    const mailsBefore = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };
    const ledgerBefore = settleStore.getSettlementHistorySync(SETTLE_EVENT, SETTLE_FOLDER).length;
    const resultsBefore = (settleDb().prepare(`SELECT COUNT(*) c FROM rush_season_results
        WHERE event_id = ? AND folder_id = ? AND season = ?`)
        .get(SETTLE_EVENT, SETTLE_FOLDER, emptySeason) as { c: number }).c;

    const fired = settleService.runDueRushSettlements();
    assert.equal(fired.length, 1);
    assert.equal(fired[0]!.ok, false);
    assert.equal(fired[0]!.code, "empty-season");

    const mailsAfter = settleDb().prepare("SELECT COUNT(*) c FROM players_mails").get() as { c: number };
    assert.equal(mailsAfter.c, mailsBefore.c, "空期不发一封空邮件");
    assert.equal(settleStore.getSettlementHistorySync(SETTLE_EVENT, SETTLE_FOLDER).length, ledgerBefore,
        "也不写一条空账 —— 那会把这一期标成「已结算」,以后真有成绩了反而结不了");
    const resultsAfter = (settleDb().prepare(`SELECT COUNT(*) c FROM rush_season_results
        WHERE event_id = ? AND folder_id = ? AND season = ?`)
        .get(SETTLE_EVENT, SETTLE_FOLDER, emptySeason) as { c: number }).c;
    assert.equal(resultsAfter, resultsBefore, "空期也不写任何结果快照");
    assert.equal(rushLeaderboardStore.getSeason(SETTLE_EVENT)?.season, emptySeason,
        "空期不换期:塔又没被重造");
    assert.equal(
        settleStore.getRushSettlementConfigSync(SETTLE_EVENT, SETTLE_FOLDER, Date.now()).settleAtMs,
        null,
        "但排期必须用掉,否则调度器每 30 秒重试一次,"
        + "而且哪天真有人通关就会被「立刻」结算,「到点结算」名存实亡");
    assert.equal(settleService.runDueRushSettlements().length, 0, "不会再触发第二次");
});


// ---------------------------------------------------------------------------
// 游戏内排行榜:好友页骨架的排序不变量
// ---------------------------------------------------------------------------

const { rankToLastLoginTime, FOLLOW_STATE_PRIMARY, FOLLOW_STATE_SECONDARY } =
    require("../routes/api/follow") as typeof import("../routes/api/follow");

test("last_login_time = 基准 - 名次:两个比较器给出同一个顺序", () => {
    const base = 1_800_000_000;
    const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const times = ranks.map(r => rankToLastLoginTime(r, base));

    // compareRank 升序(小名次在前)
    const byRank = [...ranks].sort((a, b) => a - b);
    // compareLastLoginTime 降序(大时间在前)
    const byTime = [...ranks].sort((a, b) =>
        rankToLastLoginTime(b, base) - rankToLastLoginTime(a, base));

    assert.deepEqual(byTime, byRank,
        "两种排序必须同序,否则玩家切一下排序设置就把榜切乱了");
    for (let i = 1; i < times.length; i++) {
        assert.ok(times[i]! < times[i - 1]!, "名次越靠后,last_login_time 必须越小");
    }
});

test("页签分桶避开会抛 2820 的「关注者」桶", () => {
    // follow_state=3 的预排序在 followed_time 为 null 时直接抛 ClientError 2820
    assert.notEqual(FOLLOW_STATE_PRIMARY, 3);
    assert.notEqual(FOLLOW_STATE_SECONDARY, 3);
    assert.notEqual(FOLLOW_STATE_PRIMARY, FOLLOW_STATE_SECONDARY, "两张榜不能落进同一个页签");
});
