/**
 * 「点榜上某一行 → 个人资料页」的编队投影单测(P4/S5,20260828 复核补)。
 *
 * 存在的理由是一条**真的会崩的路**:客户端
 * `OtherProfileLogic.getLeaderFullShotImageId`(`OtherProfileLogic.as:308-323`)
 * 在 `favorite_character.character_ids[0]` 为 `Option.None` 时直接
 * `throw "No Value(...)"`,而 `PlayerProfileView.registerButtons` 的
 * `ProfileKind.Other` 三条 follow_state 分支(`:640/:701/:826`)**全都**无条件
 * 调用 `replaceLeaderFullshot()` → 那个 getter。
 *
 * 现场证据:榜上第 2 行「艾利西弗」选中那一队的主位 1 是助战角色 **700016**
 * (700000..700099 段),`isShippableCharacterId` 拒发 ⇒ 槽 0 空 ⇒ 点那一行必崩。
 *
 * 所以本文件第一条断言就是「槽 0 永远非 null」。删掉兜底逻辑必须变红。
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
    buildProfileFavoriteParty,
    PROFILE_PARTY_SLOTS,
} = require("../lib/rush-profile-party") as typeof import("../lib/rush-profile-party");

const { isShippableCharacterId } =
    require("../lib/rush-leaderboard-ranking") as typeof import("../lib/rush-leaderboard-ranking");

// 真表里的角色 —— 用 live 榜上真出现过的三个,免得断言建立在假设上。
const A = 149995
const B = 141177
const C = 141123
// 助战段:不可下发(客户端 GeneralCharacterLogic 会抛 ClientError 8013)。
const SUPPORT = 700016
// 主表里不存在。
const UNKNOWN = 999999999

test("前提:测试用的角色 ID 判据和生产同源", () => {
    for (const id of [A, B, C]) {
        assert.equal(isShippableCharacterId(id), true, `${id} 应当可下发`);
    }
    assert.equal(isShippableCharacterId(SUPPORT), false, "助战段必须拒发");
    assert.equal(isShippableCharacterId(UNKNOWN), false, "主表没有的 ID 必须拒发");
    assert.equal(isShippableCharacterId(null), false);
});

test("主位 1 可下发:原样发,槽位一个不动", () => {
    const out = buildProfileFavoriteParty({ mains: [A, B, C], unisons: [C, null, A] });
    assert.notEqual(out, null);
    assert.deepEqual(out!.mains, [A, B, C]);
    assert.deepEqual(out!.unisons, [C, null, A]);
    assert.equal(out!.source, "party");
});

test("不认识的 ID 仍然降级成空位(ClientError 8013 那条防线没被削)", () => {
    const out = buildProfileFavoriteParty({ mains: [A, UNKNOWN, SUPPORT], unisons: [null, null, null] });
    assert.deepEqual(out!.mains, [A, null, null]);
    assert.equal(out!.source, "party");
});

test("主位 1 是助战角色:成对左压缩,槽 0 不再为空", () => {
    // 这就是「艾利西弗」那一行的形状。
    const out = buildProfileFavoriteParty({ mains: [SUPPORT, B, C], unisons: [A, C, null] });
    assert.notEqual(out, null);
    assert.notEqual(out!.mains[0], null, "槽 0 为 null = 点那一行必崩");
    assert.deepEqual(out!.mains, [B, C, null]);
    // 合击位必须跟着它的主位一起搬:B 的合击是 C,C 的合击是 null。
    // 单独压主位会把 SUPPORT 的合击 A 安到 B 头上 —— 那是另一支队伍。
    assert.deepEqual(out!.unisons, [C, null, null]);
    assert.equal(out!.source, "party-compacted");
});

test("整队一个可下发主位都没有:退回该存档的队长角色", () => {
    const out = buildProfileFavoriteParty({
        mains: [SUPPORT, UNKNOWN, null],
        unisons: [null, null, null],
        leaderCharacterId: A
    });
    assert.deepEqual(out!.mains, [A, null, null]);
    assert.deepEqual(out!.unisons, [null, null, null], "兜底时不发一支假队伍");
    assert.equal(out!.source, "leader");
});

test("连队长角色都不可下发:退回已拥有角色里 ID 最小的那一个(要确定性)", () => {
    const input = {
        mains: [null, null, null],
        unisons: [null, null, null],
        leaderCharacterId: SUPPORT,
        ownedCharacterIds: [C, A, B, UNKNOWN]
    };
    const first = buildProfileFavoriteParty(input);
    const second = buildProfileFavoriteParty(input);
    const smallest = [A, B, C].sort((x, y) => x - y)[0];
    assert.equal(first!.mains[0], smallest);
    // 同一次点击客户端可能重试;两次不同 = 排障时会当成随机崩。
    assert.deepEqual(second!.mains, first!.mains);
    assert.equal(first!.source, "owned");
});

test("一个可下发角色都没有:返回 null,由路由回 400(不发必抛的响应)", () => {
    const out = buildProfileFavoriteParty({
        mains: [SUPPORT, UNKNOWN, null],
        unisons: [UNKNOWN, null, null],
        leaderCharacterId: UNKNOWN,
        ownedCharacterIds: [UNKNOWN, SUPPORT]
    });
    assert.equal(out, null);
});

test("逃生门 leaderOnly:只发一个角色,而不是六个 null(旧语义会让每一行都崩)", () => {
    const out = buildProfileFavoriteParty({
        mains: [A, B, C], unisons: [C, B, A], leaderOnly: true
    });
    assert.deepEqual(out!.mains, [A, null, null]);
    assert.deepEqual(out!.unisons, [null, null, null]);
    // 关键回归断言:逃生门也必须留下一个非空的槽 0。
    assert.notEqual(out!.mains[0], null);
});

test("逃生门 + 队伍全不可发:仍然沿三级兜底找到一个角色", () => {
    const out = buildProfileFavoriteParty({
        mains: [SUPPORT, null, null], unisons: [null, null, null],
        leaderCharacterId: B, leaderOnly: true
    });
    assert.equal(out!.mains[0], B);
});

test("槽位长度恒 3 —— 少一个/多一个客户端都按下标读", () => {
    const cases = [
        { mains: [A], unisons: [] },
        { mains: [A, B, C, A, B], unisons: [C, C, C, C] },
        { mains: [], unisons: [], leaderCharacterId: A },
    ];
    for (const input of cases) {
        const out = buildProfileFavoriteParty(input);
        assert.notEqual(out, null);
        assert.equal(out!.mains.length, PROFILE_PARTY_SLOTS);
        assert.equal(out!.unisons.length, PROFILE_PARTY_SLOTS);
        assert.notEqual(out!.mains[0], null);
    }
});

test("不变式:任何输入,要么返回 null,要么槽 0 非 null", () => {
    const pool: (number | null)[] = [A, B, C, SUPPORT, UNKNOWN, null];
    let checked = 0;
    for (const m0 of pool) for (const m1 of pool) for (const m2 of pool) {
        for (const leader of [A, SUPPORT, null]) {
            const out = buildProfileFavoriteParty({
                mains: [m0, m1, m2],
                unisons: [UNKNOWN, C, null],
                leaderCharacterId: leader
            });
            checked++;
            if (out === null) continue;
            assert.notEqual(out.mains[0], null,
                `mains=[${m0},${m1},${m2}] leader=${leader} 槽 0 为空 = 必崩`);
            assert.equal(isShippableCharacterId(out.mains[0]), true);
            for (const id of [...out.mains, ...out.unisons]) {
                if (id !== null) assert.equal(isShippableCharacterId(id), true);
            }
        }
    }
    assert.equal(checked, 6 * 6 * 6 * 3);
});
