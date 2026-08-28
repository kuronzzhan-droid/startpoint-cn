/**
 * 深渊连战排行榜 —— **全屏富文本页**(借客户端原生的「服务条款」场景)。
 *
 * ── 为什么是这条通道 ────────────────────────────────────────────
 * 官方那套 `RushEventRankingTop*` 场景类在这版 CN 包里被整段裁掉了,补回来要
 * 移植 21 个类 + 91 个混淆名映射(方案文档 §②/§③,本期冻结)。
 * 落点取 `LoadingTaskKind.TermsOfService` 这条**整条零调用者**的链:
 *
 *   buttonClicked case 5(P2 手术 C)
 *     -> changeSceneWithLoading(LoadingTaskKind.TermsOfService, ChangeSceneBackKind.AddCurrent)
 *     -> LogicScene.resolveLoadingTask case 40 -> new TermsOfServiceLoadingTask()
 *     -> remote.toolAgreement(hook) -> POST `tool/agreement`
 *     -> ToolAgreementRealRemote.successHandler:`data.terms_text` **必填 String**
 *        (缺了 / 不是 String 就抛 ClientError 8702)
 *     -> SceneKind.RichTextData(title, terms_text)
 *     -> RichTextDataScene -> RichTextLayoutParser().getLayoutData(html)
 *     -> RichTextDataSceneView.initializeRichTextFromData(
 *          getUiString(title), htmlData, richTextLogic, scroll)
 *
 * 落点是**整屏 + 自带返回 + 自带纵向滚动**,比公告(弹窗)高一档;正文 100% 由这里生成。
 *
 * ── 排版能力与公告版**完全同源** ────────────────────────────────
 * `RichTextSceneBaseView.initializeRichTextFromData` 里那句
 * `new RichTextView(..., view.asset.getCssData("rich_text/style_bundled"), 0)`
 * 和公告详情 `NewsDetailDialogContentView.as:183` 是同一份 CSS、同一个解析器。
 * ⇒ 公告版已经真机验证过的那套排版(两列表格 / `.strong` 橙 / `h2` 小节标题 /
 * `<b>`+`<font color>` 行内标记 / `<th>` 会被吞所以表头也用 `<td>`)在这里逐条成立,
 * 所以本文件**直接复用** `rush-leaderboard-news.ts` 的行渲染器,不另写一套。
 *
 * ── 一个页面为什么放两张榜 ──────────────────────────────────────
 * 这条通道的请求体是 `{}`(`ToolAgreementRealRemote` 构造函数里写死),**没有
 * page / event_id / tab 任何参数**,而深渊连战主页上只有一颗皇冠钮 ⇒ 客户端侧
 * 不存在第二个入口、也不存在页签。要么只给一张榜,要么两张榜同页。
 * 页面本身全屏可滚动(`SimpleScrollView(..., true, false)` 纵向开),
 * 所以裁定:**两张榜同页,`<hr/>` 分节,各自带自身名次卡**。
 *
 * ── 铁律(和公告版同源,不这么做整页打不开)────────────────────
 * 1. 玩家名一律过 `sanitizeRichText`:`flash.Xml.parse` 失败 ->
 *    `getLayoutData` 抛 ClientError 7613 -> **整页白**。
 * 2. 任何异常都要吞掉并退回一段**合法的** html —— `terms_text` 不是 String 就是
 *    8702,loading 进不去也退不回来。
 * 3. 显示用的时刻走 {@link rankUpdateTimeMs} —— **默认真实墙钟**。
 *    (20260828 之前默认走 `getServerDate()`,后台时间控制把它钉在活动窗口里,
 *     实测印出来是 `2025.08.02`;`WF_RUSH_RANK_TIME_REAL=0` 可以退回去。)
 */

import {
    formatRushUpdateTime,
    newsRowRankPoints,
    rankPointFacet,
    renderMyCard,
    renderRow,
    sanitizeRichText,
    toNewsRow,
    type RushNewsRow
} from "./rush-leaderboard-news";
import {
    buildRushRewardPreview,
    type RushRewardPreview,
    type RushRewardPreviewTier
} from "./rush-reward-preview";
import {
    getRushBoardRecordsSync,
    type RushRankingBoard
} from "./rush-leaderboard-ranking";
import {
    NATIVE_ROW_SLOTS,
    outOfRankNativeRow,
    toNativeRankRow,
    type RushNativeRankRow,
    type RushNativeRowFacets
} from "./rush-leaderboard-native-rows";
import { getPlayerSync } from "../data/domains/player";
import { getRankDegree } from "./stamina";
import type { RushRunRecord } from "../data/domains/rushLeaderboard";
import { getRushTowerFolderIdSync, peekRushSeasonSync } from "./rush-leaderboard-service";
import { getServerDate } from "../utils";
import { getDb } from "../data/db";
import { PartyCategory } from "../data/types";
import { deserializeNumberList } from "../data/utils/primitives";
import { buildProfileFavoriteParty } from "./rush-profile-party";

/**
 * 一页里每张榜最多列多少行。
 *
 * 两张榜同页,行数是公告版的两倍;而这一屏的每一行都是一个 `<table><tr>` 布局块,
 * 由 `RichTextLayoutParser` 在进场时一次性建出来。默认 50(两张榜合计 100 行),
 * 与公告版的单榜 100 行同量级。`WF_RUSH_RANK_PAGE_ROWS` 可改。
 */
export const RUSH_RANK_PAGE_DEFAULT_ROWS = 50

function maxRowsFromEnv(): number {
    const raw = Number((process.env.WF_RUSH_RANK_PAGE_ROWS ?? "").trim())
    if (!Number.isFinite(raw) || raw < 1) return RUSH_RANK_PAGE_DEFAULT_ROWS
    return Math.trunc(raw)
}

/** 页面上的一张榜。 */
export interface RushRankPageBoard {
    /** 小节标题,例如「战斗用时榜」。 */
    boardTitle: string
    /** 标题下面那行口径说明。 */
    caption: string
    rows: RushNewsRow[]
    /** 置顶的自身名次卡;null = 没上榜(渲染成官方文案「排名外」)。 */
    myRow: RushNewsRow | null
    /** 首通榜要在行里带期号,用时榜不带。 */
    showSeason: boolean
    /** 榜上总人次(可能大于 rows.length)。 */
    total: number
}

export interface RushRankPageInput {
    /** 顶部「YYYY.MM.DD HH:MM更新」。 */
    updatedAt: string
    boards: RushRankPageBoard[]
    /** 当前期号;null = 还没有台账。 */
    season: number | null
    /** 「报酬一览」要展示的档位(含铭牌图路径);null = 这一屏不渲染报酬节。 */
    reward: RushRewardPreview | null
    /** 每张榜最多列多少行;不传走 {@link RUSH_RANK_PAGE_DEFAULT_ROWS} / 环境变量。 */
    maxRows?: number
}

/**
 * 渲染一张榜的那一节(标题 / 口径 / 自身名次卡 / 名次表 / 计数)。
 *
 * @param board 这张榜的数据。
 * @param maxRows 最多列多少行。
 * @returns 该节的富文本片段。
 */
function renderBoardSection(board: RushRankPageBoard, maxRows: number): string {
    const parts: string[] = []
    parts.push(`<h2>${sanitizeRichText(board.boardTitle)}</h2>`)
    parts.push(`<p>${sanitizeRichText(board.caption)}</p>`)

    parts.push(`<p><b>自身名次</b></p>`)
    parts.push(renderMyCard(board.myRow, board.showSeason))

    if (board.rows.length === 0) {
        parts.push(`<p class="center"><b>暂无记录</b></p>`)
        parts.push(`<p class="center">打通一次深渊连战，这里就会出现名次。</p>`)
        return parts.join("")
    }

    const shown = board.rows.slice(0, maxRows)
    parts.push(`<table>${shown.map(row => renderRow(row, board.showSeason)).join("")}</table>`)
    // 官方那一屏底部是「1 / 146」翻页器。这条通道拿不到 page 参数、页面本身是
    // 一整页滚动的 => 给诚实计数而不是假页码。
    parts.push(shown.length < board.total
        ? `<p class="center">显示 1 ~ ${shown.length} / 共 ${board.total} 件</p>`
        : `<p class="center">共 ${board.total} 件</p>`)
    return parts.join("")
}

/** 铭牌图在富文本里的显示尺寸(官方铭牌资产是宽幅横条,按 3.3:1 摆)。 */
const DEGREE_PLATE_WIDTH = 264
const DEGREE_PLATE_HEIGHT = 80

/**
 * 渲染一档报酬。
 *
 * 图为什么只有铭牌:见 `rush-reward-preview.ts` 文件头的 store 寻址实测 ——
 * 铭牌是独立 png(实测在),道具图标是共享图集的子纹理(独立文件实测**不在**),
 * 后者硬塞会让客户端走 `SectionCommand.FileNotFound` 弹「数据不足」。
 *
 * @param tier 一档报酬。
 * @returns 富文本片段。
 */
function renderRewardTier(tier: RushRewardPreviewTier): string {
    const lines: string[] = []
    lines.push(`<p><b>${sanitizeRichText(tier.rankLabel)}</b></p>`)

    if (tier.unconfigured) {
        lines.push(`<p><font color="#ea354c">奖励未配置</font></p>`)
        return lines.join("")
    }

    if (tier.itemName !== null) {
        const icon = tier.itemIcon === null
            ? ""
            : `<img src="file://${tier.itemIcon}" width="48" height="48"/>　`
        lines.push(`<p>${icon}${sanitizeRichText(tier.itemName)} ×${tier.itemCount}</p>`)
    }
    if (tier.degreeName !== null) {
        lines.push(`<p>称号　${sanitizeRichText(tier.degreeName)}</p>`)
        if (tier.degreeImage !== null) {
            lines.push(`<p class="center">`
                + `<img src="file://${tier.degreeImage}"`
                + ` width="${DEGREE_PLATE_WIDTH}" height="${DEGREE_PLATE_HEIGHT}"/></p>`)
        }
    }
    return lines.join("")
}

/**
 * 渲染「报酬一览」整节。
 *
 * @param preview 报酬预览(数据源 = 结算配置,不是另写一份)。
 * @returns 富文本片段;没有档位时返回空串。
 */
export function renderRewardPreview(preview: RushRewardPreview): string {
    if (preview.tiers.length === 0) return ""
    const boardName = preview.board === "season-first" ? "当期首通榜" : "战斗用时榜"
    const hasUnboundedTier = preview.tiers.some(tier => tier.toRank === null)
    const scopeNote = hasUnboundedTier
        ? `<p>按<b>${boardName}</b>的名次发放；有名次上限的档位最多计算到第 `
            + `${preview.rankLimit} 名，到榜尾档覆盖其余所有完整成绩。</p>`
        : `<p>按<b>${boardName}</b>的名次发放，发到第 ${preview.rankLimit} 名为止。</p>`
    const uniquenessNote = hasUnboundedTier
        ? `<p>一位玩家只占一个名次（只算他最优的一程），`
            + `所以每个榜位都对应不同的存档。</p>`
        : `<p>一位玩家只占一个名次（只算他最优的一程），所以前 `
            + `${preview.rankLimit} 名就是 ${preview.rankLimit} 个不同的存档。</p>`
    return `<h2>报酬一览</h2>`
        + scopeNote
        + preview.tiers.map(renderRewardTier).join("")
        + uniquenessNote
}

/**
 * 生成整屏排行榜的富文本。
 *
 * @param input 渲染所需的全部数据。
 * @returns 可直接塞进 `data.terms_text` 的富文本。
 */
export function buildRushRankPageHtml(input: RushRankPageInput): string {
    const maxRows = input.maxRows ?? maxRowsFromEnv()
    const parts: string[] = []

    parts.push(`<p class="center">${sanitizeRichText(input.updatedAt)}更新</p>`)

    // 报酬一览**排在榜前面**。理由不是审美:S4/S5 之后这一页唯一的入口就是名次列表
    // 底部那颗「报酬一览」圆钮(名次本身已经在原生列表里了),排在后面等于点进来
    // 先看到两张榜、要一路滚到 84% 处才看得见奖励 —— 那不是作者要的那颗钮。
    const rewards = input.reward === null ? "" : renderRewardPreview(input.reward)
    if (rewards !== "") {
        parts.push(rewards)
        parts.push(`<hr/>`)
    }

    input.boards.forEach((board, index) => {
        if (index > 0) parts.push(`<hr/>`)
        parts.push(renderBoardSection(board, maxRows))
    })

    if (input.season !== null) {
        parts.push(`<p class="center">当前第 ${input.season} 期</p>`)
    }

    return `<html lang="zh"><body class="body"><div class="container">`
        + parts.join("")
        + `</div></body></html>`
}

/**
 * 数据源全部失灵时也要发得出去的兜底正文。
 *
 * `terms_text` 缺了或不是 String 就是 `ClientError 8702` —— loading 进不去、
 * 也退不回深渊连战页。所以这条路径不许抛,只许降级。
 *
 * @returns 一段合法的富文本。
 */
export function buildRushRankPageFallbackHtml(): string {
    return `<html lang="zh"><body class="body"><div class="container">`
        + `<h2>深渊连战 排行榜</h2>`
        + `<p>排行榜暂时取不到数据，请稍后再试。</p>`
        + `</div></body></html>`
}

// ────────────────────────────────────────────────────────────────
// 以下是接数据库的那一半。上面全是纯函数,单测只测上面。
// 例外:resolveRowMains 与 pickParty 虽然写在这条线以下(它们紧挨着唯一的调用方
// loadRowFacets),但都**不碰数据库**,判定规则由 src/tests/rush-row-party.test.ts
// 单独覆盖。
// ────────────────────────────────────────────────────────────────

interface RankPageBoardSpec {
    boardTitle: string
    caption: string
    board: RushRankingBoard
    showSeason: boolean
}

const RANK_PAGE_BOARDS: RankPageBoardSpec[] = [
    {
        boardTitle: "战斗用时榜",
        caption: "同一次从第 1 关连续爬到最终关，每一关战斗结算时间之和；关间选队、整备、读条、掉线都不计。越短越靠前。一位玩家只记录他最优的一程，同一个存档只占一个名次。",
        board: "full-run",
        showSeason: false
    },
    {
        boardTitle: "当期首通榜",
        caption: "每一期里，每个存档的第一次通关。按期号倒序，同期内按首通时刻先后排。",
        board: "season-first",
        showSeason: true
    }
]

/**
 * 这一屏展示哪个连战事件。
 *
 * 这条通道的请求体里没有 `event_id`(客户端写死 `{}`),所以只能服务端定。
 * 默认 700099(深渊连战);`WF_RUSH_RANK_PAGE_EVENT` 可改。
 *
 * @returns 事件与 folder;该事件不是塔(没有多轮 folder)时返回 null。
 */
function resolveRankPageTarget(): { eventId: number, folderId: number } | null {
    const raw = (process.env.WF_RUSH_RANK_PAGE_EVENT ?? "").trim()
    const eventId = raw === "" ? 700099 : Number(raw)
    if (!Number.isFinite(eventId) || eventId <= 0) return null

    const folderId = getRushTowerFolderIdSync(eventId)
    if (folderId === null) return null
    return { eventId, folderId }
}

/**
 * 生成 `tool/agreement` 要发的那段富文本(每次请求现查两张榜)。
 *
 * @param viewerPlayerId 正在看这一屏的存档 ID;给了就把「自身名次」卡填上并高亮同一行。
 * @param nowMs 生成时刻(ms);默认取 {@link rankUpdateTimeMs}(真实墙钟)。单测里传固定值。
 * @returns 富文本;任何异常都退回 {@link buildRushRankPageFallbackHtml}。
 */
export function buildRushLeaderboardAgreementText(
    viewerPlayerId: number | null,
    nowMs: number = rankUpdateTimeMs()
): string {
    try {
        const target = resolveRankPageTarget()
        if (target === null) return buildRushRankPageFallbackHtml()

        const season = peekRushSeasonSync(target.eventId)
        // 报酬只挂在真正发奖的那张榜上,整页只渲染一次;数据源就是结算配置。
        const reward = buildRushRewardPreview(target.eventId, target.folderId)

        const boards = RANK_PAGE_BOARDS.map(spec => {
            const records = getRushBoardRecordsSync(target.eventId, target.folderId, spec.board)
            // 富文本这半边和下面原生榜那半边**在同一次请求里**,所以它也必须批量取数:
            // `toNewsRow` 逐行 getPlayerSync 时,一张榜取回多少行就是多少次同步查询
            // (`BOARD_FETCH_CAP=500`,两张榜 ⇒ 上千次)。行是按全表建的、渲染时才
            // slice —— 不许改成「先切 50 行再建」:`myRow` 要在全表里找、
            // `total` 要用全表行数,切了两处都会错。
            const points = newsRowRankPoints(records)
            const rows = records.map((record, index) =>
                toNewsRow(record, index + 1, viewerPlayerId, rankPointFacet(points, record)))

            return {
                boardTitle: spec.boardTitle,
                caption: spec.caption,
                rows,
                myRow: viewerPlayerId === null ? null : rows.find(row => row.isViewer) ?? null,
                showSeason: spec.showSeason,
                total: rows.length
            }
        })

        return buildRushRankPageHtml({
            updatedAt: formatRushUpdateTime(nowMs),
            boards,
            season: season?.season ?? null,
            reward: reward.tiers.length === 0 ? null : reward
        })
    } catch (error) {
        console.error("[RUSH-LB] agreement page build failed:", error)
        return buildRushRankPageFallbackHtml()
    }
}

// ────────────────────────────────────────────────────────────────
// P4/S2:官方原生列表行(和上面那份富文本**同一次响应**一起发)
// ────────────────────────────────────────────────────────────────

/**
 * `/tool/agreement` 里给客户端原生列表用的那一段。
 *
 * 为什么和富文本共存:P2 的 APK 只读 `terms_text`,P4 的 APK 只读 `rows`。
 * 两个键同时发 ⇒ **任何一步失败,刷回上一版 APK 即可,服务端一个字节都不用改**。
 * 这是整条 P4 链上最便宜的一道保险(方案文档 §6-3)。
 */
export interface RushNativeRankPayload {
    /** 当前展示的那张榜(战斗用时榜)的全部行。客户端本地分页,不再回服务端。 */
    rows: RushNativeRankRow[]
    /** 另一张榜(当期首通榜)的全部行。S4 的「切榜」钮直接换 dataSource,零重取。 */
    list: RushNativeRankRow[]
    /** 观看者自己在 `rows` 那张榜上的最好名次;没上榜时是一行「排名外」卡。 */
    item: RushNativeRankRow | null
    /**
     * 观看者自己那一行在 `rows` 里的**页号(0 起)**,给 S4 的「自身名次」圆钮用。
     *
     * 为什么由服务端算:页大小是客户端补丁里的一条 `pushint`(见
     * {@link NATIVE_PAGE_SIZE}),两边必须同值;算在这里只有一个地方会漂。
     * 认不出人 / 没上榜 / 榜是空的 一律发 0(客户端 `changePage` 自己还会再钳一次,
     * 所以发错也只是跳到第一页,不会崩)。
     */
    page: number
    /**
     * 观看者自己那一行**在那一页里的第几行**(0 起);**没上榜 / 认不出人 = -1**。
     *
     * `page` 只能把列表翻到对的那一页,一页最多 100 行,想「滚到自己那一行」还得
     * 知道行号。客户端做的就是
     * `partyListView.scrollTo(0, row * (cellHeight + cellVerticalSpace))`
     * (204 + 16 = 220)。发 -1 的时候客户端**什么都不做**,而不是滚到第 0 行 ——
     * 「没上榜」和「排第 1」必须能区分开。
     */
    row: number
    /**
     * 观看者自己那一行在 `rows` 里的**全局下标**(0 起);没上榜 = -1。
     *
     * `page`/`row` 是从它算出来的,一起发是为了让客户端(和排障的人)不必反推,
     * 也让「名次排到 {@link NATIVE_ROWS_CAP} 截断之外」这种情况一眼看得出来
     * (那时 `index` 会 ≥ 下发行数)。
     */
    index: number
    /** 顶部黑条文案,已经拼好「更新」二字,例如 `2026.08.28 05:12更新`。 */
    time: string
    /** 主榜**截断前**的总行数(去重后 = 有成绩的存档数)。 */
    total: number
    /** 「报酬一览」档位预览。客户端今天不读它(报酬走富文本页),但先发着。 */
    reward: RushRewardPreviewTier[]
}

/**
 * 观看者没上榜时的置顶卡。读不到存档也要发得出去 —— 这一屏不许抛。
 *
 * @param playerId 存档 ID。
 * @param prefetched 已经在 {@link loadRowFacets} 里批量取过的那一行存档;
 *                   给了就一次数据库都不碰(观看者本来就在预取名单里)。
 * @returns 一行「排名外」卡。
 */
function outOfRankRow(
    playerId: number,
    prefetched?: RowPlayerRow
): RushNativeRankRow {
    try {
        if (prefetched !== undefined) {
            return outOfRankNativeRow(playerId, prefetched.name, getRankDegree(prefetched.rank_point))
        }
        const player = getPlayerSync(playerId)
        if (player === null) return outOfRankNativeRow(playerId, `存档${playerId}`, 1)
        return outOfRankNativeRow(playerId, player.name, getRankDegree(player.rankPoint))
    } catch {
        return outOfRankNativeRow(playerId, `存档${playerId}`, 1)
    }
}

/**
 * 榜「更新于」这个时刻取哪一个钟。
 *
 * **默认取真实墙钟** `Date.now()`。20260828 之前默认取的是服务器钟
 * `getServerDate()`(和界面上其它时间同源),但后台的时间控制会把服务器钟钉在
 * 活动窗口里 —— 实测下发的是 `2025.08.02 01:24更新`,而那天是 2026.08.28。
 * 「更新」说的是**这份榜是什么时候读出来的**,榜是实时查库的,所以真实墙钟才是
 * 这一格的正确语义;把游戏内的活动时钟印在这里只会让人以为榜是一年前的。
 *
 * 想退回服务器钟(和 P2 富文本页顶部那行、界面其它时间保持一致)设
 * `WF_RUSH_RANK_TIME_REAL=0` 重启即可。
 *
 * 顶部黑条和富文本页顶部那一行**共用**本函数 —— 两处显示不同的时刻会更难解释。
 *
 * @returns 毫秒时间戳。
 */
export function rankUpdateTimeMs(): number {
    const useServerClock = (process.env.WF_RUSH_RANK_TIME_REAL ?? "").trim() === "0"
    return useServerClock ? getServerDate().getTime() : Date.now()
}

/**
 * 顶部黑条的时刻文案(已含「更新」二字)。
 *
 * @returns 形如 `2026.08.28 12:03更新`。
 */
function rankUpdateLabel(): string {
    return `${formatRushUpdateTime(rankUpdateTimeMs())}更新`
}

/** 空载荷 —— 任何异常都退回它,绝不让 `/tool/agreement` 抛。 */
function emptyNativeRankPayload(): RushNativeRankPayload {
    return {
        rows: [], list: [], item: null, page: 0, row: -1, index: -1,
        time: rankUpdateLabel(),
        total: 0, reward: []
    }
}

/**
 * 客户端一页放多少行 —— **必须**和补丁里那条 `pushint 100` 同值。
 *
 * 三处同值(方案文档 §1.3-②):客户端 `VerticalListPagerConfig.Set(100)` /
 * 官方 master `ranking_max_records_per_page,100` / 这里算 {@link RushNativeRankPayload.page}
 * 用的除数。改这里就要同时改 `client-patch/rank-p4-native/patch_rank_native.py`
 * 的 `PAGE_SIZE`,否则「自身名次」钮会跳错页。
 */
export const NATIVE_PAGE_SIZE = 100

/**
 * 原生行下发条数上限。
 *
 * **这不是显示偏好,是宿主的硬约束。** S1–S3 借的宿主
 * (`RushEventRankingPartyScene`)吃的还是 party preset,它的 `pager` 是
 * `Option.None` ⇒ `abstractAdapter.limitPerPage = 2147483647` ⇒
 * `VerticalListView` 会把**整页每一行**都做成活的 cell(每帧 `cellFillCount = 10`
 * 批量建,没有窗口化)。
 *
 * **S4 起真正分页了**:客户端在榜模式下设 `VerticalListPagerConfig.Set(100)`,
 * `VerticalListView` 只把当前页的 100 行做成活 cell(`limitPerPage`),
 * 所以这个上限可以从 50 放大。取 200 = 2 页封顶:
 *  · 20260828 起每行的 DB 访问已经全部上移进 {@link loadRowFacets}(整屏 3 条
 *    批查询,与行数无关),所以这个上限不再是查询次数的闸门;
 *    留着它是因为下发体积和客户端建 cell 的代价仍随行数线性增长。
 *    (改造前是每行 **7 次**同步查询 —— `getPlayerSync` 1 次 + 3 个角色 ×
 *     `getPlayerCharacterSync` 2 次 —— 400 行约 2800 次,旧注释写的「约 2 次」
 *     低估了 3.5 倍。)
 *  · 200 < `BOARD_FETCH_CAP = 500`,所以取数那一层照旧封顶,不会被这里放大。
 *
 * 自身名次卡 `item` 和 {@link RushNativeRankPayload.page} 都是在截断**之前**
 * 按全表算的,所以名次排到 200 名开外的玩家依然看得到自己的真实名次。
 */
export const NATIVE_ROWS_CAP = 200

/**
 * 榜行三个头像画谁的**来源开关**。
 *
 * 默认 `profile` = 画「个人资料里的前三个角色」(作者裁定 2026-08-28 晚);
 * 设 `WF_RUSH_RANK_ROW_PARTY=snapshot` 整屏退回**那一程的实战队伍**快照,
 * 也就是本改动之前的行为。
 *
 * 留这个开关的理由和 {@link NATIVE_ROWS_CAP} 旁边那个 `WF_RUSH_RANK_NATIVE_ICONS`
 * 一样具体:新来源意味着「以前从没被下发过的角色 ID」会突然出现在榜上,
 * 而客户端读不到贴图走的是 `SectionCommand.FileNotFound`(弹「数据不足」拉重下),
 * 不是空框降级。真出事时要能**一条环境变量回滚**,不用重铸 APK、也不用改代码。
 */
function rowPartyFromProfile(): boolean {
    return (process.env.WF_RUSH_RANK_ROW_PARTY ?? "").trim().toLowerCase() !== "snapshot"
}

/** 批量取回来的一行 `players`(只取本屏用得上的列)。 */
interface RowPlayerRow {
    id: number
    name: string
    rank_point: number
    party_slot: number | null
    leader_character_id: number | null
}

/** 批量取回来的一行 `players_parties`。 */
export interface RowPartyRow {
    player_id: number
    group_id: number
    slot: number
    character_id_1: number | null
    character_id_2: number | null
    character_id_3: number | null
    unison_character_1: number | null
    unison_character_2: number | null
    unison_character_3: number | null
}

/**
 * 挑「个人资料页会显示的那一队」—— **兜底链必须和资料页逐条相同**。
 *
 * 资料页(`src/routes/api/profile.ts`)是两层兜底:
 *   `groups[groupId] ?? Object.values(groups)[0]` → `list[partySlot] ?? Object.values(list)[0]`
 * 也就是「精确取那一组那一格;取不到就用第一组的第一格」。
 * 这里只做精确查找的话,`party_slot` 指的那一行一旦不存在(后台改过 party_slot、
 * 或那支队被删了),榜行会退回成绩快照而资料页照样画得出队伍 ——
 * **同一个存档两屏两支队**,正是本轮给 bot 补编队要消灭的那种不一致。
 *
 * 「第一个」的定义这里收成**最小 group、其中最小 slot**:资料页那两个
 * `Object.values(...)[0]` 靠的是 JS 对象的整数键升序枚举,等价于取最小键。
 *
 * @param parties 批量取回的编队,键是 `playerId:groupId:slot`。
 * @param playerId 存档 ID。
 * @param groupId `party_slot` 解出的组号。
 * @param slot `party_slot` 解出的格号。
 * @returns 命中的那一行;该存档一支普通编队都没有时 `undefined`。
 */
export function pickParty(
    parties: Map<string, RowPartyRow>,
    playerId: number,
    groupId: number,
    slot: number
): RowPartyRow | undefined {
    const exact = parties.get(`${playerId}:${groupId}:${slot}`)
    if (exact !== undefined) return exact

    let best: RowPartyRow | undefined
    for (const row of parties.values()) {
        if (row.player_id !== playerId) continue
        if (best === undefined
            || row.group_id < best.group_id
            || (row.group_id === best.group_id && row.slot < best.slot)) {
            best = row
        }
    }
    return best
}

/** 批量取回来的一行 `players_characters`(只取算立绘等级要用的两列)。 */
interface RowCharacterRow {
    player_id: number
    id: number
    evolution_level: number | null
    illustration_settings: string | null
}

/**
 * `IN (...)` 一次最多塞多少个占位符。
 *
 * SQLite 3.46(better-sqlite3 现在打包的版本)的 `SQLITE_MAX_VARIABLE_NUMBER`
 * 是 32766,今天的最大规模(2 张榜 × {@link NATIVE_ROWS_CAP} = 400 个存档 +
 * 至多 1200 个角色 ID)离它还很远,所以实际每类查询都只会发出**一条** SQL。
 * 分片留在这里是为了「有人把 NATIVE_ROWS_CAP 调大到几千」的那一天不会
 * 突然吃一个 `too many SQL variables`。
 */
const PARAM_CHUNK = 500

function chunked<T>(values: T[], size: number = PARAM_CHUNK): T[][] {
    if (values.length <= size) return values.length === 0 ? [] : [values]
    const out: T[][] = []
    for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
    return out
}

function marks(count: number): string {
    return new Array(count).fill("?").join(",")
}

/** 编队投影的结果 —— `source` 只用于日志和单测断言,不下发。 */
export type RushRowMainsSource = "party" | "party-compacted" | "snapshot"

/**
 * 这一行的三个头像画谁 —— **纯函数**,不碰数据库(取数在 {@link loadRowFacets})。
 *
 * 兜底判据(作者选的那一支:「编队能用就用编队,用不了就显示他打那一程的实战队伍」):
 *  1. 开关设成 `snapshot` ⇒ 直接用成绩快照;
 *  2. 存档已删 / 查不到 `players` 行 ⇒ 成绩快照(已删存档没有任何编队可查,
 *     而快照是随成绩冻结的,活得过删档);
 *  3. `players.party_slot` 指的那一队查不到 ⇒ 成绩快照;
 *  4. 编队投影 {@link buildProfileFavoriteParty} 命中 `party` / `party-compacted`
 *     ⇒ 用它的主位(和个人资料页**逐槽一致**,点进去两屏对得上);
 *  5. 投影落到 `leader` / `owned` / null ⇒ 成绩快照。
 *     这一条不是可有可无的:实测存档 #1 的当前编队主位 1 是助战角色 700016
 *     (`isShippableCharacterId` 拒发)、2/3 为空,投影会一路退到 `leader`,
 *     而它的 `leader_character_id = 1`(alk)—— 榜上就会出现一个与这位玩家
 *     毫无关系的头像。退回快照至少画的是他真打过的那一队。
 *
 * @param record 成绩记录(快照来源)。
 * @param player 该存档的 `players` 行;null = 存档已删或没取到。
 * @param party 该存档当前选中那一队;null = 没取到。
 * @returns 三个主位(长度恒 3)+ 命中了哪一条。
 */
export function resolveRowMains(
    record: RushRunRecord,
    player: { leaderCharacterId: number | null } | null,
    party: { mains: (number | null)[], unisons: (number | null)[] } | null
): { mains: (number | null)[], source: RushRowMainsSource } {
    const snapshot = (): { mains: (number | null)[], source: RushRowMainsSource } => ({
        mains: [0, 1, 2].map(slot => record.characterIds[slot] ?? null),
        source: "snapshot"
    })

    if (!rowPartyFromProfile()) return snapshot()
    if (player === null || party === null) return snapshot()

    const favorite = buildProfileFavoriteParty({
        mains: party.mains,
        unisons: party.unisons,
        leaderCharacterId: player.leaderCharacterId
    })
    // **只认前两条规则**。leader / owned 那两条兜底是为了「个人资料页槽 0 不许为空」
    // 这条客户端硬约束存在的,拿到榜行上来只会画一个与玩家无关的角色。
    if (favorite !== null && (favorite.source === "party" || favorite.source === "party-compacted")) {
        return { mains: [0, 1, 2].map(slot => favorite.mains[slot] ?? null), source: favorite.source }
    }
    return snapshot()
}

/**
 * 一次请求把**整屏**要用的存档侧数据批量取好。
 *
 * ── 为什么这是前置条件而不是优化 ────────────────────────────────
 * 改造前每一行要打 **7 次同步查询**:`getPlayerSync`(1)+ 3 个角色 ×
 * `getPlayerCharacterSync`(2,其中查 `players_characters_bond_tokens` 那一条
 * 本屏根本用不上)。两张榜各 {@link NATIVE_ROWS_CAP}=200 行 ⇒ 约 **2800 次**
 * better-sqlite3 **同步**调用跑在 async handler 里,全程占住事件循环。
 * 在这个基础上再天真地「每行查一次编队」会更糟:`getPlayerPartyGroupListSync`
 * 一次会把该存档**全部** 120~240 支队伍反序列化出来,并且每次打一条
 * `[PARTY-READ]` 日志(`src/data/domains/party.ts:59`)。
 *
 * 改造后整屏固定 **3 条**查询(存档 / 编队 / 角色立绘),与行数无关。
 * 往榜行上加新数据源时请继续走这里,不要回到逐行现查。
 *
 * 刻意**不用** `getPlayerPartyGroupListSync`:理由同上。这里直接读
 * `players_parties`,并且只挑 `party_slot` 指的那一行。
 *
 * @param records 本屏所有榜的成绩记录(两张榜合起来,可含重复存档)。
 * @param viewerPlayerId 观看者存档 ID;一并预取,好让「排名外」卡也不用再查库。
 * @returns 按 `run id` 索引的行数据 + 按存档 ID 索引的 `players` 行。
 */
function loadRowFacets(
    records: RushRunRecord[],
    viewerPlayerId: number | null
): { byRunId: Map<number, RushNativeRowFacets>, players: Map<number, RowPlayerRow> } {
    const byRunId = new Map<number, RushNativeRowFacets>()
    const players = new Map<number, RowPlayerRow>()
    if (records.length === 0 && viewerPlayerId === null) return { byRunId, players }

    try {
        const db = getDb()

        // (1) players —— 名字/等级/当前编队槽位/队长角色
        const playerIds = [...new Set([
            ...records.map(record => record.playerId),
            ...(viewerPlayerId === null ? [] : [viewerPlayerId])
        ])].filter(id => Number.isFinite(id) && id > 0)
        for (const ids of chunked(playerIds)) {
            const rows = db.prepare(`
            SELECT id, name, rank_point, party_slot, leader_character_id
            FROM players WHERE id IN (${marks(ids.length)})
            `).all(ids) as RowPlayerRow[]
            for (const row of rows) players.set(row.id, row)
        }

        // (2) players_parties —— 只要普通编队(category=NORMAL),槽位在 JS 侧挑
        const parties = new Map<string, RowPartyRow>()
        for (const ids of chunked(playerIds)) {
            const rows = db.prepare(`
            SELECT player_id, group_id, slot,
                character_id_1, character_id_2, character_id_3,
                unison_character_1, unison_character_2, unison_character_3
            FROM players_parties
            WHERE player_id IN (${marks(ids.length)}) AND category = ?
            `).all([...ids, PartyCategory.NORMAL]) as RowPartyRow[]
            for (const row of rows) parties.set(`${row.player_id}:${row.group_id}:${row.slot}`, row)
        }

        // (3) 先把「这一行画谁」定下来,才知道要查哪些角色的立绘等级
        const mainsByRunId = new Map<number, (number | null)[]>()
        const owners = new Set<number>()
        const characterIds = new Set<number>()
        for (const record of records) {
            const player = players.get(record.playerId) ?? null
            // party_slot 的解码必须和个人资料页逐字一致
            // (src/routes/api/profile.ts:391-393),否则「榜行 vs 点进去的资料页」
            // 会画出两支不同的队伍。
            let party: { mains: (number | null)[], unisons: (number | null)[] } | null = null
            if (player !== null) {
                const slot = Math.max(1, Math.trunc(player.party_slot || 1))
                const raw = pickParty(
                    parties, player.id,
                    Math.floor((slot - 1) / 10) + 1, ((slot - 1) % 10) + 1)
                if (raw !== undefined) {
                    party = {
                        mains: [raw.character_id_1, raw.character_id_2, raw.character_id_3],
                        unisons: [raw.unison_character_1, raw.unison_character_2, raw.unison_character_3]
                    }
                }
            }
            const resolved = resolveRowMains(
                record,
                player === null ? null : { leaderCharacterId: player.leader_character_id },
                party
            )
            mainsByRunId.set(record.id, resolved.mains)
            for (const id of resolved.mains) {
                if (id === null) continue
                characterIds.add(id)
                owners.add(record.playerId)
            }
        }

        // (4) players_characters —— 立绘等级。**不查 bond_tokens**(本屏用不上,
        //     而 getPlayerCharacterSync 每次都白查一遍)。
        const levels = new Map<string, number>()
        const ownerIds = [...owners]
        const charIds = [...characterIds]
        if (ownerIds.length > 0 && charIds.length > 0) {
            for (const ownerChunk of chunked(ownerIds)) {
                for (const charChunk of chunked(charIds)) {
                    const rows = db.prepare(`
                    SELECT player_id, id, evolution_level, illustration_settings
                    FROM players_characters
                    WHERE player_id IN (${marks(ownerChunk.length)})
                        AND id IN (${marks(charChunk.length)})
                    `).all([...ownerChunk, ...charChunk]) as RowCharacterRow[]
                    for (const row of rows) {
                        // 语义照抄 src/lib/character.ts:310-320 —— 立绘设置优先于进化等级。
                        const settings = row.illustration_settings === null
                            ? [] : deserializeNumberList(row.illustration_settings)
                        const first = settings[0]
                        const chosen = first === undefined || first === null
                            ? (row.evolution_level ?? 0) : first
                        levels.set(`${row.player_id}:${row.id}`, Number(chosen) || 0)
                    }
                }
            }
        }

        // (5) 组装。等级按**槽位**填,不做「压掉空位再填回去」那一步 ——
        //     那正是 rush-leaderboard-ranking.ts 踩过的错位坑。
        for (const record of records) {
            const player = players.get(record.playerId)
            const mains = mainsByRunId.get(record.id) ?? []
            const evolutionLevels: (number | null)[] = []
            for (let slot = 0; slot < NATIVE_ROW_SLOTS; slot++) {
                const id = mains[slot] ?? null
                evolutionLevels.push(id === null ? null : levels.get(`${record.playerId}:${id}`) ?? 0)
            }
            byRunId.set(record.id, {
                mains,
                evolutionLevels,
                userRank: player === undefined ? 1 : getRankDegree(player.rank_point)
            })
        }
    } catch (error) {
        // 取数失败不许把整屏榜打空。但要说清楚这个兜底**降级到什么程度**:
        // facets 为空时 toNativeRankRow 的三项各走各的
        //   · mains          → 退回成绩快照 record.characterIds(画得出队伍)
        //   · userRank       → 逐行现查 userRankOf(慢,但值是对的)
        //   · evolutionLevels→ **不现查**,整屏按 0 处理 ⇒ 头像一律拼
        //                      `thumb_party_unison_0`,已觉醒的角色会显示未觉醒立绘
        // 最后一条是刻意的:等级只影响立绘序号,读错也只是画错一张图,
        // 而在「数据库刚刚抛过异常」的当口再逐行补 2 次查询 × 400 行只会更糟。
        // (别再把这段写成「整体退回逐行现查」—— 20260828 复核抓到过这句假话。)
        console.error("[RUSH-LB] row facets prefetch failed:", error)
    }

    return { byRunId, players }
}

/**
 * 把一张榜的记录整批投影成原生行。
 *
 * @param records 已排好序的成绩记录。
 * @param facets {@link loadRowFacets} 预取好的行数据(按 run id 索引)。
 * @returns 行数组(至多 {@link NATIVE_ROWS_CAP} 行),名次按数组下标 +1。
 */
function toNativeRows(
    records: RushRunRecord[],
    facets: Map<number, RushNativeRowFacets>
): RushNativeRankRow[] {
    return records.slice(0, NATIVE_ROWS_CAP).map((record, index) =>
        toNativeRankRow(record, index + 1, facets.get(record.id) ?? {}))
}

/**
 * 名次 → 客户端要跳到第几页(0 起)。
 *
 * 名次可能排在 {@link NATIVE_ROWS_CAP} 截断之外(那一行根本没下发),这时候钳到
 * **最后一页**而不是发一个越界页号 —— 客户端 `VerticalListLogic.changePage` 虽然
 * 自己也会钳,但它钳的依据是它手里的行数,发个越界值只会让钮看起来「跳到末页」
 * 却没有语义。这里先钳,语义就落在服务端一处。
 *
 * @param rankNumber 名次(1 起)。
 * @param shippedRows 实际下发了多少行。
 * @returns 页号(0 起);行数为 0 时是 0。
 */
export function nativeViewerPageIndex(rankNumber: number, shippedRows: number): number {
    if (!Number.isFinite(rankNumber) || rankNumber < 1) return 0
    const page = Math.floor((rankNumber - 1) / NATIVE_PAGE_SIZE)
    if (shippedRows <= 0) return 0
    const lastPage = Math.ceil(shippedRows / NATIVE_PAGE_SIZE) - 1
    return Math.max(0, Math.min(page, lastPage))
}

/**
 * 名次 → 客户端要滚到那一页里的第几行(0 起)。
 *
 * 名次排在 {@link NATIVE_ROWS_CAP} 截断之外时那一行根本没下发,滚过去只会停在
 * 一堆别人的行上 ⇒ 一律返回 **-1**(客户端不滚)。
 *
 * @param rankNumber 名次(1 起)。
 * @param shippedRows 实际下发了多少行。
 * @returns 页内行号(0 起);未上榜 / 被截断 / 参数非法一律 -1。
 */
export function nativeViewerRowIndex(rankNumber: number, shippedRows: number): number {
    if (!Number.isFinite(rankNumber) || rankNumber < 1) return -1
    const index = Math.trunc(rankNumber) - 1
    if (shippedRows <= 0 || index >= shippedRows) return -1
    return index % NATIVE_PAGE_SIZE
}

/**
 * 生成 `/tool/agreement` 里的原生列表载荷(每次请求现查两张榜,一次取全)。
 *
 * 为什么一次取全:这条通道的请求体是客户端写死的 `{}`,带不了 `page` / `board`。
 * 私服榜长封顶 500 行,全下发的代价可以忽略,换来的是「翻页跨快照错行」和
 * 「page 越界」两个问题当场消失(方案文档 §4.1)。
 *
 * @param viewerPlayerId 正在看这一屏的存档 ID;null = 认不出人,不发自身名次卡。
 * @returns 载荷;任何异常都退回空载荷(客户端会显示一张空榜,不会崩)。
 */
export function buildRushNativeRankPayload(viewerPlayerId: number | null): RushNativeRankPayload {
    try {
        const target = resolveRankPageTarget()
        if (target === null) return emptyNativeRankPayload()

        // 每张榜**只取一次**。20260828 之前主榜被取了两次(一次投影成行、一次算
        // 自身名次),两次之间榜可能已经变了 —— 名次和行会对不上。
        const boardRecords = RANK_PAGE_BOARDS.map(spec =>
            getRushBoardRecordsSync(target.eventId, target.folderId, spec.board))
        const primaryRecords = boardRecords[0] ?? []

        // 整屏的存档侧数据一次批量取好(3 条查询,与行数无关)。观看者一并预取,
        // 「排名外」卡也就不用再单独查一次库。
        const facets = loadRowFacets(boardRecords.flat(), viewerPlayerId)

        const boards = boardRecords.map(records => toNativeRows(records, facets.byRunId))
        const primary = boards[0] ?? []
        const secondary = boards[1] ?? []

        let item: RushNativeRankRow | null = null
        let page = 0
        let row = -1
        let index = -1
        if (viewerPlayerId !== null) {
            index = primaryRecords.findIndex(record => record.playerId === viewerPlayerId)
            item = index < 0
                // 没上榜:官方是拿本地玩家数据伪造一张「排名外」卡。服务端认得出
                // 是谁的时候就在这里拼好,客户端只做「有卡就填、没卡就藏」。
                ? outOfRankRow(viewerPlayerId, facets.players.get(viewerPlayerId))
                : toNativeRankRow(primaryRecords[index]!, index + 1,
                    facets.byRunId.get(primaryRecords[index]!.id) ?? {})
            page = index < 0 ? 0 : nativeViewerPageIndex(index + 1, primary.length)
            row = index < 0 ? -1 : nativeViewerRowIndex(index + 1, primary.length)
        }

        const reward = buildRushRewardPreview(target.eventId, target.folderId)

        return {
            rows: primary,
            list: secondary,
            item,
            page,
            row,
            index,
            time: rankUpdateLabel(),
            total: primaryRecords.length,
            reward: reward.tiers
        }
    } catch (error) {
        console.error("[RUSH-LB] native rank payload build failed:", error)
        return emptyNativeRankPayload()
    }
}
