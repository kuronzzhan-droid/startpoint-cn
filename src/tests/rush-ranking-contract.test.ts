/**
 * `event/rush/ranking` 服务端契约的单测。
 *
 * 断言的重点是**客户端一接回来就会当场炸 / 静默错位**的那几处
 * (契约原文见 mod-tools/docs/排行榜类移植-可行性与方案-20260827.md §5.1):
 *
 *   · `page` 是 **1 起**的 —— 客户端 `rankingListPageChanged` 里是
 *     `currentPageIndex + 1` 之后才发出来,当 0 起用会跳过第一页;
 *   · `current_page` 必须**原样回抛** —— 回 page+1 会让行落到别的页号上,
 *     当前页缓存永远命不中;
 *   · `page_max` 恒 >= 1 —— 客户端算 `maxPage = page_max - 1`,None 分支直接 throw;
 *   · `party_member_list` 恒 3 元素 —— cell 是复用的,少一个就留上一行的头像;
 *   · `aggregated_time` 必须是 `YYYY-MM-DD HH:MM:SS`(空格恰好 1 个、`-` 恰好 2 个),
 *     否则 `JapanStandardTimeString.toAppTime` 抛 ClientError(7100);
 *   · **名次反查必须和列表同一个排序** —— 否则点第 N 行开的是另一个人的编队;
 *   · `user_rank` 是真实等级(曾经全服写死 215)。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-rush-ranking-"));
process.env.WF_DATABASE_DIR = databaseDir;

const {
    RUSH_RANKING_AGGREGATION_HOURS,
    clearRushRankingSnapshots,
    getRushRankingAggregatedTime,
    getRushRankingMyRowSync,
    getRushRankingPageSync,
    getRushRankingRecordAtRankSync,
    resolveRushRankingTargetSync,
} = require("../lib/rush-leaderboard-ranking") as typeof import("../lib/rush-leaderboard-ranking");

const {
    buildRushRankingPartyMemberList,
    getPlayerRushEventEndlessBattleRankingSync,
} = require("../lib/rush") as typeof import("../lib/rush");

const { rushLeaderboardStore } = require("../data/domains/rushLeaderboard") as typeof import("../data/domains/rushLeaderboard");
const rushEventDomain = require("../data/domains/rushEvent") as typeof import("../data/domains/rushEvent");
const playerDomain = require("../data/domains/player") as typeof import("../data/domains/player");
const accountDomain = require("../data/domains/account") as typeof import("../data/domains/account");
const { getRankDegree } = require("../lib/stamina") as typeof import("../lib/stamina");

/** 用一个不在 assets 里的事件号,免得和真实塔数据串味。 */
const EVENT_ID = 700097;
const FOLDER_ID = 1;
const TOTAL_ROUNDS = 30;
const AGGREGATED_TIME = "2026-08-27 14:00:00";

function insertCompletedRun(options: {
    playerId: number
    durationMs: number
    /** 不给就按 0.8 派生;要验排序键的用例**必须**显式传。 */
    battleMs?: number
    finishedAtMs: number
    characterIds?: (number | null)[]
    season?: number
}): void {
    const run = rushLeaderboardStore.insertRun({
        playerId: options.playerId,
        playerName: `存档${options.playerId}`,
        eventId: EVENT_ID,
        folderId: FOLDER_ID,
        season: options.season ?? 1,
        startedAtMs: options.finishedAtMs - options.durationMs,
        totalRounds: TOTAL_ROUNDS,
        trackedFromRound: 1,
    });
    rushLeaderboardStore.updateRun(run.id, {
        status: "completed",
        finishedAtMs: options.finishedAtMs,
        endedAtMs: options.finishedAtMs,
        durationMs: options.durationMs,
        // 等比派生是单调变换,两种排序键会给出逐行相同的名次 —— 整个文件对
        // 「榜按 battle_ms 排」这件事是瞎的。所以主种子刻意让两者名次相反。
        battleMs: options.battleMs ?? Math.floor(options.durationMs * 0.8),
        roundsCleared: TOTAL_ROUNDS,
        characterIds: options.characterIds ?? [101, 102, 103],
        unisonCharacterIds: [null, null, null],
    });
}

// 25 条成绩:每页 20 行 => 正好两页,能验翻页边界。
// **墙钟递增、战斗用时递减**:存档 n 的墙钟排第 n、battle_ms 排第 26-n。
// 榜按 battle_ms 排(2026-08-28 口径),所以第 1 名是存档 25 而不是存档 1;
// 把 ORDER BY 改回 duration_ms,下面「点第 N 行开的是第 N 名本人」那条会立刻红。
for (let n = 1; n <= 25; n++) {
    insertCompletedRun({
        playerId: n,
        durationMs: 400_000 + n * 1_000,
        battleMs: 400_000 + (26 - n) * 1_000,
        finishedAtMs: 10_000_000 + n,
    });
}

// ---------------------------------------------------------------------------
// aggregated_time
// ---------------------------------------------------------------------------

test("aggregated_time 向下取整到 00:00 / 10:00 / 14:00", () => {
    assert.deepEqual([...RUSH_RANKING_AGGREGATION_HOURS], [0, 10, 14]);

    const at = (iso: string) => getRushRankingAggregatedTime(new Date(iso));
    assert.equal(at("2026-08-27T00:00:00Z"), "2026-08-27 00:00:00");
    assert.equal(at("2026-08-27T09:59:59Z"), "2026-08-27 00:00:00");
    assert.equal(at("2026-08-27T10:00:00Z"), "2026-08-27 10:00:00");
    assert.equal(at("2026-08-27T13:59:59Z"), "2026-08-27 10:00:00");
    assert.equal(at("2026-08-27T14:00:00Z"), "2026-08-27 14:00:00");
    assert.equal(at("2026-08-27T23:59:59Z"), "2026-08-27 14:00:00");
});

test("aggregated_time 的格式被 ClientError(7100) 锁死", () => {
    const value = getRushRankingAggregatedTime(new Date("2026-08-27T15:32:11Z"));
    assert.match(value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(value.split(" ").length, 2, "空格恰好 1 个");
    assert.equal(value.split("-").length, 3, "连字符恰好 2 个");
});

test("aggregated_time 在同一个时段里稳定不变(不是 now())", () => {
    const first = getRushRankingAggregatedTime(new Date("2026-08-27T14:00:01Z"));
    const later = getRushRankingAggregatedTime(new Date("2026-08-27T15:59:59Z"));
    assert.equal(first, later, "14:00 与 15:59 落在同一个聚合时刻上");
});

// ---------------------------------------------------------------------------
// party_member_list
// ---------------------------------------------------------------------------

test("party_member_list 恒 3 元素,空位发 null", () => {
    const full = buildRushRankingPartyMemberList([101, 102, 103], [1, 0, null]);
    assert.equal(full.length, 3);
    assert.deepEqual(full, [
        { character_id: 101, evolution_img_level: 1 },
        { character_id: 102, evolution_img_level: 0 },
        { character_id: 103, evolution_img_level: 0 },
    ]);

    const solo = buildRushRankingPartyMemberList([101], []);
    assert.equal(solo.length, 3, "只有一个人也必须发 3 个槽位");
    assert.deepEqual(solo.slice(1), [
        { character_id: null, evolution_img_level: null },
        { character_id: null, evolution_img_level: null },
    ]);

    const empty = buildRushRankingPartyMemberList([], []);
    assert.equal(empty.length, 3);
    assert.ok(empty.every(slot => slot.character_id === null));

    const gapped = buildRushRankingPartyMemberList([null, 202, null], [null, 1, null]);
    assert.equal(gapped[1]!.character_id, 202, "槽位不许左移");
    assert.equal(gapped[0]!.character_id, null);
});

test("榜上每一行的 party_member_list 都是 3 元素", () => {
    const page = getRushRankingPageSync(EVENT_ID, FOLDER_ID, "full-run", 1, 20);
    assert.ok(page.list.length > 0);
    assert.ok(page.list.every(row => row.party_member_list.length === 3));
});

// ---------------------------------------------------------------------------
// 翻页
// ---------------------------------------------------------------------------

test("page 是 1 起的,第 1 页不许跳过任何一行", () => {
    const first = getRushRankingPageSync(EVENT_ID, FOLDER_ID, "full-run", 1, 20);
    assert.equal(first.total, 25);
    assert.equal(first.list.length, 20);
    assert.equal(first.list[0]!.rank_number, 1, "第 1 页第 1 行必须是第 1 名");
    assert.equal(first.list[19]!.rank_number, 20);

    const second = getRushRankingPageSync(EVENT_ID, FOLDER_ID, "full-run", 2, 20);
    assert.equal(second.list.length, 5);
    assert.equal(second.list[0]!.rank_number, 21, "第 2 页接着第 1 页,不是从 41 起");
});

test("page_max 恒 >= 1,哪怕榜是空的", () => {
    assert.equal(getRushRankingPageSync(EVENT_ID, FOLDER_ID, "full-run", 1, 20).pageMax, 2);
    // 一个没有任何成绩的 folder
    const emptyBoard = getRushRankingPageSync(EVENT_ID, 999, "full-run", 1, 20);
    assert.equal(emptyBoard.total, 0);
    assert.equal(emptyBoard.list.length, 0);
    assert.equal(emptyBoard.pageMax, 1, "0 会让客户端算出 maxPage = -1");
});

test("越界 / 非法页号被夹回第 1 页,不返回负 offset", () => {
    const zero = getRushRankingPageSync(EVENT_ID, FOLDER_ID, "full-run", 0, 20);
    assert.equal(zero.list[0]!.rank_number, 1);
    const negative = getRushRankingPageSync(EVENT_ID, FOLDER_ID, "full-run", -5, 20);
    assert.equal(negative.list[0]!.rank_number, 1);
    const beyond = getRushRankingPageSync(EVENT_ID, FOLDER_ID, "full-run", 99, 20);
    assert.equal(beyond.list.length, 0, "翻过尾页发空数组,不是抛错");
});

// ---------------------------------------------------------------------------
// 名次反查 —— 「点第 N 行开谁的编队」
// ---------------------------------------------------------------------------

test("名次反查与列表同一个排序:第 N 行点开的是第 N 名本人", () => {
    const page = getRushRankingPageSync(EVENT_ID, FOLDER_ID, "full-run", 1, 20);
    for (const row of page.list) {
        const record = getRushRankingRecordAtRankSync(
            EVENT_ID, FOLDER_ID, "full-run", row.rank_number!,
        );
        assert.ok(record, `第 ${row.rank_number} 名反查不到`);
        assert.equal(record!.displayName, row.name,
            `第 ${row.rank_number} 名反查到了别人`);
    }

    assert.equal(getRushRankingRecordAtRankSync(EVENT_ID, FOLDER_ID, "full-run", 0), null);
    assert.equal(getRushRankingRecordAtRankSync(EVENT_ID, FOLDER_ID, "full-run", 999), null);
});

test("my_data:上榜发行,没上榜发 null,名次与数值列都跟 battle_ms", () => {
    const mine = getRushRankingMyRowSync(EVENT_ID, FOLDER_ID, "full-run", 3);
    assert.equal(mine?.name, "存档3");
    // 存档 3 的墙钟排第 3、battle_ms 排第 23 —— 名次跟的是后者。
    assert.equal(mine?.rank_number, 23, "名次按 battle_ms 算,不是墙钟");
    assert.equal(mine?.elapsed_time_ms, 423_000, "数值列发的是 battle_ms,不是墙钟 403 000");
    assert.equal(getRushRankingMyRowSync(EVENT_ID, FOLDER_ID, "full-run", 9999), null);
});

test("列表第一行是 battle_ms 最短的那位(不是墙钟最短的那位)", () => {
    const page = getRushRankingPageSync(EVENT_ID, FOLDER_ID, "full-run", 1, 20);
    assert.equal(page.list[0]!.name, "存档25", "墙钟最长、战斗最短的那位排第一");
    assert.equal(page.list[0]!.elapsed_time_ms, 401_000);
    const last = getRushRankingPageSync(EVENT_ID, FOLDER_ID, "full-run", 2, 20);
    assert.equal(last.list[last.list.length - 1]!.name, "存档1", "墙钟最短的那位垫底");
});

// ---------------------------------------------------------------------------
// 快照:同一个 aggregated_time 内名次不许漂
// ---------------------------------------------------------------------------

test("同一个 aggregated_time 内名次不漂,换时刻才刷新", () => {
    clearRushRankingSnapshots();

    const before = getRushRankingPageSync(
        EVENT_ID, FOLDER_ID, "full-run", 1, 20, AGGREGATED_TIME);
    assert.equal(before.total, 25);

    // 插一条能排到第 1 的新成绩
    insertCompletedRun({ playerId: 500, durationMs: 1_000, finishedAtMs: 20_000_000 });

    const same = getRushRankingPageSync(
        EVENT_ID, FOLDER_ID, "full-run", 1, 20, AGGREGATED_TIME);
    assert.equal(same.total, 25, "同一聚合时刻里名次必须冻住");
    assert.equal(same.list[0]!.name, before.list[0]!.name);

    // 反查也走同一份快照,否则点第 1 行开的是刚插进来的那位
    const first = getRushRankingRecordAtRankSync(
        EVENT_ID, FOLDER_ID, "full-run", 1, AGGREGATED_TIME);
    assert.equal(first!.displayName, before.list[0]!.name);

    const nextBucket = getRushRankingPageSync(
        EVENT_ID, FOLDER_ID, "full-run", 1, 20, "2026-08-27 18:00:00");
    assert.equal(nextBucket.total, 26, "换了聚合时刻才把新成绩纳进来");
    assert.equal(nextBucket.list[0]!.name, "存档500");

    clearRushRankingSnapshots();
});

test("WF_RUSH_RANKING_LIVE=1 关掉快照,新成绩立刻进榜", () => {
    clearRushRankingSnapshots();
    const original = process.env.WF_RUSH_RANKING_LIVE;
    try {
        const frozen = getRushRankingPageSync(
            EVENT_ID, FOLDER_ID, "full-run", 1, 20, AGGREGATED_TIME);

        insertCompletedRun({ playerId: 501, durationMs: 500, finishedAtMs: 21_000_000 });

        process.env.WF_RUSH_RANKING_LIVE = "1";
        const live = getRushRankingPageSync(
            EVENT_ID, FOLDER_ID, "full-run", 1, 20, AGGREGATED_TIME);
        assert.equal(live.total, frozen.total + 1);
        assert.equal(live.list[0]!.name, "存档501");
    } finally {
        if (original === undefined) delete process.env.WF_RUSH_RANKING_LIVE;
        else process.env.WF_RUSH_RANKING_LIVE = original;
        clearRushRankingSnapshots();
    }
});

// ---------------------------------------------------------------------------
// 一个 event_id = 一张榜
// ---------------------------------------------------------------------------

test("event_id 决定看哪张榜", () => {
    const target = resolveRushRankingTargetSync(700099);
    assert.ok(target, "700099 是深渊连战本体,必须解得出来");
    assert.equal(target!.board, "full-run");
    assert.ok(target!.folderId > 0);

    assert.equal(resolveRushRankingTargetSync(123456), null, "不是塔的事件不开榜");
    assert.equal(resolveRushRankingTargetSync(Number.NaN), null);
});

test("WF_RUSH_RANKING_BOARDS 能把某个事件改绑到当轮首通榜", () => {
    const original = process.env.WF_RUSH_RANKING_BOARDS;
    try {
        process.env.WF_RUSH_RANKING_BOARDS = JSON.stringify({
            "700099": "season-first",
        });
        assert.equal(resolveRushRankingTargetSync(700099)!.board, "season-first");

        // 垃圾值不许把默认绑定带崩
        process.env.WF_RUSH_RANKING_BOARDS = "{not json";
        assert.equal(resolveRushRankingTargetSync(700099)!.board, "full-run");
    } finally {
        if (original === undefined) delete process.env.WF_RUSH_RANKING_BOARDS;
        else process.env.WF_RUSH_RANKING_BOARDS = original;
    }
});

// ---------------------------------------------------------------------------
// user_rank / rank_number —— 无尽战斗那条老通路的两个真 bug
// ---------------------------------------------------------------------------

test("user_rank 是真实等级,rank_number 算不出时发 null", () => {
    const account = accountDomain.insertAccountSync({
        appId: "rush-ranking-test",
        idpAlias: "test",
        idpCode: "test",
        idpId: "rush-ranking-test",
        status: "active",
    });
    const player = playerDomain.insertDefaultPlayerSync(account.id);
    playerDomain.updatePlayerSync({ id: player.id, name: "作者", rankPoint: 1_000_000 });

    rushEventDomain.insertPlayerRushEventSync(player.id, {
        eventId: EVENT_ID,
        endlessBattleNextRound: 1,
        activeRushBattleFolderId: null,
        endlessBattleMaxRound: 12,
        endlessBattleMaxRoundTime: 123_456,
        endlessBattleMaxRoundCharacterIds: [101, null, null],
        endlessBattleMaxRoundCharacterEvolutionImgLvls: [1, null, null],
    });

    const row = getPlayerRushEventEndlessBattleRankingSync(player.id, EVENT_ID);
    assert.ok(row);
    assert.equal(row!.rank_number, null, "没算名次就发 null,不是 0(0 = 明确的「排名外」)");
    assert.notEqual(row!.user_rank, 215, "曾经全服写死 215");
    assert.equal(row!.user_rank, getRankDegree(1_000_000));
    assert.equal(row!.party_member_list.length, 3);
    assert.deepEqual(row!.party_member_list[1], { character_id: null, evolution_img_level: null });

    const ranked = getPlayerRushEventEndlessBattleRankingSync(player.id, EVENT_ID, { rankNumber: 7 });
    assert.equal(ranked!.rank_number, 7);
});

// ---------------------------------------------------------------------------
// page_max 口径 / 名次反查 —— 无尽战斗榜的 SQL 层
// ---------------------------------------------------------------------------

test("无尽榜:没成绩的行不许算进 page_max,名次反查与列表对得上", () => {
    const eventId = 700096;
    const withRecord: number[] = [];

    for (let n = 0; n < 3; n++) {
        const account = accountDomain.insertAccountSync({
            appId: `rush-endless-${n}`,
            idpAlias: "test",
            idpCode: "test",
            idpId: `rush-endless-${n}`,
            status: "active",
        });
        const player = playerDomain.insertDefaultPlayerSync(account.id);
        playerDomain.updatePlayerSync({ id: player.id, name: `无尽${n}` });

        // n === 1 那位从没打过无尽:三个成绩列全空。
        const played = n !== 1;
        if (played) withRecord.push(player.id);
        rushEventDomain.insertPlayerRushEventSync(player.id, {
            eventId,
            endlessBattleNextRound: 1,
            activeRushBattleFolderId: null,
            endlessBattleMaxRound: played ? 30 - n : null,
            endlessBattleMaxRoundTime: played ? 100_000 + n : null,
            endlessBattleMaxRoundCharacterIds: played ? [101, 102, 103] : [null, null, null],
            endlessBattleMaxRoundCharacterEvolutionImgLvls: played ? [0, 0, 0] : [null, null, null],
        });
    }

    // 每页 1 行:page_max 必须等于**有成绩的行数**(2),不是全部行数(3)。
    const page = rushEventDomain.getRushEventEndlessRankingListSync(eventId, 0, 1);
    assert.equal(page.pageMax, 2, "无成绩的行被列表丢掉了,就不能算进 page_max");
    assert.equal(page.list.length, 1);

    // 名次反查必须落在同一批人上。
    for (let rank = 1; rank <= 2; rank++) {
        const playerId = rushEventDomain.getPlayerIdFromRushEventEndlessRankSync(rank, eventId);
        assert.ok(playerId !== null, `第 ${rank} 名反查不到`);
        assert.ok(withRecord.includes(playerId!), "反查到了一个根本不在榜上的存档");
    }
    assert.equal(rushEventDomain.getPlayerIdFromRushEventEndlessRankSync(3, eventId), null);
    assert.equal(rushEventDomain.getPlayerIdFromRushEventEndlessRankSync(0, eventId), null);
});
