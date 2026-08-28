/**
 * 深渊连战排行榜 —— **官方原生列表行**(P4/S2)。
 *
 * ── 这是谁在吃 ──────────────────────────────────────────────────
 * 客户端补丁把 `RushEventRankingPartyListCellContentView` 的行布局换成了官方
 * 榜自带的 `scene/rush/rush_event_ranking` → `layout/list_cell`,并直接把
 * 槽位文本从行对象上读出来:
 *
 *   ranking_rank  <- row.rank     黑旗里的「4337位」/「排名外」
 *   rank_label    <- row.visible   黑旗本体的可见性
 *   player_rank   <- row.level    「RANK169」
 *   user_name     <- row.name      玩家名
 *   kill_count    <- row.count    「BEST RECORD: 6战」
 *   best_score    <- row.time     「TIME: 07:19.16」
 *   thumbnail000/001/002 的 image <- row.a / row.b / row.c(逻辑贴图路径或 null)
 *   (整行的点击)          <- row.id     该成绩的「个人资料目标 ID」,0 = 不可点
 *
 * ── 为什么文案在服务端拼好 ──────────────────────────────────────
 * 客户端那一侧是**手写 AVM2 字节码**,每少一步就少一处静默失效点:
 *  ① 不用 `getUiStringWithContext` ⇒ 不依赖 master `ui_string` 里那 5 个键,
 *    也就不会踩「键不在 master ⇒ MasterBinaryMap 删表 + ClientError 8601」;
 *  ② 不用 `TimeSpan_Impl_.formatToMMSSFF` ⇒ 少一次跨包静态调用;
 *  ③ 不用 `GeneralCharacterLogic` 查角色主表 ⇒ **彻底绕开 ClientError 8013**
 *    (角色 ID 不在 master 时那个构造函数会抛,整屏开不起来)。
 * 代价:文案在这里必须和 master 逐字一致。原文(设备 master/string/ui_string):
 *   rush_event_ranking_ranking_rank   `::value::位`
 *   rush_event_ranking_player_rank    `RANK::value::`
 *   rush_event_ranking_best_record    `BEST RECORD: ::value::战`
 *   rush_event_ranking_time           `TIME: ::value::`
 *   rush_event_ranking_out_of_ranking `排名外`
 *
 * ── 三个头像画的是谁(作者裁定 2026-08-28 晚)────────────────────
 * **优先画「个人资料里的前三个角色」**,也就是 `players.party_slot` 指的那一队的
 * 主位 1/2/3(和资料页 `src/routes/api/profile.ts` 完全同一份投影)。
 * 编队取不到 / 整支都不可下发时退回**那一程的实战队伍**(成绩行里的
 * `character_id_1..3` 快照)—— 作者选的兜底是「退回实战队伍」,不是「留空框」。
 *
 * ⚠ **不要读成「三个头像永远是满的」**(20260828 复核纠正)。兜底是**整支切换**,
 * 命中编队就把那一支照发:编队里可下发的主位不足 3 个,这一行就画不足 3 个头像。
 * 实测当前库里 620 支普通编队中有 **41 支**属于这种(例:`[169980,null,null]` ⇒
 * 1 个头像;`[1,700016,151011]` ⇒ 助战位被降级成 null,画成「头像-空-头像」)。
 * 今天在榜的 25 行恰好都是满的,只是因为没人把 `party_slot` 指到那些队上。
 * 这是**刻意**的:逐槽混拼编队和快照会拼出一支从没存在过的队伍,而
 * 「按槽位留空」正是资料页同一份投影的行为,两屏因此仍然一致。
 * 想改成「不足 3 个就整支退回快照」是个产品决定(代价:两屏又会不一致),
 * 改的话 {@link RushNativeRowFacets} 那一侧不用动,只改
 * `rush-leaderboard-agreement.ts::resolveRowMains`。
 *
 * 决策与取数都在调用方(`rush-leaderboard-agreement.ts` 的 `loadRowFacets`,
 * 一次请求几条批查询),本文件退回**纯投影**:给什么角色 ID 就拼什么路径。
 * 理由是性能 —— 逐行现查会变成每行 7 次同步 DB 查询 × 400 行。
 *
 * ⚠ 后果(作者知情):榜行头像不再是战绩的一部分。玩家换编队,历史成绩那一行的
 * 头像跟着变,而名次/用时是冻结的。
 * ⚠ 另三个渲染器(公告版 `rush-leaderboard-news.ts`、官方契约端点
 * `rush-leaderboard-ranking.ts`、后台页 `admin/src/pages/RushLeaderboard.tsx`)
 * **刻意保持显示实战快照队伍**:后台那一页的用途正是排障看「那一程到底打了什么」,
 * 换成当前编队是功能倒退。所以同一份榜上会有两种语义的头像,这是有意的。
 *
 * ── 字段名为什么这么短 ──────────────────────────────────────────
 * `rank / visible / level / name / count / time / a / b / c / id` 不是随手起的:
 * 客户端补丁的铁律是**不往 AVM2 常量池里加 multiname**,所以每个字段名都必须
 * 是 P2 包常量池里**已经存在**的 `QName(PackageNamespace(""),…)`。
 * 改名之前先用 mod-tools 那套常量池探针复核,否则补丁要重铸。
 */

import type { RushRunRecord } from "../data/domains/rushLeaderboard";
import { getPlayerSync } from "../data/domains/player";
import { getRankDegree } from "./stamina";
import { getCharactersEvolutionImgLevels } from "./character";
import { codeNameOf } from "./rush-leaderboard-news";
import { isShippableCharacterId } from "./rush-leaderboard-ranking";

/** 官方行一行三个主位头像。 */
export const NATIVE_ROW_SLOTS = 3

/**
 * 「个人资料目标 ID」的命名空间基数。
 *
 * 客户端点一行 → `LoadingTaskKind.ProfileGetProfile(id)` →
 * `ProfileGetProfileRealRemote` 把它原样当 `target_viewer_id` 发给
 * `POST profile/get_profile`(`弹国服/scripts/pinball/remote/profile/getProfile/
 * ProfileGetProfileRealRemote.as:24`)。客户端**只是搬运**,不解释这个数。
 *
 * 榜行的身份是**存档 id**(players.id),不是 viewer_id —— 一个账号可以有多个存档,
 * viewer_id 只认账号,拿它当榜行身份会把同账号的两个存档混成一个人。
 * 所以这里发的是 `PROFILE_ID_BASE + playerId`,服务端 `profile/get_profile`
 * 再减回去。
 *
 * 基数取 9e9 的理由:真实 viewer_id 是 `generateViewerId()` 生成的 9 位数
 * (实测 306205655 量级,上限 < 1e10 但远小于 9e9),两个区间不相交
 * ⇒ 同一个端点既能吃真 viewer_id 也能吃榜行 id,不需要第二个端点。
 * 9e9 在 IEEE754 双精度里是精确整数,msgpack 也按整数编。
 */
export const RUSH_PROFILE_ID_BASE = 9_000_000_000

/**
 * 存档 id → 客户端要回传的「个人资料目标 ID」。
 *
 * @param playerId 存档 id;非正数一律给 0(客户端把 0 当「这一行不可点」)。
 */
export function toProfileTargetId(playerId: number): number {
    if (!Number.isFinite(playerId) || playerId <= 0) return 0
    return RUSH_PROFILE_ID_BASE + Math.trunc(playerId)
}

/**
 * 「个人资料目标 ID」→ 存档 id。
 *
 * @param targetId 客户端回传的 `target_viewer_id`。
 * @returns 存档 id;不在本命名空间里返回 null(调用方去按真 viewer_id 解析)。
 */
export function fromProfileTargetId(targetId: number): number | null {
    if (!Number.isFinite(targetId)) return null
    const playerId = Math.trunc(targetId) - RUSH_PROFILE_ID_BASE
    return playerId > 0 ? playerId : null
}

/** 客户端读的那一行。字段名见文件头「字段名为什么这么短」。 */
export interface RushNativeRankRow {
    /** `ranking_rank` 文本:「1位」/「排名外」。 */
    rank: string
    /** `rank_label`(黑色名次旗)是否可见。未上榜时官方隐藏它。 */
    visible: boolean
    /** `player_rank` 文本:「RANK169」。 */
    level: string
    /** `user_name` 文本。 */
    name: string
    /** `kill_count` 文本:「BEST RECORD: 30战」。 */
    count: string
    /** `best_score` 文本:「TIME: 04:17.13」。 */
    time: string
    /** 主位 0/1/2 的头像逻辑路径;空位、不可下发的 ID、查不到 code_name 一律 null。 */
    a: string | null
    b: string | null
    c: string | null
    /**
     * 点这一行要打开谁的个人资料({@link toProfileTargetId});
     * **0 = 不可点**(存档已删,查不到资料)。
     */
    id: number
}

/**
 * 复刻 `pinball.common.time._TimeSpan.TimeSpan_Impl_.formatToMMSSFF`。
 *
 * 逐行对齐客户端实现(含那两个 `1e-10` 的浮点补偿和「分钟不取模 60」):
 *   minutes = floor(ms/60000 + 2e-10)
 *   seconds = floor(ms/1000  + 2e-10) % 60
 *   centis  = floor(ms/10    + 2e-10) % 100
 *
 * @param ms 毫秒数;负数按 0 处理(客户端 `TimeSpan._new` 也是 `Math.max(0, …)`)。
 * @returns 形如 `04:17.13` 的字符串。分钟数 >= 100 时不截断。
 */
export function formatMmSsFf(ms: number): string {
    const value = Number.isFinite(ms) ? Math.max(0, ms) : 0
    const minutes = Math.floor(value / 60 / 1000 + 1e-10 + 1e-10)
    const seconds = Math.floor(value / 1000 + 1e-10 + 1e-10) % 60
    const centis = Math.floor(value / 10 + 1e-10 + 1e-10) % 100
    const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
    return `${pad(minutes)}:${pad(seconds)}.${pad(centis)}`
}

/**
 * 头像开关。设 `WF_RUSH_RANK_NATIVE_ICONS=0` 时整屏不发头像路径。
 *
 * 留这个开关的理由很具体:客户端读不到贴图文件时走的**不是**「空框降级」,
 * 而是 `SectionCommand.FileNotFound` —— 也就是玩家会看到「数据不足」并被拉去
 * 重下资源。真出这种事的时候要能一条环境变量关掉,而不是回滚 APK。
 */
function iconsEnabled(): boolean {
    return (process.env.WF_RUSH_RANK_NATIVE_ICONS ?? "").trim() !== "0"
}

/**
 * 角色 ID → 头像逻辑路径。
 *
 * 路径规则来自 `CharacterBaseImpl.getPartyUnisonImagePathOfEvolutionLevel`:
 * `character/<code_name>/ui/thumb_party_unison_<0|1>`,进化立绘等级**只有 0/1**
 * (客户端把 >1 钳到 1,<0 抛 ClientError 2027,这里直接钳死在服务端)。
 *
 * 能不能发由 {@link isShippableCharacterId} **单点**说了算(主表存在性 + 排除
 * 助战段 700000–700099)。这里不重抄那两个常量:助战角色的 code_name 查得到,
 * 但 `thumb_party_unison_*` 大多在 store 里没有实体文件,而客户端读不到贴图走的
 * 不是空框降级,是 `SectionCommand.FileNotFound` ⇒ 玩家被弹「数据不足」拉去重下。
 *
 * @param characterId 角色 ID;null = 空位。
 * @param evolutionImgLevel 进化立绘等级,任意整数都会被钳到 0/1。
 * @returns 逻辑路径;空位、开关关掉、不可下发的 ID、或 code_name 查不到时返回 null。
 */
export function nativeThumbnailPath(
    characterId: number | null,
    evolutionImgLevel: number | null
): string | null {
    if (!isShippableCharacterId(characterId)) return null
    if (!iconsEnabled()) return null

    const code = codeNameOf(characterId as number)
    if (code === null) return null

    const raw = Number(evolutionImgLevel ?? 0)
    const level = !Number.isFinite(raw) ? 0 : Math.min(1, Math.max(0, Math.trunc(raw)))
    return `character/${code}/ui/thumb_party_unison_${level}`
}

/**
 * 取一条成绩里三个主位角色**当前**的进化立绘等级(**逐行现查版**)。
 *
 * 成绩行里只存了角色 ID,立绘序号是存档的实时状态。查等级只能拿非空 ID 去查,
 * 但结果必须放回**原来的槽位** —— 否则「1 号位空、2 号位有人」的队伍会把 2 号位
 * 的等级安到 1 号位上(这条坑 `rush-leaderboard-ranking.ts` 已经踩过一次)。
 *
 * ⚠ **原生榜载荷不再走这条路**(2026-08-28):它每个非空角色要打 2 次同步查询,
 * 400 行就是约 2400 次,全程占住事件循环。原生榜改由
 * `rush-leaderboard-agreement.ts::loadRowFacets` 一次批量取好、经
 * {@link RushNativeRowFacets} 喂进来。要给原生榜加新数据源时**别再回到这里**逐行查。
 *
 * @param record 成绩记录。
 * @returns 长度 3 的数组,按槽位对齐;查不到一律 0。
 */
export function nativeEvolutionLevels(record: RushRunRecord): (number | null)[] {
    const filled = record.characterIds
        .map((id, slot) => ({ id, slot }))
        .filter((entry): entry is { id: number, slot: number } => entry.id !== null)

    let levels: (number | null)[] = []
    try {
        levels = record.playerExists && filled.length > 0
            ? getCharactersEvolutionImgLevels(record.playerId, filled.map(entry => entry.id))
            : []
    } catch {
        levels = []
    }

    const bySlot: (number | null)[] = [null, null, null]
    filled.forEach((entry, index) => {
        bySlot[entry.slot] = levels[index] ?? 0
    })
    return bySlot
}

/**
 * 没上榜时的「排名外」卡(P4/S5 的置顶自身名次卡)。
 *
 * 官方的做法是客户端拿本地玩家数据伪造一张卡;我们的客户端补丁是手写字节码,
 * 少一条查询就少一处静默失效点,所以**服务端认得出人的时候就把卡拼好**,
 * 客户端只做「有卡就填、没卡就藏」。
 *
 * 文案逐字对齐设备 master `ui_string`:
 *   `rush_event_ranking_out_of_ranking` = `排名外`
 * 黑色名次旗按官方隐藏(`visible=false`)。
 *
 * @param playerId 存档 ID。
 * @param name 玩家名。
 * @param userRank 玩家等级。
 * @returns 一行「排名外」卡。
 */
export function outOfRankNativeRow(
    playerId: number,
    name: string,
    userRank: number
): RushNativeRankRow {
    return {
        rank: "排名外",
        visible: false,
        level: `RANK${userRank}`,
        name,
        count: "BEST RECORD: 0战",
        time: "TIME: --:--.--",
        a: null,
        b: null,
        c: null,
        // 自己的卡不需要「点开看自己的资料」,而且 0 正好是客户端的「不可点」哨兵
        id: 0
    }
}

/** 玩家等级;存档没了或读崩就退回 1(界面只拿它显示「RANK N」)。 */
function userRankOf(record: RushRunRecord): number {
    try {
        const player = record.playerExists ? getPlayerSync(record.playerId) : null
        return player === null ? 1 : getRankDegree(player.rankPoint)
    } catch {
        return 1
    }
}

/**
 * 一行所需的、**已经批量取好**的存档侧数据。
 *
 * 每一项都是「可缺省」的:缺了就退回本文件自己的老路径(成绩快照 / 现查等级 /
 * 现查玩家等级),所以单测和任何旧调用点都不必先准备一份 facets。
 * 生产路径上这三项一律由 `rush-leaderboard-agreement.ts::loadRowFacets` 填满,
 * 于是整个 {@link toNativeRankRow} 一次数据库都不碰。
 */
export interface RushNativeRowFacets {
    /**
     * 三个头像画谁(按槽位对齐,长度 3)。
     * 缺省 = 用成绩行里的实战快照 `record.characterIds`。
     */
    mains?: readonly (number | null)[]
    /** 三个槽位的进化立绘等级;缺省按 0 处理。 */
    evolutionLevels?: readonly (number | null)[]
    /** 玩家等级(界面上的「RANK N」);缺省 = 现查一次存档({@link userRankOf})。 */
    userRank?: number
}

/**
 * 一条成绩 → 一行官方原生列表行。
 *
 * @param record 成绩记录。
 * @param rankNumber 名次(1 起);null = 未上榜(黑旗隐藏,文案走「排名外」)。
 * @param facets 批量取好的存档侧数据;缺省时整体退回逐行现查的老路径。
 * @returns 客户端补丁认识的行对象。
 */
export function toNativeRankRow(
    record: RushRunRecord,
    rankNumber: number | null,
    facets: RushNativeRowFacets = {}
): RushNativeRankRow {
    // 界面上的数值列 = 这一程 30 关的结算时间之和(battleMs,2026-08-28 口径)。
    // 不是完整一程(半途接管 / 没有有效战斗计时)就发官方哨兵 --:--.--,
    // 绝不能发 0:0 会渲染成 00:00.00,比任何真成绩都「快」。
    const elapsedMs = record.fullRun ? record.battleMs : null
    const evolutionLevels = facets.evolutionLevels ?? []
    // 头像来源:编队(facets.mains)优先,取不到退回实战快照。**整支队伍一起换**,
    // 不许一个槽位用编队、另一个用快照 —— 那会拼出一支从没存在过的队伍。
    const mains = facets.mains ?? record.characterIds
    const paths: (string | null)[] = []
    for (let slot = 0; slot < NATIVE_ROW_SLOTS; slot++) {
        paths.push(nativeThumbnailPath(mains[slot] ?? null, evolutionLevels[slot] ?? 0))
    }

    return {
        rank: rankNumber === null ? "排名外" : `${rankNumber}位`,
        visible: rankNumber !== null,
        level: `RANK${facets.userRank ?? userRankOf(record)}`,
        name: record.displayName ?? `存档${record.playerId}`,
        count: `BEST RECORD: ${record.roundsCleared}战`,
        time: elapsedMs === null ? "TIME: --:--.--" : `TIME: ${formatMmSsFf(elapsedMs)}`,
        a: paths[0] ?? null,
        b: paths[1] ?? null,
        c: paths[2] ?? null,
        // 存档已删 = 没有资料可看 = 这一行不可点。客户端见 0 就不跳转,
        // 免得进了 loading 再吃一个 404。
        id: record.playerExists ? toProfileTargetId(record.playerId) : 0
    }
}
