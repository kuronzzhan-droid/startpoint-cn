/**
 * 排行榜公告富文本生成器的单测。
 *
 * 只测纯函数(格式化 / 转义 / 排版),接数据库那一半不在这里 —— 它已经被
 * `rush-leaderboard.test.ts` 的存储层用例覆盖。
 *
 * 断言的重点是**客户端会静默吞内容或直接抛错的那几处**:
 *   · `<th>` 不许出现(`RichTextLayoutTr.createBlock` 只认 Td,Th 会被丢掉);
 *   · `<td>` 必须包在 `<tr>` 里、`<tr>` 必须包在 `<table>` 里;
 *   · 玩家名里的 `<` `>` `&` `"` `'` 必须被换掉,否则 `flash.Xml.parse` 抛
 *     ClientError 7613,**整条公告打不开**;
 *   · 生成的正文必须是**合法 XML**(用 Node 自带的解析器兜一遍)。
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
    buildRushBoardHtml,
    formatRushTime,
    formatRushUpdateTime,
    sanitizeRichText,
    toNewsRow,
} = require("../lib/rush-leaderboard-news") as typeof import("../lib/rush-leaderboard-news");

import type { RushNewsRow, RushNewsBoardInput } from "../lib/rush-leaderboard-news";
import type { RushRunRecord } from "../data/domains/rushLeaderboard";

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

function board(overrides: Partial<RushNewsBoardInput> = {}): RushNewsBoardInput {
    return {
        boardTitle: "战斗用时榜",
        caption: "口径说明",
        rows: [row()],
        myRow: null,
        showSeason: false,
        updatedAt: "2026.08.27 15:30",
        season: 1,
        total: 1,
        rewardTiers: [],
        rewardRankLimit: 10,
        ...overrides
    }
}

/**
 * 粗粒度的标签配平检查 —— 客户端用的是严格 XML 解析器,
 * 标签没闭合会让整条公告抛 ClientError 7613。
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

test("formatRushTime 输出官方秒表格式 MM:SS.FF", () => {
    assert.equal(formatRushTime(439160), "07:19.16")
    assert.equal(formatRushTime(0), "00:00.00")
    assert.equal(formatRushTime(59999), "00:59.99")
    // 超过一小时不进位成 HH:MM:SS —— 官方界面只有分/秒/百分秒三个槽
    assert.equal(formatRushTime(3661230), "61:01.23")
    assert.equal(formatRushTime(null), "--:--.--")
    assert.equal(formatRushTime(Number.NaN), "--:--.--")
    assert.equal(formatRushTime(-1), "--:--.--")
})

test("没有有效战斗计时的行渲染成 --:--.--,不是 00:00.00", () => {
    // 2026-08-28 口径下 toNewsRow 对「不是完整一程」的行发 null;
    // 发 0 会被 formatRushTime 渲染成 00:00.00,看起来像全场最强成绩。
    const html = buildRushBoardHtml(board({ rows: [row({ elapsedMs: null })], total: 1 }))
    assert.ok(html.includes("TIME: --:--.--"), "缺官方哨兵")
    assert.ok(!html.includes("TIME: 00:00.00"), "0 会看起来像最强成绩")
    assertBalancedXml(html)
})

/** 一条不碰数据库的成绩记录:`playerExists=false` ⇒ 等级查询整段短路。 */
function newsRecord(overrides: Partial<RushRunRecord> = {}): RushRunRecord {
    return {
        id: 1,
        playerId: 8,
        playerName: "浅羽",
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
        characterIds: [null, null, null],
        unisonCharacterIds: [null, null, null],
        displayName: "浅羽",
        playerExists: false,
        fullRun: true,
        ...overrides
    } as RushRunRecord
}

test("toNewsRow 的数值列 = battleMs;不是完整一程就发 null", () => {
    // 墙钟再大也不影响数值列(2026-08-28 口径:排的是 30 关结算时间之和)
    const full = toNewsRow(newsRecord({ battleMs: 200_561, durationMs: 9_999_999 }), 1, null)
    assert.equal(full.elapsedMs, 200_561, "发的是 battleMs,不是墙钟")

    // battleMs=0:发 0 会被 formatRushTime 渲染成 00:00.00,看起来像全场最强
    const zero = toNewsRow(newsRecord({ battleMs: 0, fullRun: false }), 1, null)
    assert.equal(zero.elapsedMs, null)

    // 半途接管:battleMs 是部分和,同样不能当成绩显示
    const partial = toNewsRow(
        newsRecord({ battleMs: 20_000, fullRun: false, trackedFromRound: 20 }), 1, null)
    assert.equal(partial.elapsedMs, null)
})

test("formatRushUpdateTime 输出官方顶部条格式", () => {
    const stamp = new Date(2026, 7, 27, 9, 5).getTime()
    assert.equal(formatRushUpdateTime(stamp), "2026.08.27 09:05")
})

test("sanitizeRichText 换掉所有会撑爆 XML 解析器的字符", () => {
    const dirty = `<b>&"'`
    const clean = sanitizeRichText(dirty)
    for (const char of ["<", ">", "&", "\"", "'"]) {
        assert.ok(!clean.includes(char), `${char} 没被换掉: ${clean}`)
    }
    // 中日文与普通字符原样保留
    assert.equal(sanitizeRichText("浅羽 Alk_01"), "浅羽 Alk_01")
})

test("空榜给「暂无记录」占位,不产出空白正文", () => {
    const html = buildRushBoardHtml(board({ rows: [], total: 0 }))
    assert.ok(html.includes("暂无记录"))
    // 只剩「自身名次(排名外)」那一张卡,名次列表本身不渲染空表格
    assert.equal((html.match(/<table>/g) ?? []).length, 1, "空榜多渲染了表格")
    assert.ok(html.includes("排名外"))
    assertBalancedXml(html)
})

test("行按官方文案模板渲染:N位 / RANK / BEST RECORD / TIME", () => {
    const html = buildRushBoardHtml(board({ rows: [row({ rankNumber: 3 })], total: 3 }))
    assert.ok(html.includes("3位"), "缺名次")
    assert.ok(html.includes("RANK169"), "缺玩家等级")
    assert.ok(html.includes("BEST RECORD: 30战"), "缺 BEST RECORD")
    assert.ok(html.includes("TIME: 07:19.16"), "缺 TIME")
    assert.ok(html.includes("2026.08.27 15:30更新"), "缺顶部更新时间条")
    assertBalancedXml(html)
})

test("表格只用 td:th 会被 RichTextLayoutTr 静默丢掉", () => {
    const html = buildRushBoardHtml(board({ rows: [row(), row({ rankNumber: 2 })], total: 2 }))
    assert.ok(!/<th[ >]/.test(html), "出现了 <th>,客户端会把整格丢掉")
    // td 必须直接在 tr 里,tr 必须直接在 table 里
    assert.ok(/<table><tr><td/.test(html), "表格层级不对")
    assert.ok(/<\/td><\/tr><\/table>/.test(html), "表格层级不对")
})

test("队伍头像是 td 的直接子节点,绝不能落进 p 里", () => {
    const withIcons = row({
        thumbnails: ["character/alk/ui/square_round_136_136_0",
            "character/white_tiger/ui/square_round_136_136_0"]
    })
    const html = buildRushBoardHtml(board({ rows: [withIcons], total: 1 }))
    assert.ok(html.includes(`<img src="file://character/alk/ui/square_round_136_136_0"`))
    // <p> 会被 parseElement 拍平成纯文本,里面的 <img> 会被当字面量文字画出来
    assert.ok(!/<p[^>]*>[^<]*<img/.test(html), "<img> 落进了 <p>")
    assert.ok(/<td width="30%"><img/.test(html), "<img> 不是 <td> 的直接子节点")
    assertBalancedXml(html)
})

test("不给头像时整列不渲染(默认路径)", () => {
    const html = buildRushBoardHtml(board({ rows: [row()], total: 1 }))
    assert.ok(!html.includes("<img"), "默认不该出现 <img>")
})

test("自身名次置顶并高亮;没上榜给官方文案「排名外」", () => {
    const mine = row({ rankNumber: 7, playerName: "作者", isViewer: true })
    const withMine = buildRushBoardHtml(board({ rows: [mine], myRow: mine, total: 1 }))
    assert.ok(withMine.includes("自身名次"))
    assert.ok(withMine.includes(`<font color="#ff9f1c">7位</font>`), "自身名次没高亮")
    assertBalancedXml(withMine)

    const without = buildRushBoardHtml(board({ myRow: null }))
    assert.ok(without.includes("排名外"), "没上榜时缺官方「排名外」文案")
})

test("首通榜带期号,用时榜不带", () => {
    const seasonRow = row({ season: 4 })
    assert.ok(buildRushBoardHtml(board({ rows: [seasonRow], showSeason: true }))
        .includes("第 4 期"))
    assert.ok(!buildRushBoardHtml(board({ rows: [seasonRow], showSeason: false }))
        .includes("第 4 期</font>"))
})

test("玩家名里的尖括号不会破坏正文结构", () => {
    const evil = row({ playerName: `</p></td></tr></table><script>x</script>` })
    const html = buildRushBoardHtml(board({ rows: [evil], total: 1 }))
    assert.ok(!html.includes("<script"), "注入的标签活下来了")
    assertBalancedXml(html)
})

test("报酬一览按档位渲染;未配置道具时明确标出", () => {
    const html = buildRushBoardHtml(board({
        rewardTiers: [
            { fromRank: 1, toRank: 1, itemLabel: "终焉裁定券", count: 10 },
            { fromRank: 2, toRank: 3, itemLabel: null, count: 5 }
        ],
        rewardRankLimit: 10
    }))
    assert.ok(html.includes("报酬一览"))
    assert.ok(html.includes("第 1 名　终焉裁定券 ×10"))
    assert.ok(html.includes("奖励未配置"))
    assert.ok(html.includes("发到第 10 名为止"))
    assertBalancedXml(html)
})

test("报酬一览把 null 尾档显示为到榜尾,有限截断线不截断尾档", () => {
    const html = buildRushBoardHtml(board({
        rewardTiers: [
            { fromRank: 16, toRank: null, itemLabel: null, count: 1, degreeLabel: "深渊参与者" }
        ],
        rewardRankLimit: 15
    }))
    assert.ok(html.includes("第 16 名起（到榜尾）"))
    assert.ok(html.includes("有限档发到第 15 名为止；到榜尾档继续覆盖完整通关玩家"))
    assertBalancedXml(html)
})

test("没有报酬档位时整节不渲染", () => {
    const html = buildRushBoardHtml(board({ rewardTiers: [] }))
    assert.ok(!html.includes("报酬一览"))
})

test("正文是合法 XML(客户端用严格解析器,失败=整页打不开)", () => {
    const html = buildRushBoardHtml(board({
        rows: [row(), row({ rankNumber: 2, playerName: `A&B<C>`, isViewer: true })],
        myRow: row({ rankNumber: 2, playerName: `A&B<C>`, isViewer: true }),
        showSeason: true,
        total: 2,
        rewardTiers: [{ fromRank: 1, toRank: 1, itemLabel: "券", count: 1 }]
    }))
    assertBalancedXml(html)
    assert.ok(html.startsWith(`<html lang="zh"><body class="body">`))
    assert.ok(html.endsWith(`</div></body></html>`))
    // 只用样式表 rich_text/style_bundled 里真的存在的 class
    for (const clazz of html.match(/class="([^"]+)"/g) ?? []) {
        assert.ok(["class=\"zh\"", "class=\"body\"", "class=\"container\"", "class=\"center\""]
            .includes(clazz), `用了样式表里没有的 class: ${clazz}`)
    }
})
