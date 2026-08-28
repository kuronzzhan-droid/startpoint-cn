/**
 * 榜行三个头像画谁 —— `resolveRowMains` 的单测(作者裁定 2026-08-28 晚)。
 *
 * 作者要的是「**编队能用就用编队,用不了就显示他打那一程的实战队伍**」,
 * 所以这一层唯一要钉死的就是那条兜底链。断言的重点全是「选错了会在真机上
 * 画出一支与玩家无关的队伍 / 两屏不一致」的那几处:
 *
 *  · 编队可用时必须**整支**换过去(不许一个槽位用编队、另一个用快照);
 *  · 主位 1 不可下发但队里还有人 ⇒ 成对左压缩(`party-compacted`)也要采用,
 *    这样和个人资料页画的是同一支队伍;
 *  · 投影落到 `leader` / `owned` 兜底时**必须退回快照** —— 那两条是为了
 *    「资料页槽 0 不许为空」这条客户端硬约束存在的,搬到榜行上就是
 *    「实测存档 #1 的编队主位是助战 700016 ⇒ 榜上出现它的 leader_character_id=1
 *    (alk)」这种和玩家毫无关系的头像;
 *  · 存档已删 ⇒ 快照(已删存档根本没有编队可查,而快照随成绩冻结、活得过删档);
 *  · `WF_RUSH_RANK_ROW_PARTY=snapshot` 是熔断开关,必须整屏退回旧行为。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// agreement 模块在 import 时会连数据库(src/data/db.ts 是模块级 getDatabase),
// 指到临时目录,免得单测碰作者本机那一份 .database/wdfp_data.db。
const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-rush-row-party-"));
process.env.WF_DATABASE_DIR = databaseDir;

const { resolveRowMains, pickParty } =
    require("../lib/rush-leaderboard-agreement") as typeof import("../lib/rush-leaderboard-agreement");

import type { RowPartyRow } from "../lib/rush-leaderboard-agreement";

import type { RushRunRecord } from "../data/domains/rushLeaderboard";

/** 快照队伍固定是这三个人 —— 断言里靠它和编队区分开。 */
const SNAPSHOT: (number | null)[] = [129999, 169995, 149995];

function record(overrides: Partial<RushRunRecord> = {}): RushRunRecord {
    return {
        id: 1,
        playerId: 8,
        playerName: "zzhan",
        eventId: 700099,
        folderId: 1,
        season: 1,
        status: "completed",
        startedAtMs: 0,
        finishedAtMs: 257130,
        endedAtMs: 257130,
        durationMs: 257130,
        battleMs: 200561,
        roundsCleared: 30,
        totalRounds: 30,
        trackedFromRound: 1,
        characterIds: [...SNAPSHOT],
        unisonCharacterIds: [null, null, null],
        displayName: "zzhan",
        playerExists: true,
        fullRun: true,
        ...overrides
    } as RushRunRecord
}

function party(
    mains: (number | null)[],
    unisons: (number | null)[] = [null, null, null]
): { mains: (number | null)[], unisons: (number | null)[] } {
    return { mains, unisons }
}

test("编队可下发时整支用编队,快照一个槽位都不掺", () => {
    const resolved = resolveRowMains(
        record(),
        { leaderCharacterId: 1 },
        party([169995, 141159, 111007])
    );
    assert.equal(resolved.source, "party");
    assert.deepEqual(resolved.mains, [169995, 141159, 111007]);
    assert.notDeepEqual(resolved.mains, SNAPSHOT,
        "快照和编队必须真的不同,否则这条断言什么都没验");
});

test("编队里的空位原样发 null,不许拿快照来补", () => {
    // 「编队 2 号位是空的」和「这一行没有编队」是两件事。混用两个来源会拼出
    // 一支从没存在过的队伍。
    const resolved = resolveRowMains(
        record(),
        { leaderCharacterId: 1 },
        party([169995, null, null])
    );
    assert.equal(resolved.source, "party");
    assert.deepEqual(resolved.mains, [169995, null, null]);
});

test("主位 1 不可下发但队里还有人 ⇒ 成对左压缩也采用(和资料页一致)", () => {
    // 700016 是助战段,isShippableCharacterId 拒发 ⇒ 槽 0 空 ⇒ buildProfileFavoriteParty
    // 走 party-compacted。资料页画的就是压缩后的那一支,榜行必须跟着它。
    const resolved = resolveRowMains(
        record(),
        { leaderCharacterId: 1 },
        party([700016, 169995, 141159])
    );
    assert.equal(resolved.source, "party-compacted");
    assert.deepEqual(resolved.mains, [169995, 141159, null]);
});

test("整队都不可下发 ⇒ 退回实战快照,而不是队长兜底", () => {
    // 这条是实测存档 #1 的形状:编队主位 1 = 700016(助战)、2/3 为空,
    // 而 leader_character_id = 1。buildProfileFavoriteParty 会给出 source='leader'
    // 的单人队 [1, null, null] —— 那个头像和这位玩家毫无关系。
    // 删掉 resolveRowMains 里那句「只认 party / party-compacted」这条会立刻红。
    const resolved = resolveRowMains(
        record(),
        { leaderCharacterId: 1 },
        party([700016, null, null])
    );
    assert.equal(resolved.source, "snapshot");
    assert.deepEqual(resolved.mains, SNAPSHOT);
});

test("存档已删(查不到 players 行)⇒ 退回实战快照", () => {
    const resolved = resolveRowMains(record({ playerExists: false }), null, null);
    assert.equal(resolved.source, "snapshot");
    assert.deepEqual(resolved.mains, SNAPSHOT,
        "已删存档没有任何编队可查,而快照是随成绩冻结的");
});

test("party_slot 指的那一队查不到 ⇒ 退回实战快照", () => {
    const resolved = resolveRowMains(record(), { leaderCharacterId: 1 }, null);
    assert.equal(resolved.source, "snapshot");
    assert.deepEqual(resolved.mains, SNAPSHOT);
});

test("三个槽位恒为 3 个元素,哪怕编队行只给了 1 个", () => {
    // 客户端 cell 是复用的:少发一格会把上一行的脸留在屏幕上。
    const resolved = resolveRowMains(record(), { leaderCharacterId: 1 }, party([169995]));
    assert.equal(resolved.mains.length, 3);
    assert.deepEqual(resolved.mains, [169995, null, null]);
});

test("WF_RUSH_RANK_ROW_PARTY=snapshot 是熔断开关,整屏退回旧行为", () => {
    const previous = process.env.WF_RUSH_RANK_ROW_PARTY;
    process.env.WF_RUSH_RANK_ROW_PARTY = "snapshot";
    try {
        const resolved = resolveRowMains(
            record(),
            { leaderCharacterId: 1 },
            party([169995, 141159, 111007])
        );
        assert.equal(resolved.source, "snapshot",
            "开关关掉后连查都不该查编队");
        assert.deepEqual(resolved.mains, SNAPSHOT);
    } finally {
        if (previous === undefined) delete process.env.WF_RUSH_RANK_ROW_PARTY;
        else process.env.WF_RUSH_RANK_ROW_PARTY = previous;
    }
});

test("开关的默认值是 profile —— 不设环境变量就走编队", () => {
    const previous = process.env.WF_RUSH_RANK_ROW_PARTY;
    delete process.env.WF_RUSH_RANK_ROW_PARTY;
    try {
        const resolved = resolveRowMains(
            record(), { leaderCharacterId: 1 }, party([169995, null, null]));
        assert.equal(resolved.source, "party");
    } finally {
        if (previous !== undefined) process.env.WF_RUSH_RANK_ROW_PARTY = previous;
    }
});


// ---------------------------------------------------------------------------
// 「画哪一支队」的查找口径 —— 必须和个人资料页逐条相同
// ---------------------------------------------------------------------------

/**
 * 造一行 `players_parties`。
 *
 * @param playerId 存档 ID。
 * @param groupId 组号。
 * @param slot 格号。
 */
function partyRow(playerId: number, groupId: number, slot: number): RowPartyRow {
    return {
        player_id: playerId, group_id: groupId, slot,
        character_id_1: groupId * 100 + slot, character_id_2: null, character_id_3: null,
        unison_character_1: null, unison_character_2: null, unison_character_3: null,
    };
}

/**
 * 把若干行装进 loadRowFacets 用的那张 Map。
 *
 * @param rows 编队行。
 */
function partyMap(rows: RowPartyRow[]): Map<string, RowPartyRow> {
    return new Map(rows.map(row => [`${row.player_id}:${row.group_id}:${row.slot}`, row]));
}

test("pickParty:party_slot 指的那一行在,就用它", () => {
    const rows = partyMap([partyRow(7, 1, 1), partyRow(7, 2, 3)]);
    assert.equal(pickParty(rows, 7, 2, 3)?.character_id_1, 203);
});

test("pickParty:那一行不在 ⇒ 退回该存档最小 group 的最小 slot(与资料页同款兜底)", () => {
    // 资料页是 `groups[groupId] ?? Object.values(groups)[0]` →
    // `list[partySlot] ?? Object.values(list)[0]`,靠的是整数键升序枚举 = 取最小键。
    // 这里只做精确查找的话,榜行会退回成绩快照而资料页照样画得出队伍 ——
    // 同一个存档两屏两支队,正是给 bot 补编队要消灭的那种不一致。
    const rows = partyMap([partyRow(7, 3, 5), partyRow(7, 2, 4), partyRow(7, 2, 2)]);
    assert.equal(pickParty(rows, 7, 9, 9)?.character_id_1, 202,
        "最小 group=2、其中最小 slot=2");
});

test("pickParty:兜底不许串到别的存档头上", () => {
    const rows = partyMap([partyRow(8, 1, 1)]);
    assert.equal(pickParty(rows, 7, 1, 1), undefined,
        "存档 7 一支队都没有 ⇒ undefined(调用方据此退回成绩快照)");
});
