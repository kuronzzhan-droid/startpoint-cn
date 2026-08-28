/**
 * 深渊连战排行榜「官方原生列表行」(P4/S2)的单测。
 *
 * 这一层的行对象是**手写 AVM2 字节码**直接读的,所以断言的重点全是
 * 「错了会在真机上静默失效 / 直接崩」的那几处:
 *
 *  · 字段名必须**逐字**是 `rank / visible / level / name / count / time / a / b / c / id`
 *    —— 客户端补丁的 `getproperty` 用的是 P2 包常量池里已有的 multiname,
 *    改名等于把值读成 `undefined`,界面上全空、没有任何报错;
 *  · 文案必须和设备 master `ui_string` 逐字一致(`::value::位` / `RANK::value::` /
 *    `BEST RECORD: ::value::战` / `TIME: ::value::` / `排名外`);
 *  · `formatMmSsFf` 必须逐位复刻 `TimeSpan_Impl_.formatToMMSSFF`,包括
 *    「分钟不取模 60」和那两个 `1e-10` 补偿;
 *  · 头像路径必须是 `character/<code_name>/ui/thumb_party_unison_<0|1>`,
 *    等级要在服务端钳死(客户端对 <0 抛 ClientError 2027);
 *  · 空槽位必须发 `null` —— cell 是复用的,少发一格会把上一行的脸留在屏幕上;
 *  · 三个槽位**不许左移**(1 号位空、2 号位有人时,2 号位必须还在 b);
 *  · 三个头像 2026-08-28 起优先画 `facets.mains`(个人资料里的前三个角色),
 *    facets 缺省时才退回成绩快照 —— **整支队伍一起换**,不许一个槽位用编队、
 *    另一个用快照。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// `src/data/db.ts` 是模块级 getDatabase():只要 require 链上有它,这个测试进程
// 就会打开并 init 一遍数据库。指到临时目录,免得单测碰作者的
// `.database/wdfp_data.db`(本文件只测纯函数,一个真数据都不需要)。
const databaseDir = mkdtempSync(path.join(tmpdir(), "wf-rush-iso-"));
process.env.WF_DATABASE_DIR = databaseDir;


const {
    NATIVE_ROW_SLOTS,
    RUSH_PROFILE_ID_BASE,
    formatMmSsFf,
    fromProfileTargetId,
    nativeThumbnailPath,
    toNativeRankRow,
    toProfileTargetId,
} = require("../lib/rush-leaderboard-native-rows") as typeof import("../lib/rush-leaderboard-native-rows");

import type { RushRunRecord } from "../data/domains/rushLeaderboard";

/** 一条不碰数据库的成绩记录:`playerExists=false` ⇒ 等级/立绘查询整段短路。 */
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
        characterIds: [129999, 169995, 149995],
        unisonCharacterIds: [null, null, null],
        displayName: "zzhan",
        playerExists: false,
        fullRun: true,
        ...overrides
    } as RushRunRecord
}

test("formatMmSsFf 复刻 TimeSpan_Impl_.formatToMMSSFF", () => {
    assert.equal(formatMmSsFf(0), "00:00.00");
    assert.equal(formatMmSsFf(257130), "04:17.13");
    assert.equal(formatMmSsFf(439160), "07:19.16");
    // 秒/厘秒都要补零
    assert.equal(formatMmSsFf(61050), "01:01.05");
    // 分钟**不**取模 60:官方就是这么写的,超过一小时会显示 60:00.00
    assert.equal(formatMmSsFf(3600000), "60:00.00");
    // 负数与非数按 0 处理,绝不产生 "NaN:NaN.NaN"
    assert.equal(formatMmSsFf(-1), "00:00.00");
    assert.equal(formatMmSsFf(Number.NaN), "00:00.00");
});

test("formatMmSsFf 的进位边界不掉一厘秒", () => {
    // 999ms 还没到 1 秒;1000ms 整必须是 01.00 而不是 00.99
    assert.equal(formatMmSsFf(999), "00:00.99");
    assert.equal(formatMmSsFf(1000), "00:01.00");
    assert.equal(formatMmSsFf(59999), "00:59.99");
    assert.equal(formatMmSsFf(60000), "01:00.00");
});

test("行的键名和文案逐字对齐 master ui_string", () => {
    const row = toNativeRankRow(record(), 3);
    assert.deepEqual(Object.keys(row).sort(),
        ["a", "b", "c", "count", "id", "level", "name", "rank", "time", "visible"],
        "字段名是客户端 getproperty 的 multiname,不许改");
    assert.equal(row.rank, "3位");
    assert.equal(row.visible, true);
    assert.equal(row.level, "RANK1");
    assert.equal(row.name, "zzhan");
    assert.equal(row.count, "BEST RECORD: 30战");
    assert.equal(row.time, "TIME: 03:20.56", "数值列 = battleMs(200561),不是墙钟 257130");
});

test("未上榜走官方「排名外」并隐藏黑旗", () => {
    const row = toNativeRankRow(record(), null);
    assert.equal(row.rank, "排名外");
    assert.equal(row.visible, false, "rank_label 必须隐藏,否则黑旗里是空的");
});

test("不是完整一程 / 没有有效战斗计时的行发哨兵,绝不发 00:00.00", () => {
    // battleMs=0 会被 formatMmSsFf 渲染成 00:00.00 —— 比任何真成绩都「快」
    const zero = toNativeRankRow(record({ battleMs: 0, fullRun: false, durationMs: 257130 }), 1);
    assert.equal(zero.time, "TIME: --:--.--");
    // 半途接管:battleMs 是部分和,同样不能当成绩显示
    const partial = toNativeRankRow(
        record({ battleMs: 20_000, fullRun: false, trackedFromRound: 20 }), 1);
    assert.equal(partial.time, "TIME: --:--.--");
    // 墙钟再大也不影响数值列
    const full = toNativeRankRow(record({ battleMs: 200561, durationMs: 9_999_999 }), 1);
    assert.equal(full.time, "TIME: 03:20.56");
});

test("存档已删时用快照名,不发 null", () => {
    const row = toNativeRankRow(record({ displayName: null, playerId: 42 }), 1);
    assert.equal(row.name, "存档42");
});

test("头像路径按官方规则拼,等级钳在 0/1", () => {
    assert.equal(nativeThumbnailPath(169995, 0),
        "character/maou2_playable/ui/thumb_party_unison_0");
    assert.equal(nativeThumbnailPath(169995, 1),
        "character/maou2_playable/ui/thumb_party_unison_1");
    // 客户端把 >1 钳到 1;<0 抛 ClientError 2027 ⇒ 服务端先钳死
    assert.equal(nativeThumbnailPath(169995, 9),
        "character/maou2_playable/ui/thumb_party_unison_1");
    assert.equal(nativeThumbnailPath(169995, -5),
        "character/maou2_playable/ui/thumb_party_unison_0");
});

test("查不到 code_name 的角色发 null,不拼出脏路径", () => {
    assert.equal(nativeThumbnailPath(424242, 0), null,
        "不认识的 ID 必须降级成空槽位,否则真机上是「数据不足」而不是空框");
    assert.equal(nativeThumbnailPath(null, 0), null);
    assert.equal(nativeThumbnailPath(0, 0), null);
});

test("助战段 700000-700099 一律不发头像路径", () => {
    // 20260828 复核抓到的漏网口子:这条路当时只查 code_name,助战角色查得到
    // ⇒ 700001 会拼出 `character/devil_leader_assist/...`。而这些 ID 的
    // thumb_party_unison_* 大多在 store 里没有实体文件,客户端读不到贴图走的
    // 不是空框降级,是 SectionCommand.FileNotFound ⇒「数据不足」+ 拉去重下资源。
    // 判据必须和官方契约端点共用 isShippableCharacterId,不许两处各写一份。
    assert.equal(nativeThumbnailPath(700000, 0), null);
    assert.equal(nativeThumbnailPath(700001, 0), null,
        "助战段必须整段拦掉:devil_leader_assist 的 code_name 查得到,但贴图不存在");
    assert.equal(nativeThumbnailPath(700099, 0), null);
    // 边界外的正常角色不许被误伤
    assert.equal(nativeThumbnailPath(169995, 0),
        "character/maou2_playable/ui/thumb_party_unison_0");
});

test("助战 ID 混进成绩记录时降级成空框,而不是整屏数据不足", () => {
    const row = toNativeRankRow(record({ characterIds: [700001, 169995, null] }), 1,
        { evolutionLevels: [0, 0, null] });
    assert.equal(row.a, null, "助战位发 null ⇒ 客户端渲染空框");
    assert.equal(row.b, "character/maou2_playable/ui/thumb_party_unison_0",
        "同一行里的正常角色不受牵连,槽位也不许左移");
    assert.equal(row.c, null);
});

test("三个槽位恒发且不许左移", () => {
    const row = toNativeRankRow(record({ characterIds: [null, 169995, null] }), 1,
        { evolutionLevels: [null, 0, null] });
    assert.equal(NATIVE_ROW_SLOTS, 3);
    assert.equal(row.a, null, "1 号位空必须显式发 null,否则复用 cell 会留残影");
    assert.equal(row.b, "character/maou2_playable/ui/thumb_party_unison_0",
        "2 号位不许左移到 1 号位");
    assert.equal(row.c, null);
});

test("WF_RUSH_RANK_NATIVE_ICONS=0 时整屏不发头像路径", () => {
    const previous = process.env.WF_RUSH_RANK_NATIVE_ICONS;
    process.env.WF_RUSH_RANK_NATIVE_ICONS = "0";
    try {
        const row = toNativeRankRow(record(), 1);
        assert.deepEqual([row.a, row.b, row.c], [null, null, null]);
        // 文本列不受影响 —— 关的只是头像
        assert.equal(row.rank, "1位");
    } finally {
        if (previous === undefined) delete process.env.WF_RUSH_RANK_NATIVE_ICONS;
        else process.env.WF_RUSH_RANK_NATIVE_ICONS = previous;
    }
});

// ────────────────────────────────────────────────────────────────
// 三个头像画谁:facets.mains(个人资料编队)优先,缺省退回成绩快照
// ────────────────────────────────────────────────────────────────

test("facets.mains 命中时头像走编队,而不是成绩快照", () => {
    // 快照是 129999/169995/149995;编队换成另外三个人 ⇒ 三个头像必须全跟着换。
    // 删掉 toNativeRankRow 里的 `facets.mains ?? record.characterIds` 这条会立刻红。
    const row = toNativeRankRow(record(), 1, {
        mains: [169995, null, 129999],
        evolutionLevels: [1, null, 0]
    });
    assert.equal(row.a, "character/maou2_playable/ui/thumb_party_unison_1",
        "编队主位 1 + 它自己的立绘等级");
    assert.equal(row.b, null, "编队 2 号位是空的就发 null,不许拿快照来填");
    assert.ok(row.c !== null && row.c.endsWith("/ui/thumb_party_unison_0"));
    assert.notEqual(row.c, row.a);
});

test("facets 缺省时整行退回成绩快照(旧行为)", () => {
    const row = toNativeRankRow(record({ characterIds: [169995, null, null] }), 1);
    assert.equal(row.a, "character/maou2_playable/ui/thumb_party_unison_0");
    assert.deepEqual([row.b, row.c], [null, null]);
});

test("facets.userRank 直接用,不再逐行现查存档", () => {
    // 批量取数时玩家等级已经算好了。这条断言保证 toNativeRankRow 不会绕过它
    // 又去 getPlayerSync —— 那正是每行第 7 次查询的来源。
    const row = toNativeRankRow(record({ playerExists: true }), 1, { userRank: 169 });
    assert.equal(row.level, "RANK169");
});

test("facets.mains 里的助战角色照样降级成空框", () => {
    // 编队来源不构成「已经安全」的理由:资料页的编队里实测就有 700016。
    const row = toNativeRankRow(record(), 1, { mains: [700016, 169995, null] });
    assert.equal(row.a, null, "助战段必须在这一层也被拦掉,否则真机弹「数据不足」");
    assert.equal(row.b, "character/maou2_playable/ui/thumb_party_unison_0");
});

// ────────────────────────────────────────────────────────────────
// P4/S5:点一行看那个玩家的资料 —— 行上的 `id`
// ────────────────────────────────────────────────────────────────

test("行的 id 是「个人资料目标 ID」,和真 viewer_id 不撞区间", () => {
    const row = toNativeRankRow(record({ playerExists: true }), 1);
    assert.equal(row.id, RUSH_PROFILE_ID_BASE + 8);
    assert.equal(fromProfileTargetId(row.id), 8, "服务端要能原样解回存档 id");
    // 真 viewer_id 是 9 位数(generateViewerId),必须落在基数之下,
    // 否则 profile/get_profile 会把别人的 viewer_id 当成存档 id
    assert.ok(306205655 < RUSH_PROFILE_ID_BASE);
    assert.equal(fromProfileTargetId(306205655), null);
});

test("存档已删的行发 id=0(客户端据此把行做成不可点)", () => {
    const row = toNativeRankRow(record({ playerExists: false }), 1);
    assert.equal(row.id, 0, "点了会吃 404 的行不许可点");
    assert.equal(toProfileTargetId(0), 0);
    assert.equal(toProfileTargetId(-1), 0);
});
