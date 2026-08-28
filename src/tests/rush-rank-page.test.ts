/**
 * 深渊连战排行榜「全屏富文本页」(`tool/agreement` 的正文)的单测。
 *
 * 只测纯函数(排版 / 转义 / 分节),接数据库那一半由
 * `rush-leaderboard.test.ts` 与 `rush-ranking-contract.test.ts` 覆盖。
 *
 * 断言的重点仍然是**客户端会静默吞内容或直接抛错的那几处**
 * (解析器与 CSS 和公告版同源,见 `rush-leaderboard-agreement.ts` 顶部):
 *   · `<th>` 不许出现 —— `RichTextLayoutTr.createBlock` 只认 `Td`,`Th` 落进空分支;
 *   · `<td>` 必须包在 `<tr>` 里、`<tr>` 必须包在 `<table>` 里,层级错了整块消失;
 *   · 玩家名里的 `<` `>` `&` `"` `'` 必须被换掉,否则 `flash.Xml.parse` 抛
 *     ClientError 7613,**整页白**;
 *   · 正文必须是配平的 XML;
 *   · **两张榜必须同页**且各自有自身名次卡 —— 这条通道没有 page / tab 参数,
 *     分页就等于把第二张榜彻底丢掉。
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
    RUSH_RANK_PAGE_DEFAULT_ROWS,
    buildRushRankPageFallbackHtml,
    buildRushRankPageHtml,
    rankUpdateTimeMs,
} = require("../lib/rush-leaderboard-agreement") as typeof import("../lib/rush-leaderboard-agreement");

const { setServerTimeOffset } =
    require("../utils") as typeof import("../utils");

import type { RushRankPageBoard, RushRankPageInput } from "../lib/rush-leaderboard-agreement";
import type { RushNewsRow } from "../lib/rush-leaderboard-news";
import type { RushRewardPreview, RushRewardPreviewTier } from "../lib/rush-reward-preview";

function rewardTier(overrides: Partial<RushRewardPreviewTier> = {}): RushRewardPreviewTier {
    return {
        fromRank: 1,
        toRank: 1,
        rankLabel: "第 1 名",
        itemId: 999015,
        itemName: "终焉裁定券",
        itemCount: 10,
        itemIcon: null,
        degreeId: null,
        degreeName: null,
        degreeImage: null,
        unconfigured: false,
        ...overrides
    }
}

function rewardOf(tiers: RushRewardPreviewTier[], rankLimit = 10): RushRewardPreview {
    return { board: "full-run", rankLimit, tiers }
}

function row(overrides: Partial<RushNewsRow> = {}): RushNewsRow {
    return {
        rankNumber: 1,
        playerName: "浅羽",
        userRank: 169,
        bestRound: 30,
        elapsedMs: 439160,
        season: 1,
        isViewer: false,
        thumbnails: [],
        ...overrides
    }
}

function boardOf(overrides: Partial<RushRankPageBoard> = {}): RushRankPageBoard {
    return {
        boardTitle: "战斗用时榜",
        caption: "口径说明",
        rows: [row()],
        myRow: null,
        showSeason: false,
        total: 1,
        ...overrides
    }
}

function pageOf(overrides: Partial<RushRankPageInput> = {}): RushRankPageInput {
    return {
        updatedAt: "2026.08.27 14:00",
        boards: [
            boardOf(),
            boardOf({ boardTitle: "当期首通榜", showSeason: true })
        ],
        season: 2,
        reward: null,
        maxRows: RUSH_RANK_PAGE_DEFAULT_ROWS,
        ...overrides
    }
}

/**
 * 粗粒度的标签配平检查 —— 客户端用的是严格 XML 解析器,
 * 标签没闭合会让整页抛 ClientError 7613。
 *
 * @param html 待检查的富文本。
 */
function assertBalancedXml(html: string): void {
    const stack: string[] = []
    const tag = /<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/gi
    let match: RegExpExecArray | null
    while ((match = tag.exec(html)) !== null) {
        const [, closing, name, , selfClosing] = match
        if (selfClosing === "/") continue
        if (closing === "/") {
            assert.equal(stack.pop(), name, `unbalanced </${name}> in: ${html.slice(0, 200)}`)
        } else {
            stack.push(name!)
        }
    }
    assert.deepEqual(stack, [], "unclosed tags remain")
}

test("整页是一个合法的 html/body/container 结构", () => {
    const html = buildRushRankPageHtml(pageOf())
    assert.ok(html.startsWith(`<html lang="zh"><body class="body"><div class="container">`))
    assert.ok(html.endsWith(`</div></body></html>`))
    assertBalancedXml(html)
})

test("两张榜同页,用 <hr/> 分节,各自带自身名次卡", () => {
    const html = buildRushRankPageHtml(pageOf())

    // 这条通道没有 page / tab 参数,第二张榜要么在这一页上,要么就永远看不到。
    assert.ok(html.includes("<h2>战斗用时榜</h2>"), "第一张榜的小节标题丢了")
    assert.ok(html.includes("<h2>当期首通榜</h2>"), "第二张榜的小节标题丢了")

    const first = html.indexOf("<h2>战斗用时榜</h2>")
    const second = html.indexOf("<h2>当期首通榜</h2>")
    assert.ok(first < second, "榜的顺序反了")
    assert.ok(html.slice(first, second).includes("<hr/>"), "两张榜之间没有分节线")

    // 每张榜各一张自身名次卡。
    const selfCards = html.split("<p><b>自身名次</b></p>").length - 1
    assert.equal(selfCards, 2, "自身名次卡不是每张榜一张")
})

test("没上榜时自身名次卡是官方文案「排名外」", () => {
    const html = buildRushRankPageHtml(pageOf({ boards: [boardOf({ myRow: null })] }))
    assert.ok(html.includes("排名外"), "myRow 为 null 时应当渲染官方的「排名外」")
})

test("自身那一行走 .strong 橙色高亮", () => {
    const mine = row({ playerName: "zzhan", isViewer: true, rankNumber: 3 })
    const html = buildRushRankPageHtml(pageOf({
        boards: [boardOf({ rows: [mine], myRow: mine, total: 1 })]
    }))
    assert.ok(html.includes(`<font color="#ff9f1c">3位</font>`), "名次没高亮")
    assert.ok(html.includes(`<font color="#ff9f1c">RANK169　zzhan</font>`), "玩家行没高亮")
})

test("行文案逐字沿用官方 ui_string 模板", () => {
    const html = buildRushRankPageHtml(pageOf({ boards: [boardOf()] }))
    // rush_event_ranking_ranking_rank / player_rank / best_record / time
    assert.ok(html.includes("1位"))
    assert.ok(html.includes("RANK169　浅羽"))
    assert.ok(html.includes("BEST RECORD: 30战"))
    assert.ok(html.includes("TIME: 07:19.16"))
    assert.ok(html.includes("2026.08.27 14:00更新"))
})

test("首通榜带期号,用时榜不带", () => {
    const withSeason = buildRushRankPageHtml(pageOf({
        boards: [boardOf({ showSeason: true, rows: [row({ season: 7 })] })]
    }))
    assert.ok(withSeason.includes("第 7 期"), "首通榜应当在行里带期号")

    const withoutSeason = buildRushRankPageHtml(pageOf({
        boards: [boardOf({ showSeason: false, rows: [row({ season: 7 })] })],
        season: null
    }))
    assert.ok(!withoutSeason.includes("第 7 期"), "用时榜不该在行里带期号")
})

test("表格里不许出现 <th> —— 客户端只认 <td>", () => {
    const html = buildRushRankPageHtml(pageOf())
    assert.ok(!/<th[\s>]/i.test(html), "<th> 会被 RichTextLayoutTr 整格丢掉")
})

test("<td> 只出现在 <tr> 里,<tr> 只出现在 <table> 里", () => {
    const html = buildRushRankPageHtml(pageOf())
    const tag = /<(\/?)(table|tr|td)[^>]*>/gi
    const stack: string[] = []
    let match: RegExpExecArray | null
    while ((match = tag.exec(html)) !== null) {
        const [, closing, name] = match
        if (closing === "/") { stack.pop(); continue }
        if (name === "tr") assert.equal(stack[stack.length - 1], "table", "<tr> 不在 <table> 里")
        if (name === "td") assert.equal(stack[stack.length - 1], "tr", "<td> 不在 <tr> 里")
        stack.push(name!)
    }
})

test("玩家名里的 XML 元字符被换成全角替身(不换 = 整页白)", () => {
    const hostile = row({ playerName: `</p></td></tr></table><b>&"'` })
    const html = buildRushRankPageHtml(pageOf({
        boards: [boardOf({ rows: [hostile], myRow: hostile, total: 1 })]
    }))
    assert.ok(html.includes("＜/p＞＜/td＞"), "尖括号没被换掉")
    assert.ok(html.includes("＆"), "& 没被换掉")
    assertBalancedXml(html)
})

test("空榜给占位文案而不是空白", () => {
    const html = buildRushRankPageHtml(pageOf({
        boards: [boardOf({ rows: [], myRow: null, total: 0 })]
    }))
    assert.ok(html.includes("暂无记录"))
    assert.ok(!html.includes("<table></table>"), "空榜不该留一个空表格")
    assertBalancedXml(html)
})

test("超过 maxRows 就截断,并写「显示 1 ~ N / 共 M 件」", () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({ rankNumber: i + 1 }))
    const html = buildRushRankPageHtml(pageOf({
        boards: [boardOf({ rows, myRow: null, total: 7 })],
        maxRows: 3
    }))
    assert.ok(html.includes("显示 1 ~ 3 / 共 7 件"))
    // 3 行名次 + 1 行「排名外」自身名次卡
    assert.equal(html.split("<tr>").length - 1, 4, "截断后行数不对")
    assert.ok(!html.includes("4位"), "被截断的行不该出现")
})

test("全部列完只写总数", () => {
    const html = buildRushRankPageHtml(pageOf({
        boards: [boardOf({ rows: [row()], total: 1 })]
    }))
    assert.ok(html.includes("共 1 件"))
    assert.ok(!html.includes("显示 1 ~"))
})

test("报酬一览整页只渲染一次,并跟一条名次上限说明", () => {
    const html = buildRushRankPageHtml(pageOf({
        reward: rewardOf([
            rewardTier(),
            rewardTier({ fromRank: 2, toRank: 3, rankLabel: "第 2 ~ 3 名", itemCount: 5 })
        ])
    }))
    assert.equal(html.split("<h2>报酬一览</h2>").length - 1, 1, "报酬一览重复了")
    assert.ok(html.includes("<b>第 1 名</b>"))
    assert.ok(html.includes("终焉裁定券 ×10"))
    assert.ok(html.includes("<b>第 2 ~ 3 名</b>"))
    assert.ok(html.includes("终焉裁定券 ×5"))
    assert.ok(html.includes("发到第 10 名为止"))
})

test("报酬一览:null 尾档说明不得还声称只发到前 15 名", () => {
    const html = buildRushRankPageHtml(pageOf({
        reward: rewardOf([
            rewardTier({ fromRank: 4, toRank: 15, rankLabel: "第 4 ~ 15 名" }),
            rewardTier({
                fromRank: 16,
                toRank: null,
                rankLabel: "第 16 名起（到榜尾）",
                itemId: null,
                itemName: null,
                itemCount: 0,
                degreeId: 9900005,
                degreeName: "深渊参与者",
                degreeImage: "dynamic/degree/degree_mod_abyss_rush_participant.png",
            }),
        ], 15),
    }))

    assert.ok(html.includes("第 16 名起（到榜尾）"))
    assert.ok(html.includes("到榜尾档覆盖其余所有完整成绩"))
    assert.ok(!html.includes("发到第 15 名为止"))
    assert.ok(!html.includes("前 15 名就是 15 个不同的存档"))
})

test("报酬一览:配了称号就出铭牌图,路径带 .png(客户端会砍扩展名再补 .png)", () => {
    const html = buildRushRankPageHtml(pageOf({
        reward: rewardOf([rewardTier({
            degreeId: 9900001,
            degreeName: "断轮的原勇者",
            degreeImage: "dynamic/degree/degree_mod_broken_wheel_hero.png"
        })])
    }))
    assert.ok(html.includes("称号　断轮的原勇者"))
    assert.ok(html.includes('<img src="file://dynamic/degree/degree_mod_broken_wheel_hero.png"'))
    assertBalancedXml(html)
})

test("报酬一览:道具图标默认不发(共享图集子纹理没有独立文件,会弹「数据不足」)", () => {
    const html = buildRushRankPageHtml(pageOf({ reward: rewardOf([rewardTier()]) }))
    assert.ok(!html.includes("<img"), "默认不该出现任何道具图")
})

test("报酬一览:未配置的档位标红而不是假装有奖", () => {
    const html = buildRushRankPageHtml(pageOf({
        reward: rewardOf([rewardTier({
            itemId: null, itemName: null, itemCount: 0, unconfigured: true
        })])
    }))
    assert.ok(html.includes("奖励未配置"))
})

test("没有报酬配置就整节不出现", () => {
    const html = buildRushRankPageHtml(pageOf({ reward: null }))
    assert.ok(!html.includes("报酬一览"))
})

test("期号为 null 时不写「当前第 N 期」", () => {
    const html = buildRushRankPageHtml(pageOf({ season: null }))
    assert.ok(!html.includes("当前第"))
})

test("兜底正文也是合法的富文本(terms_text 不许发空/发 null 以外的坏值)", () => {
    const html = buildRushRankPageFallbackHtml()
    assert.equal(typeof html, "string")
    assert.ok(html.length > 0)
    assert.ok(html.startsWith("<html"))
    assertBalancedXml(html)
})

test("正文只用客户端解析器认识的标签", () => {
    // RichTextLayoutParser 支持集(:98-195):a br div h1 h2 h3 hr img li ol p table th tr td ul
    const supported = new Set([
        "a", "br", "div", "h1", "h2", "h3", "hr", "img", "li", "ol", "p",
        "table", "th", "tr", "td", "ul",
        // <p>/<h*> 的正文最终喂给 Starling 的 isHtmlText 文本域,行内标记走这两个
        "b", "font",
        // 外壳
        "html", "body"
    ])
    const html = buildRushRankPageHtml(pageOf({
        reward: rewardOf([rewardTier({
            degreeId: 9900001,
            degreeName: "断轮的原勇者",
            degreeImage: "dynamic/degree/degree_mod_broken_wheel_hero.png"
        })], 5)
    }))
    const tag = /<\/?([a-z0-9]+)/gi
    let match: RegExpExecArray | null
    while ((match = tag.exec(html)) !== null) {
        assert.ok(supported.has(match[1]!.toLowerCase()), `不支持的标签 <${match[1]}>`)
    }
})

// ────────────────────────────────────────────────────────────────
// P4/S4:「自身名次」圆钮跳页
// ────────────────────────────────────────────────────────────────

const {
    NATIVE_PAGE_SIZE,
    nativeViewerPageIndex,
    nativeViewerRowIndex,
} = require("../lib/rush-leaderboard-agreement") as typeof import("../lib/rush-leaderboard-agreement");

test("页大小必须和客户端补丁里的那条 pushint 同值", () => {
    // 改这个数就要同改 client-patch/rank-p4-native/patch_rank_native.py 的 PAGE_SIZE,
    // 否则「自身名次」钮跳错页,而且真机上不会有任何报错。
    assert.equal(NATIVE_PAGE_SIZE, 100);
});

test("自身名次页号按 0 起算,边界不越页", () => {
    assert.equal(nativeViewerPageIndex(1, 200), 0);
    assert.equal(nativeViewerPageIndex(100, 200), 0, "第 100 名还在第 0 页");
    assert.equal(nativeViewerPageIndex(101, 200), 1, "第 101 名才翻到第 1 页");
    assert.equal(nativeViewerPageIndex(200, 200), 1);
});

test("名次排在截断之外时钳到最后一页,不发越界页号", () => {
    // 榜只下发了 60 行(NATIVE_ROWS_CAP 之外的行客户端根本没有),
    // 名次 4337 的人跳到第 0 页 —— 而不是第 43 页那种客户端填不满的空页。
    assert.equal(nativeViewerPageIndex(4337, 60), 0);
    assert.equal(nativeViewerPageIndex(4337, 200), 1);
});

test("认不出人 / 空榜一律退回第 0 页", () => {
    assert.equal(nativeViewerPageIndex(1, 0), 0);
    assert.equal(nativeViewerPageIndex(0, 100), 0);
    assert.equal(nativeViewerPageIndex(Number.NaN, 100), 0);
    assert.equal(nativeViewerPageIndex(-5, 100), 0);
});

test("原生行上限和取数上限 / 页大小三者自洽", () => {
    const { BOARD_FETCH_CAP } =
        require("../lib/rush-leaderboard-ranking") as typeof import("../lib/rush-leaderboard-ranking");
    const { NATIVE_ROWS_CAP } =
        require("../lib/rush-leaderboard-agreement") as typeof import("../lib/rush-leaderboard-agreement");
    // 取数那一层先封 500;下发上限不许比它大,否则这个数就是死的
    assert.ok(NATIVE_ROWS_CAP <= BOARD_FETCH_CAP,
        `NATIVE_ROWS_CAP=${NATIVE_ROWS_CAP} 超过了 BOARD_FETCH_CAP=${BOARD_FETCH_CAP}`);
    // 客户端按 NATIVE_PAGE_SIZE 分页,上限取整页 ⇒ 不会出现一页只填几行的尾页
    assert.equal(NATIVE_ROWS_CAP % NATIVE_PAGE_SIZE, 0,
        "上限必须是页大小的整数倍,否则最后一页永远填不满");
});

// ────────────────────────────────────────────────────────────────
// P4/S5:「自身名次」还要滚到**那一行**
// ────────────────────────────────────────────────────────────────

test("页内行号:第 1 名是第 0 行,跨页从头数", () => {
    assert.equal(nativeViewerRowIndex(1, 200), 0);
    assert.equal(nativeViewerRowIndex(100, 200), 99, "第 100 名是第 0 页的最后一行");
    assert.equal(nativeViewerRowIndex(101, 200), 0, "第 101 名是第 1 页的第 0 行");
    assert.equal(nativeViewerRowIndex(200, 200), 99);
});

test("没上榜 / 被截断掉的名次发 -1,而不是 0", () => {
    // 0 会被客户端理解成「滚到第一行」,和「排第 1」分不开;
    // -1 是明确的「什么都别做」。
    assert.equal(nativeViewerRowIndex(0, 100), -1);
    assert.equal(nativeViewerRowIndex(Number.NaN, 100), -1);
    assert.equal(nativeViewerRowIndex(1, 0), -1, "空榜");
    assert.equal(nativeViewerRowIndex(61, 60), -1, "名次在下发行数之外,那一行客户端没有");
    assert.equal(nativeViewerRowIndex(60, 60), 59, "刚好是最后一行则有效");
});

test("页号与行号同源:index = page * 页大小 + row", () => {
    for (const rank of [1, 2, 99, 100, 101, 150, 200]) {
        const page = nativeViewerPageIndex(rank, 200);
        const row = nativeViewerRowIndex(rank, 200);
        assert.equal(page * NATIVE_PAGE_SIZE + row, rank - 1,
            `名次 ${rank} 的页号/行号对不上全局下标`);
    }
});

// ── 20260828 复核补的两条 ────────────────────────────────────────────

test("报酬一览排在两张榜**前面** —— 那颗钮点进来第一眼就要看到奖励", () => {
    // S4/S5 之后这一页唯一的入口是名次列表底部的「报酬一览」圆钮:名次已经在
    // 原生列表里了,报酬排在榜后面等于要滚过上百行才看得见。
    const html = buildRushRankPageHtml(pageOf({
        reward: rewardOf([rewardTier()])
    }));
    const reward = html.indexOf("<h2>报酬一览</h2>");
    const firstBoard = html.indexOf("<h2>战斗用时榜</h2>");
    assert.ok(reward >= 0 && firstBoard >= 0);
    assert.ok(reward < firstBoard, "报酬一览排到榜后面去了");
    assert.ok(html.slice(reward, firstBoard).includes("<hr/>"), "报酬和榜之间没有分节线");
    assertBalancedXml(html);
});

test("「更新于」默认取真实墙钟,WF_RUSH_RANK_TIME_REAL=0 才退回服务器钟", () => {
    // 后台的时间控制把服务器钟钉在活动窗口里(实测下发 2025.08.02,而那天是
    // 2026.08.28),榜却是实时查库的 —— 印一个一年前的「更新」时刻会被当成 bug。
    // ⚠ 必须**真的把服务器钟推开**再断言:不设偏移时 getServerDate() == Date.now(),
    //   两条分支给出同一个数,断言就分不出对错(这条自检第一版就是这么假绿的)。
    const before = process.env.WF_RUSH_RANK_TIME_REAL;
    const OFFSET = -400 * 24 * 3600 * 1000;   // 服务器钟推到 400 天前
    try {
        setServerTimeOffset(OFFSET);
        const wall = Date.now();

        delete process.env.WF_RUSH_RANK_TIME_REAL;
        assert.ok(Math.abs(rankUpdateTimeMs() - wall) < 5000, "默认没走墙钟");

        process.env.WF_RUSH_RANK_TIME_REAL = "1";
        assert.ok(Math.abs(rankUpdateTimeMs() - wall) < 5000, "=1 也应当是墙钟");

        process.env.WF_RUSH_RANK_TIME_REAL = "0";
        assert.ok(Math.abs(rankUpdateTimeMs() - (wall + OFFSET)) < 5000,
            "=0 应当退回服务器钟");

        // 富文本页顶部那一行和顶部黑条必须同源,不许两处显示不同的时刻。
        delete process.env.WF_RUSH_RANK_TIME_REAL;
        assert.ok(Math.abs(rankUpdateTimeMs() - wall) < 5000);
    } finally {
        setServerTimeOffset(null);
        if (before === undefined) delete process.env.WF_RUSH_RANK_TIME_REAL;
        else process.env.WF_RUSH_RANK_TIME_REAL = before;
    }
});
