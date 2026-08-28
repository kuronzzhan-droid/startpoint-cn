/**
 * 「报酬一览」预览数据的单测(P4/S5)。
 *
 * 断言重点是**错了作者会看到假奖励**或**真机会弹「数据不足」**的那几处:
 *  · 预览必须从结算档位投影出来,不许自带一份展示表 —— 两处分叉 = 页面骗人;
 *  · 只发称号不发道具是合法配置,不能被当成「未配置」;
 *  · 铭牌图路径必须**带 `.png`**(客户端 `RichTextImageLoader.resolveSource`
 *    砍扩展名、`FileReader.readTextureFile` 再补 `.png`,store 键就是带 `.png`
 *    的那一个,已用 sha1+SALT 对 `.cdn` 实测);
 *  · 道具图标默认**不发** —— 单枚道具图标是共享图集的子纹理,没有独立文件,
 *    硬发会走 `SectionCommand.FileNotFound` 弹「数据不足」拉去重下资源。
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
    clearRushRewardNameCache,
    rankRangeLabel,
    toRewardPreviewTiers,
} = require("../lib/rush-reward-preview") as typeof import("../lib/rush-reward-preview");

const {
    matchRewardTier,
    planRewardMails,
    defaultRushSettlementConfig,
    normalizeRewardTiers,
    validateRewardTiers,
} = require("../lib/rush-settlement") as typeof import("../lib/rush-settlement");

import type { RushRewardTier } from "../lib/rush-settlement";

const LIVE_TIERS: RushRewardTier[] = [
    { fromRank: 1, toRank: 1, itemId: 999015, count: 10, degreeId: 9900001 },
    { fromRank: 2, toRank: 3, itemId: 999015, count: 5, degreeId: null },
    { fromRank: 4, toRank: 10, itemId: 999015, count: 2, degreeId: null }
]

test("名次区间标签", () => {
    assert.equal(rankRangeLabel(1, 1), "第 1 名");
    assert.equal(rankRangeLabel(2, 3), "第 2 ~ 3 名");
    assert.equal(rankRangeLabel(16, null), "第 16 名起（到榜尾）");
});

test("null 尾档预览保留 null 并明确显示到榜尾", () => {
    const [tail] = toRewardPreviewTiers([
        { fromRank: 16, toRank: null, itemId: null, count: 1, degreeId: 9900005 },
    ]);
    assert.equal(tail!.toRank, null);
    assert.equal(tail!.rankLabel, "第 16 名起（到榜尾）");
});

test("预览逐档对齐结算档位,数量就是结算真的会发的数量", () => {
    clearRushRewardNameCache();
    const tiers = toRewardPreviewTiers(LIVE_TIERS);
    assert.equal(tiers.length, 3);
    assert.deepEqual(tiers.map(t => [t.rankLabel, t.itemCount]),
        [["第 1 名", 10], ["第 2 ~ 3 名", 5], ["第 4 ~ 10 名", 2]]);
    assert.ok(tiers.every(t => t.itemId === 999015));
    assert.ok(tiers.every(t => !t.unconfigured));
});

test("999015 有名字(它不在官方 item_lookup.json 里,靠本模块的覆盖表)", () => {
    clearRushRewardNameCache();
    const [first] = toRewardPreviewTiers(LIVE_TIERS);
    assert.equal(first!.itemName, "终焉裁定券",
        "显示成「道具 #999015」等于作者看不出发的是什么");
});

test("配了称号就带铭牌名和铭牌图,路径带 .png", () => {
    clearRushRewardNameCache();
    const [first, second] = toRewardPreviewTiers(LIVE_TIERS);
    assert.equal(first!.degreeId, 9900001);
    assert.equal(first!.degreeName, "断轮的原勇者");
    assert.equal(first!.degreeImage, "dynamic/degree/degree_mod_broken_wheel_hero.png");
    assert.ok(first!.degreeImage!.endsWith(".png"),
        "少了 .png 就是另一个 store 键,铭牌加载不出来");
    assert.equal(second!.degreeId, null, "没配称号的档不许凭空长出称号");
    assert.equal(second!.degreeImage, null);
});

test("新建默认四枚赛季称号有固定名字与完整 png 逻辑路径", () => {
    const previous = process.env.WF_RUSH_RANK_DEGREES;
    delete process.env.WF_RUSH_RANK_DEGREES;
    try {
        const tiers = toRewardPreviewTiers(
            defaultRushSettlementConfig(700099, 1, 0).rewardTiers);
        assert.deepEqual(tiers.map(tier => [tier.degreeId, tier.degreeName, tier.degreeImage]), [
            [9900002, "深渊冠军", "dynamic/degree/degree_mod_abyss_rush_champion.png"],
            [9900003, "深渊亚季军", "dynamic/degree/degree_mod_abyss_rush_runner_up.png"],
            [9900004, "深渊上位者", "dynamic/degree/degree_mod_abyss_rush_upper_rank.png"],
            [9900005, "深渊参与者", "dynamic/degree/degree_mod_abyss_rush_participant.png"],
        ]);
        for (const tier of tiers) {
            assert.ok(tier.degreeImage?.endsWith(".png"), "客户端需要带 .png 的完整逻辑路径");
            assert.ok(!tier.degreeImage?.includes(String(tier.degreeId)),
                "degree 数字 id 不能冒充客户端资源路径");
        }
    } finally {
        if (previous === undefined) delete process.env.WF_RUSH_RANK_DEGREES;
        else process.env.WF_RUSH_RANK_DEGREES = previous;
    }
});

test("WF_RUSH_RANK_DEGREES 仍可覆盖内置称号登记", () => {
    const previous = process.env.WF_RUSH_RANK_DEGREES;
    process.env.WF_RUSH_RANK_DEGREES = JSON.stringify({
        9900002: { name: "自定义冠军", image: "dynamic/degree/custom_champion.png" },
    });
    try {
        const [champion] = toRewardPreviewTiers([
            { fromRank: 1, toRank: 1, itemId: null, count: 1, degreeId: 9900002 },
        ]);
        assert.equal(champion!.degreeName, "自定义冠军");
        assert.equal(champion!.degreeImage, "dynamic/degree/custom_champion.png");
    } finally {
        if (previous === undefined) delete process.env.WF_RUSH_RANK_DEGREES;
        else process.env.WF_RUSH_RANK_DEGREES = previous;
    }
});

test("道具图标默认不发(共享图集子纹理没有独立文件)", () => {
    clearRushRewardNameCache();
    delete process.env.WF_RUSH_RANK_REWARD_ITEM_ICON;
    assert.ok(toRewardPreviewTiers(LIVE_TIERS).every(t => t.itemIcon === null));
});

test("环境变量可以打开道具图标(出事时删掉即可,不用回滚 APK)", () => {
    clearRushRewardNameCache();
    process.env.WF_RUSH_RANK_REWARD_ITEM_ICON = "item/sprite_sheet/spends/tickets/x";
    try {
        const [first] = toRewardPreviewTiers(LIVE_TIERS);
        assert.equal(first!.itemIcon, "item/sprite_sheet/spends/tickets/x");
    } finally {
        delete process.env.WF_RUSH_RANK_REWARD_ITEM_ICON;
        clearRushRewardNameCache();
    }
});

test("两头都空才叫「未配置」", () => {
    clearRushRewardNameCache();
    const tiers = toRewardPreviewTiers([
        { fromRank: 1, toRank: 1, itemId: null, count: 0, degreeId: 9900001 },
        { fromRank: 2, toRank: 2, itemId: null, count: 5, degreeId: null }
    ]);
    assert.equal(tiers[0]!.unconfigured, false, "只发称号是合法配置");
    assert.equal(tiers[0]!.degreeName, "断轮的原勇者");
    assert.equal(tiers[1]!.unconfigured, true, "既没道具也没称号才是未配置");
});

// ────────────────────────────────────────────────────────────────
// 发奖计划:称号走 players_degrees,不走邮件
// ────────────────────────────────────────────────────────────────

test("发奖计划把称号和道具分开:道具进邮件,称号进拥有集合", () => {
    const config = { ...defaultRushSettlementConfig(700099, 1, 0), rewardTiers: LIVE_TIERS };
    const rows = [1, 2, 3, 4, 11].map(rank => ({ rank, playerId: 100 + rank }));
    const plan = planRewardMails(rows, config);

    assert.deepEqual(plan.mails.map(m => [m.rank, m.itemId, m.count]),
        [[1, 999015, 10], [2, 999015, 5], [3, 999015, 5], [4, 999015, 2]],
        "第 11 名在 rewardRankLimit=10 之外,不该发");
    assert.deepEqual(plan.degrees, [{ rank: 1, playerId: 101, degreeId: 9900001 }],
        "只有第 1 名拿称号");
    assert.deepEqual(plan.skippedUnconfigured, []);
});

test("只配称号的档不会被算成「奖励未配置」而跳过", () => {
    const config = {
        ...defaultRushSettlementConfig(700099, 1, 0),
        rewardTiers: [{ fromRank: 1, toRank: 1, itemId: null, count: 0, degreeId: 9900001 }]
    };
    const plan = planRewardMails([{ rank: 1, playerId: 8 }], config);
    assert.equal(plan.mails.length, 0);
    assert.deepEqual(plan.degrees, [{ rank: 1, playerId: 8, degreeId: 9900001 }]);
    assert.deepEqual(plan.skippedUnconfigured, []);
});

test("档位校验与规整认得 degreeId", () => {
    assert.deepEqual(validateRewardTiers([
        { fromRank: 1, toRank: 1, itemId: 1, count: 1, degreeId: 0 }
    ]), ["第 1 档: degreeId 必须是 ≥1 的整数,或留空表示不发称号"]);

    assert.deepEqual(validateRewardTiers([
        { fromRank: 1, toRank: 1, itemId: null, count: 1, degreeId: 9900001 }
    ]), []);

    const normalized = normalizeRewardTiers([
        { fromRank: 1, toRank: 2, itemId: "999015", count: "3", degreeId: "9900001" },
        { fromRank: 3, toRank: 4, itemId: null, count: 1 }
    ]);
    assert.deepEqual(normalized, [
        { fromRank: 1, toRank: 2, itemId: 999015, count: 3, degreeId: 9900001 },
        { fromRank: 3, toRank: 4, itemId: null, count: 1, degreeId: null }
    ]);
});

test("档位重叠时第一条命中的生效(配置顺序即优先级)", () => {
    assert.equal(matchRewardTier(LIVE_TIERS, 1)!.count, 10);
    assert.equal(matchRewardTier(LIVE_TIERS, 3)!.count, 5);
    assert.equal(matchRewardTier(LIVE_TIERS, 10)!.count, 2);
    assert.equal(matchRewardTier(LIVE_TIERS, 11), null);
});
