/**
 * 深渊连战排行榜 —— **公告(News)富文本文字榜**。
 *
 * ── 为什么走公告 ────────────────────────────────────────────────
 * 这一版 CN 客户端把官方「狂热激战 → 排名」原生界面整段裁掉了(场景类 /
 * remote 类 / 按钮注册全没了,主 SWF 原始字节里连符号都搜不到),补回去等于
 * 新增 AS3 类,撞项目铁律。勘探全文见
 * `mod-tools/docs/官方排行榜通道勘探-20260827.md`。
 *
 * 唯一「正文由我们服务端逐次生成、客户端原生渲染、不跳出游戏」的通道是公告:
 *   `POST /api/index.php/news/index` / `news/get_info` 的 `html` 字段
 *   → `NewsDetailDialog.getRichTextLayout()`(`:135-148`)
 *   → `RichTextLayoutParser.getLayoutData(html)`
 *   → `RichTextView(..., asset.getCssData("rich_text/style_bundled"))`
 *
 * ── 客户端富文本的真实能力(逐条从反编译源码核实,不是推测)────────
 * 解析器 `pinball/ui/richText/parser/RichTextLayoutParser.as:98-195`:
 *   支持标签 `a` `br` `div` `h1` `h2` `h3` `hr` `img` `li` `ol` `p`
 *            **`table` `tr` `td`** `th` `ul`
 *   支持属性 `alt` `class` `height` `href` `src` `width`(**没有 `style=`**)
 *
 * 三条会静默吞内容的坑,本文件全部绕开:
 *   ① **`<th>` 会被丢掉** —— `RichTextLayoutTr.createBlock`(`:91-118`)只认
 *      `RichTextTagKind.Td`(索引 13),`Th` 是索引 11,落进 default 分支什么都不干。
 *      ⇒ 表头也必须写 `<td>`。
 *   ② **`<li>` 只能在 `<ul>/<ol>` 里** —— 通用容器 `createBlock` 的 case 18 是空的。
 *   ③ **`<td>` 只能在 `<tr>` 里,`<tr>` 只能在 `<table>` 里** —— 同上,层级错了整块消失。
 *
 * 排版能力来自**固定的 CDN 样式表** `rich_text/style_bundled`(已解出原文):
 *   body     32px / #444444 / 背景 #eaeaea / padding 40px / line-height 1.4
 *   h2       40px + 左侧 12px 实线 + 底部虚线(正好是官方那种小节标题)
 *   hr       上下两道虚线
 *   .center  text-align:center     .strong #ff9f1c
 *   .alert   #ea354c               .attention #ff33cc      .container padding 0 16px
 * ⇒ **能用的 class 只有这几个**,想加新 class 得发布新的 CSS 资产(阶段 B)。
 *
 * `<p>`/`<h1>`/`<h2>`/`<h3>` 的正文最终喂给 Starling 的 `isHtmlText` 文本域
 * (`RichTextLayoutText.as:96`),所以**行内**可以用 `<b>` / `<font color="#rrggbb">`
 * / `<br/>` —— 官方自己的示例公告就是这么写的
 * (`pinball/remote/news/getInfo/NewsGetInfoDummyRemote.as:44`)。
 *
 * ── 观感对齐官方截图 ───────────────────────────────────────────
 * 官方行模板取自 `master/string/ui_string` 实测值:
 *   `rush_event_ranking_ranking_rank` = `::value::位`
 *   `rush_event_ranking_player_rank`  = `RANK::value::`
 *   `rush_event_ranking_best_record`  = `BEST RECORD: ::value::战`
 *   `rush_event_ranking_time`         = `TIME: ::value::`
 *   `rush_event_ranking_update_time`  = `::value::更新`
 *   `rush_event_ranking_out_of_ranking` = `排名外`
 * 本文件逐字沿用这五个模板,并保留官方的「自身名次卡置顶 + 名次列表 + 翻页 +
 * 报酬一览」四段结构。
 *
 * ── 铁律 ───────────────────────────────────────────────────────
 * 1. **正文每次请求现生成**,不落盘、不写 `assets/news.json`。
 * 2. 玩家名一律过 `sanitizeRichText`:`<` `>` `&` `"` `'` 会让
 *    `flash.Xml.parse` 抛 `ClientError 7613`,**整条公告直接打不开**。
 * 3. 一切异常吞掉退回空数组 —— 排行榜是旁挂功能,不许把公告列表拖崩。
 */

import {
    getRushBoardRecordsSync,
    type RushRankingBoard
} from "./rush-leaderboard-ranking";
import type { RushRunRecord } from "../data/domains/rushLeaderboard";
import { getRushTowerFolderIdSync, peekRushSeasonSync } from "./rush-leaderboard-service";
import { getRushSettlementConfigSync } from "../data/domains/rushSettlement";
import { toRewardPreviewTiers } from "./rush-reward-preview";
import { getPlayerSync, getPlayersRankPointsSync } from "../data/domains/player";
import { getRankDegree } from "./stamina";
import { getServerDate } from "../utils";
import { readFileSync } from "fs";
import path from "path";

/** 虚拟公告的 id 段。`assets/news.json` 里是 1/2/3,留足距离免得撞号。 */
export const RUSH_NEWS_ID_FULL_RUN = 900001
export const RUSH_NEWS_ID_SEASON_FIRST = 900002

/** 一条公告里最多列多少名。超出的名次没人会往下滚。 */
const MAX_ROWS = 100

/** 名次列占正文宽度的比例。官方那一列是窄条,右边是三行文字。 */
const RANK_COLUMN_WIDTH = "24%"

/** 队伍头像列的宽度与单个头像边长(px)。只在开了头像时用。 */
const THUMBNAIL_COLUMN_WIDTH = "30%"
const THUMBNAIL_SIZE = 96

/**
 * 是否在行里画通关队伍的头像。**默认关**。
 *
 * 机制本身是通的(`<img src="file://...">` 走 `RichTextImageLoader` 按需从 CDN
 * 取图,`character/<code_name>/ui/square_round_136_136_0.png` 在官方包里实体存在,
 * 已按 `sha1(逻辑路径+SALT)` 核过),但**失败模式很重**:一旦某个 code_name 解析
 * 不出来或该资产不在客户端本地缓存里,会触发一次按需下载;下载不到时客户端会走
 * 「数据不足」那条恢复通道,而不是安静地少显示一个头像。
 *
 * 所以默认走纯文字。作者想试就在 `.env` 里加 `WF_RUSH_NEWS_ICONS=1` 再重启,
 * 真机看一眼;不行就把它去掉,零回滚成本。
 */
function iconsEnabled(): boolean {
    return (process.env.WF_RUSH_NEWS_ICONS ?? "").trim() === "1"
}

/** 官方公告 label:1=更新 2=扭蛋 3=活动 4=新闻 5=活动 6/7=重要 8=系统。 */
const NEWS_LABEL_EVENT = 3

/** 自身名次那一行的强调色 = 样式表里的 `.strong` 橙。 */
const HIGHLIGHT_COLOR = "#ff9f1c"

/** 公告条目的形状,和 `src/routes/api/news.ts` 的 `NewsItem` 一致。 */
export interface RushNewsItem {
    id: number
    title: string
    date: string
    label: number
    thumbnail: number
    thumbnail_path: string | null
    added_time: string | null
    html: string
}

/** 榜上一行,渲染所需的全部信息(已经和数据库脱钩,方便单测)。 */
export interface RushNewsRow {
    rankNumber: number
    playerName: string
    /** 玩家等级,渲染成 `RANK::value::`。 */
    userRank: number
    /** 打通到第几关,渲染成 `BEST RECORD: ::value::战`。 */
    bestRound: number
    /** 本程 30 关结算时间之和(ms);null = 不是完整一程或没有有效计时。 */
    elapsedMs: number | null
    season: number
    /** 是不是「正在看这条公告的人」的成绩。 */
    isViewer: boolean
    /**
     * 通关队伍三人的头像 CDN 逻辑路径(不带 `file://` 前缀、不带扩展名)。
     * 空数组 = 不渲染头像列(默认就是空的,见 `RUSH_NEWS_ICONS_ENABLED`)。
     */
    thumbnails: string[]
}

/** 一档报酬,渲染「报酬一览」用。 */
export interface RushNewsRewardTier {
    fromRank: number
    toRank: number | null
    itemLabel: string | null
    count: number
    /** 该档还发的称号名;null = 不发称号。 */
    degreeLabel?: string | null
}

export interface RushNewsBoardInput {
    /** 小节标题,例如「战斗用时榜」。 */
    boardTitle: string
    /** 标题下面那行口径说明。 */
    caption: string
    rows: RushNewsRow[]
    /** 置顶的自身名次卡;null = 这个人还没上榜(渲染成「排名外」)。 */
    myRow: RushNewsRow | null
    /** 首通榜要在行里带期号,用时榜不带。 */
    showSeason: boolean
    /** 顶部「YYYY.MM.DD HH:MM更新」。 */
    updatedAt: string
    /** 当前期号;null = 还没有台账。 */
    season: number | null
    /** 榜上总人次(可能大于 rows.length)。 */
    total: number
    rewardTiers: RushNewsRewardTier[]
    /** 有限报酬档发到第几名为止;null 尾档不受它限制。 */
    rewardRankLimit: number
}

/**
 * 把玩家名里会撑爆 XML 解析器的字符换成同宽的安全替身。
 *
 * `flash.Xml.parse` 一旦失败,`RichTextLayoutParser.getLayoutData` 会抛
 * `ClientError 7613`,**整条公告打不开**(不是少显示一行,是整页白)。
 * 所以这里不做转义(转义后 Haxe 的 Xml 打印器再序列化一次会双重解码),
 * 直接换成全角替身 —— 观感几乎无损,且从根上不可能破坏解析。
 *
 * @param raw 原始文本。
 * @returns 可以安全塞进富文本的文本。
 */
export function sanitizeRichText(raw: string): string {
    return raw
        .replace(/&/g, "＆")
        .replace(/</g, "＜")
        .replace(/>/g, "＞")
        .replace(/"/g, "”")
        .replace(/'/g, "’")
        // 控制字符会被 stripString 吃掉一部分,剩下的可能让 XML 解析失败
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : String(value)
}

/**
 * 毫秒 → 官方秒表格式 `MM:SS.FF`(FF = 百分秒)。
 *
 * 超过 1 小时不进位成 `HH:MM:SS` —— 官方那个界面就是分钟位一直加上去
 * (`RankingEventYourTimeRecordView` 只有 minute / second / centisecond 三个槽)。
 *
 * @param ms 毫秒;null / 非有限值 → `--:--.--`。
 */
export function formatRushTime(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms) || ms < 0) return "--:--.--"
    const total = Math.trunc(ms)
    const minutes = Math.floor(total / 60000)
    const seconds = Math.floor((total % 60000) / 1000)
    const centis = Math.floor((total % 1000) / 10)
    return `${pad2(minutes)}:${pad2(seconds)}.${pad2(centis)}`
}

/**
 * 毫秒 → 官方公告顶部的 `YYYY.MM.DD HH:MM` (后面由调用方补「更新」)。
 *
 * @param ms epoch 毫秒。
 */
export function formatRushUpdateTime(ms: number): string {
    const date = new Date(ms)
    return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`
        + ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** `news.date` 要的 `YYYY-MM-DD HH:MM:SS`(客户端按 JST 串解析)。 */
function formatNewsDate(ms: number): string {
    const date = new Date(ms)
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
        + ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** 行内文本用 `<font color>` 上色;color 为 null 则原样返回。 */
function colored(text: string, color: string | null): string {
    return color === null ? text : `<font color="${color}">${text}</font>`
}

/**
 * 渲染一行成绩的右半格(官方的三行:玩家 / BEST RECORD / TIME)。
 *
 * @param row 成绩行。
 * @param showSeason 是否追加期号行。
 */
function renderRowBody(row: RushNewsRow, showSeason: boolean): string {
    const color = row.isViewer ? HIGHLIGHT_COLOR : null
    const name = sanitizeRichText(row.playerName)
    const lines = [
        `<b>${colored(`RANK${row.userRank}　${name}`, color)}</b>`,
        colored(`BEST RECORD: ${row.bestRound}战`, color),
        colored(`TIME: ${formatRushTime(row.elapsedMs)}`, color)
    ]
    if (showSeason) lines.push(colored(`第 ${row.season} 期`, color))
    return lines.join("<br/>")
}

/**
 * 渲染通关队伍的头像格(官方行右侧那三个圆头像)。
 *
 * **`<img>` 必须是 `<td>`/`<div>` 的直接子节点,绝不能塞进 `<p>`** ——
 * `<p>` 会被 `parseElement` 拍平成一段纯文本,里面的 `<img>` 会被 Starling
 * 当字面量文字渲染出来。
 *
 * `file://` 通道由 `RichTextImageLoader.resolveSource`(`:61-64`)处理:
 * 去掉协议、按第一个 `.` 截断,剩下的当 CDN 逻辑路径交给
 * `assetCache.setTexture` **按需下载**(不需要场景预载)。
 *
 * @param thumbnails CDN 逻辑路径数组;空数组 → 返回空串(整列不渲染)。
 */
function renderThumbnails(thumbnails: string[]): string {
    if (thumbnails.length === 0) return ""
    const images = thumbnails
        .map(p => `<img src="file://${p}" width="${THUMBNAIL_SIZE}" height="${THUMBNAIL_SIZE}"/>`)
        .join("")
    return `<td width="${THUMBNAIL_COLUMN_WIDTH}">${images}</td>`
}

/**
 * 渲染一行成绩(`<tr>` 两格:名次 + 三行正文;开了头像就是三格)。
 *
 * `<th>` 会被客户端丢掉,所以左格也是 `<td>`。
 */
export function renderRow(row: RushNewsRow, showSeason: boolean): string {
    const color = row.isViewer ? HIGHLIGHT_COLOR : null
    const rank = `<b>${colored(`${row.rankNumber}位`, color)}</b>`
    return `<tr>`
        + `<td width="${RANK_COLUMN_WIDTH}"><p class="center">${rank}</p></td>`
        + `<td><p>${renderRowBody(row, showSeason)}</p></td>`
        + renderThumbnails(row.thumbnails)
        + `</tr>`
}

/**
 * 渲染「自身名次」置顶卡。没上榜时给官方文案「排名外」。
 *
 * @param myRow 自身成绩;null = 排名外。
 * @param showSeason 是否带期号。
 */
export function renderMyCard(myRow: RushNewsRow | null, showSeason: boolean): string {
    if (myRow === null) {
        return `<table><tr>`
            + `<td width="${RANK_COLUMN_WIDTH}"><p class="center"><b>排名外</b></p></td>`
            + `<td><p>本期还没有完成记录，打通一次就会出现在这里。</p></td>`
            + `</tr></table>`
    }
    return `<table>${renderRow(myRow, showSeason)}</table>`
}

/**
 * 渲染「报酬一览」。官方那个弹窗的行模板是
 * `ranking_reward_degree_list_dialog_rank_rush` = `完成::rank_start::战及以上`,
 * 但我们的奖是按**名次**发的(见 rush-settlement.ts),所以文案改成名次区间,
 * 结构保持一致。
 *
 * @param tiers 档位;空数组 → 整节不渲染。
 * @param rankLimit 有限档发到第几名为止。
 */
export function renderRewards(tiers: RushNewsRewardTier[], rankLimit: number): string {
    if (tiers.length === 0) return ""
    const lines = tiers.map(tier => {
        const range = tier.toRank === null
            ? `第 ${tier.fromRank} 名起（到榜尾）`
            : tier.fromRank === tier.toRank
            ? `第 ${tier.fromRank} 名`
            : `第 ${tier.fromRank} ~ ${tier.toRank} 名`
        const degree = tier.degreeLabel == null
            ? ""
            : `　称号「${sanitizeRichText(tier.degreeLabel)}」`
        const reward = tier.itemLabel === null
            ? (degree === ""
                ? `<font color="#ea354c">奖励未配置</font>`
                : degree.trimStart())
            : `${sanitizeRichText(tier.itemLabel)} ×${tier.count}${degree}`
        return `<p>${range}　${reward}</p>`
    })
    return `<h2>报酬一览</h2>`
        + lines.join("")
        + `<p>结算时按名次发放，有限档发到第 ${rankLimit} 名为止；`
        + `到榜尾档继续覆盖完整通关玩家。一位玩家只占一个名次。</p>`
}

/**
 * 生成一整条排行榜公告的正文。
 *
 * 结构照着作者提供的官方截图排:
 *   顶部更新时间条 → 自身名次卡 → 名次列表 → `1 / N` 翻页 → 报酬一览。
 *
 * @param input 渲染所需的全部数据。
 * @returns 可直接塞进 `news.html` 的富文本。
 */
export function buildRushBoardHtml(input: RushNewsBoardInput): string {
    const parts: string[] = []

    parts.push(`<p class="center">${input.updatedAt}更新</p>`)

    parts.push(`<h2>自身名次</h2>`)
    parts.push(renderMyCard(input.myRow, input.showSeason))

    parts.push(`<hr/>`)
    parts.push(`<h2>${sanitizeRichText(input.boardTitle)}</h2>`)
    parts.push(`<p>${sanitizeRichText(input.caption)}</p>`)

    if (input.rows.length === 0) {
        parts.push(`<p class="center"><b>暂无记录</b></p>`)
        parts.push(`<p class="center">打通一次深渊连战，这里就会出现名次。</p>`)
    } else {
        const shown = input.rows.slice(0, MAX_ROWS)
        parts.push(`<table>${shown.map(row => renderRow(row, input.showSeason)).join("")}</table>`)
        // 官方底部是「1 / 146」翻页器。公告是一整页滚动的,没有翻页控件,
        // 所以这里给的是**诚实的计数**而不是假页码 —— 全部列完就只写总数,
        // 被 MAX_ROWS 截断了才写「显示 1 ~ N」。
        parts.push(shown.length < input.total
            ? `<p class="center">显示 1 ~ ${shown.length} / 共 ${input.total} 件</p>`
            : `<p class="center">共 ${input.total} 件</p>`)
    }

    const rewards = renderRewards(input.rewardTiers, input.rewardRankLimit)
    if (rewards !== "") {
        parts.push(`<hr/>`)
        parts.push(rewards)
    }

    if (input.season !== null) {
        parts.push(`<p class="center">当前第 ${input.season} 期</p>`)
    }

    return `<html lang="zh"><body class="body"><div class="container">`
        + parts.join("")
        + `</div></body></html>`
}

// ────────────────────────────────────────────────────────────────
// 以下是接数据库的那一半。上面全是纯函数,单测只测上面。
// ────────────────────────────────────────────────────────────────

// 道具名查表已经并到 `rush-reward-preview.ts`(那一份还补了灰白深渊的两张新券,
// 它们不在官方 `assets/item_lookup.json` 里)。公告与游戏内报酬页共用同一份名字,
// 免得同一枚券在两处叫不同的名。

let characterCodeNames: Record<string, string> | null = null

/**
 * 角色 ID → code_name(CDN 资产目录名)。
 *
 * 数据源是 master 表落盘 `assets/cdndata/character.json`,行是数组,**第 0 列就是
 * code_name**(已核:`1 → alk`、`10 → white_tiger`,两者的
 * `character/<code_name>/ui/square_0.png` 都在官方包里实体存在)。
 * 懒加载 + 吞异常:这张表是作者的 WIP,随时可能在换角色时被改写。
 *
 * @param characterId 角色 ID。
 * @returns code_name;查不到返回 null(该头像整个跳过)。
 */
export function codeNameOf(characterId: number): string | null {
    if (characterCodeNames === null) {
        characterCodeNames = {}
        try {
            const raw = readFileSync(
                path.join(__dirname, "..", "..", "assets", "cdndata", "character.json"), "utf-8")
            const table = JSON.parse(raw) as Record<string, unknown>
            for (const [id, rows] of Object.entries(table)) {
                const first = Array.isArray(rows) ? rows[0] : null
                const code = Array.isArray(first) ? first[0] : null
                // code_name 只可能是 [a-z0-9_];别的一律不信,免得把脏值拼进资产路径
                if (typeof code === "string" && /^[a-z0-9_]+$/.test(code)) {
                    characterCodeNames[id] = code
                }
            }
        } catch (error) {
            console.error("[RUSH-LB] character code_name table load failed:", error)
        }
    }
    return characterCodeNames[String(characterId)] ?? null
}

/**
 * 一行成绩的队伍头像逻辑路径(关了开关或一个都解析不出来时为空数组)。
 *
 * ⚠ 这里画的是**那一程的实战队伍快照**,和游戏内原生榜行不一样 ——
 * 后者 2026-08-28 起改画「个人资料里的前三个角色」
 * (`rush-leaderboard-native-rows.ts` 文件头「三个头像画的是谁」)。
 * **这是刻意的**:公告版 / 官方契约端点 / 后台页三处保留实战快照,
 * 排障时要看得见「他那一程到底打了什么」。别顺手统一成同一个来源。
 */
function thumbnailsOf(record: RushRunRecord): string[] {
    if (!iconsEnabled()) return []
    return record.characterIds
        .filter((id): id is number => id !== null && id > 0)
        .map(id => codeNameOf(id))
        .filter((code): code is string => code !== null)
        .map(code => `character/${code}/ui/square_round_136_136_0`)
}

/**
 * 成绩记录 → 渲染行。玩家等级读实时值,存档没了就退回 1。
 *
 * @param record 成绩记录。
 * @param rankNumber 名次(1 起)。
 * @param viewerPlayerId 正在看这一屏的存档 ID(用来给自己那一行打高亮)。
 * @param prefetched 已经批量取好的 `rank_point`({@link getPlayersRankPointsSync})。
 *        **给了就一次数据库都不碰** —— 这一条是端点的性能闸:不给的话每一行
 *        一次 {@link getPlayerSync},而这两张榜各取到 `BOARD_FETCH_CAP=500` 行,
 *        一次 `/tool/agreement` 就是上千次同步查询跑在 async handler 里
 *        (20260828 复核实测:25 行/榜时富文本半边 55 次、225 行/榜时 455 次,
 *         而同一次请求的原生榜半边恒定 7 次 —— 差距就在这一个参数上)。
 */
export function toNewsRow(
    record: RushRunRecord,
    rankNumber: number,
    viewerPlayerId: number | null,
    prefetched?: { rankPoint: number }
): RushNewsRow {
    let userRank = 1
    try {
        if (prefetched !== undefined) {
            userRank = getRankDegree(prefetched.rankPoint)
        } else {
            const player = record.playerExists ? getPlayerSync(record.playerId) : null
            if (player !== null) userRank = getRankDegree(player.rankPoint)
        }
    } catch {
        userRank = 1
    }

    return {
        rankNumber,
        playerName: record.displayName ?? `存档${record.playerId}`,
        userRank,
        bestRound: record.roundsCleared,
        // 界面上的数值列 = 这一程 30 关的结算时间之和(battleMs,2026-08-28 口径)。
        // 不是完整一程就发 null,由 formatRushTime 渲染成 --:--.--。
        elapsedMs: record.fullRun ? record.battleMs : null,
        season: record.season,
        isViewer: viewerPlayerId !== null && record.playerId === viewerPlayerId,
        thumbnails: thumbnailsOf(record)
    }
}

/**
 * 一屏所有榜行要用的 `rank_point`,**一次批查询取完**。
 *
 * 用法固定是这一对:先 `const points = newsRowRankPoints(records)`,再
 * `records.map((r, i) => toNewsRow(r, i + 1, viewer, rankPointFacet(points, r)))`。
 * 拆开写(比如只在渲染前 slice 50 行再取)会同时踩两个坑:
 * `myRow` 要在**全表**里找、`total` 要用 `records.length`,切了两处都错。
 *
 * @param records 本屏所有榜的成绩记录(可含重复存档)。
 * @returns `playerId → rank_point`。
 */
export function newsRowRankPoints(records: readonly RushRunRecord[]): Map<number, number> {
    try {
        return getPlayersRankPointsSync(
            records.filter(record => record.playerExists).map(record => record.playerId))
    } catch (error) {
        console.error("[RUSH-LB] rank point prefetch failed:", error)
        return new Map()
    }
}

/**
 * {@link newsRowRankPoints} 的结果 → {@link toNewsRow} 的 `prefetched` 参数。
 *
 * 取不到就返回 `undefined`,于是那一行退回逐行现查 —— 单行退化,不是整屏退化。
 *
 * @param points {@link newsRowRankPoints} 的结果。
 * @param record 这一行的成绩记录。
 */
export function rankPointFacet(
    points: Map<number, number>,
    record: RushRunRecord
): { rankPoint: number } | undefined {
    const point = points.get(record.playerId)
    return point === undefined ? undefined : { rankPoint: point }
}

/** 该事件要上公告的 folder。默认取轮数最多的那个(700099 → folder 1,30 关)。 */
function resolveNewsTarget(): { eventId: number, folderId: number } | null {
    const raw = (process.env.WF_RUSH_NEWS_EVENT ?? "").trim()
    const eventId = raw === "" ? 700099 : Number(raw)
    if (!Number.isFinite(eventId) || eventId <= 0) return null

    const folderId = getRushTowerFolderIdSync(eventId)
    if (folderId === null) return null
    return { eventId, folderId }
}

export function buildRewardTiers(eventId: number, folderId: number, board: RushRankingBoard): {
    tiers: RushNewsRewardTier[], rankLimit: number
} {
    try {
        const config = getRushSettlementConfigSync(eventId, folderId, Date.now())
        // 报酬只挂在真正发奖的那张榜上,免得两条公告都说自己发奖。
        if (config.rewardBoard !== board) return { tiers: [], rankLimit: 0 }
        return {
            tiers: toRewardPreviewTiers(config.rewardTiers).map(tier => ({
                fromRank: tier.fromRank,
                toRank: tier.toRank,
                itemLabel: tier.itemName,
                count: tier.itemCount,
                degreeLabel: tier.degreeName
            })),
            rankLimit: config.rewardRankLimit
        }
    } catch (error) {
        console.error("[RUSH-LB] news reward tiers failed:", error)
        return { tiers: [], rankLimit: 0 }
    }
}

interface BoardSpec {
    id: number
    title: string
    boardTitle: string
    caption: string
    board: RushRankingBoard
    showSeason: boolean
}

const BOARD_SPECS: BoardSpec[] = [
    {
        id: RUSH_NEWS_ID_FULL_RUN,
        title: "深渊连战 排行榜",
        boardTitle: "战斗用时榜",
        caption: "同一次从第 1 关连续爬到最终关，每一关战斗结算时间之和；关间选队、整备、读条、掉线都不计。越短越靠前。一位玩家只记录他最优的一程，同一个存档只占一个名次。",
        board: "full-run",
        showSeason: false
    },
    {
        id: RUSH_NEWS_ID_SEASON_FIRST,
        title: "深渊连战 当期首通榜",
        boardTitle: "当轮首通榜",
        caption: "每一期里，每个存档的第一次通关。按期号倒序，同期内按首通时刻先后排。",
        board: "season-first",
        showSeason: true
    }
]

/**
 * 生成排行榜公告(每次请求现查两张榜,不读任何静态文件)。
 *
 * ── 用哪个钟 ────────────────────────────────────────────────────
 * 公告上**显示**的时刻(`news.date` 与顶部「YYYY.MM.DD HH:MM更新」)一律走
 * `getServerDate()` —— 后台的「时间控制」把服务器时间钉在活动窗口里(现在是
 * 2025-07-31),游戏里其它所有时间都是那个钟。这里要是发真实墙钟(2026),
 * 玩家在同一个界面里会看到两个差一年的日期。
 *
 * 客户端只把 `date` 拿去格式化显示(`NewsListAdapter.as:83` /
 * `NewsDetailDialog.as:167`),**没有任何比较、排序或「NEW」角标**逻辑,
 * 所以换钟不会带出别的行为。
 *
 * **榜里的成绩时间(TIME 那一列)不受影响** —— 它是各关 elapsed_time_ms 之和,
 * 和服务器钟、墙钟都无关(见 `rush-leaderboard.ts` 顶部的计时口径)。
 *
 * @param viewerPlayerId 正在看公告的存档 ID;给了就把「自身名次」置顶并高亮。
 * @param nowMs 生成时刻(ms);默认取服务器钟。单测里传固定值。
 * @returns 公告条目;任何异常都退回空数组(公告列表照常出旧公告)。
 */
export function buildRushLeaderboardNewsItems(
    viewerPlayerId: number | null,
    nowMs: number = getServerDate().getTime()
): RushNewsItem[] {
    try {
        const target = resolveNewsTarget()
        if (target === null) return []

        const season = peekRushSeasonSync(target.eventId)
        const updatedAt = formatRushUpdateTime(nowMs)
        const date = formatNewsDate(nowMs)

        return BOARD_SPECS.map(spec => {
            const records = getRushBoardRecordsSync(target.eventId, target.folderId, spec.board)
            // 一次批查询取完这一榜的 rank_point;逐行 getPlayerSync 会随行数线性增长。
            const points = newsRowRankPoints(records)
            const rows = records.map((record, index) =>
                toNewsRow(record, index + 1, viewerPlayerId, rankPointFacet(points, record)))
            const myRow = viewerPlayerId === null
                ? null
                : rows.find(row => row.isViewer) ?? null
            const rewards = buildRewardTiers(target.eventId, target.folderId, spec.board)

            return {
                id: spec.id,
                title: spec.title,
                date,
                label: NEWS_LABEL_EVENT,
                thumbnail: 1,
                thumbnail_path: null,
                added_time: null,
                html: buildRushBoardHtml({
                    boardTitle: spec.boardTitle,
                    caption: spec.caption,
                    rows,
                    myRow,
                    showSeason: spec.showSeason,
                    updatedAt,
                    season: season?.season ?? null,
                    total: rows.length,
                    rewardTiers: rewards.tiers,
                    rewardRankLimit: rewards.rankLimit
                })
            }
        })
    } catch (error) {
        console.error("[RUSH-LB] leaderboard news build failed:", error)
        return []
    }
}
