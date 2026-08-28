/**
 * 深渊连战排行榜 —— **「报酬一览」预览数据**。
 *
 * 一份数据、三个消费者:
 *  ① 游戏内「报酬一览」圆钮落到的富文本页(`rush-leaderboard-agreement.ts`,
 *     带铭牌图的 `<img>`);
 *  ② `/tool/agreement` 载荷里的 `reward` 数组(原生客户端将来要用,今天先下发);
 *  ③ 后台 `GET /api/rush-leaderboard/:eventId/rewards`(作者核对「实际会发什么」)。
 *
 * 数据源**只有一处**:结算配置 `rush_settlement_configs.rewardTiers`
 * (`src/lib/rush-settlement.ts`)。也就是说这一页显示的就是结算真的会发的东西 ——
 * 不允许在这里另写一份「展示用」的档位表,那样迟早和发奖分叉。
 *
 * ── 图能不能显示:store 寻址实测(2026-08-28)────────────────────────
 * 富文本 `<img src="file://X">` 的解析链是
 *   `RichTextImageLoader.resolveSource`(`弹国服/scripts/pinball/ui/richText/
 *    RichTextImageLoader.as:59-70`)→ 去掉 `file://` 前缀,再 `split(".")[0]`
 *    **砍掉扩展名** → `ViewAssetCache.setTexture` → `AssetMap.loadAsset`
 *    → `FileReader.readTextureFile`(`.../asset/file/FileReader.as:486-499`)
 *    **补回 `.png`**(只有 `character/<code>/ui/skill_cutin_*` 走 `.atf`,
 *    见 `isPlatformDependent`:124)。
 * 也就是说 `<img src="file://a/b/c.png">` 最终读的 store 键是 `a/b/c.png`。
 *
 * 拿 `sha1(逻辑路径 + SALT)` 对 `.cdn/cn` 下 archive-* 的全部 zip(141 561 条)做存在性
 * 实测,结论:
 *  · `dynamic/degree/degree_mod_broken_wheel_hero.png` —— **在**。自制称号铭牌
 *    是独立 png,可以直接 `<img>`。
 *  · `item/sprite_sheet.png` —— 在;但**单枚道具图标不是独立文件**,
 *    `item/spends/tickets/ashen_verdict_once_gacha_character_ticket.png` **不在**。
 *    道具图标是共享图集里的子纹理,只有该图集已经加载时
 *    `ViewAssetCache.setTexture` 才会走 `subtextures` 短路;没加载就落到
 *    `readTextureFile` → 文件不存在 → `SectionCommand.FileNotFound`
 *    ⇒ 玩家被弹「数据不足」拉去重下资源(不是空图降级)。
 *
 * ⇒ **取舍**:铭牌图默认发,道具图标默认**不发**(只发名字 + 数量)。
 *   想赌一把图集已加载的,设 `WF_RUSH_RANK_REWARD_ITEM_ICON=<图集子纹理逻辑路径>`
 *   打开;真弹了「数据不足」把这条环境变量删掉重启即可,不用回滚 APK。
 */

import { readFileSync } from "fs";
import path from "path";
import { getRushSettlementConfigSync } from "../data/domains/rushSettlement";
import type { RushRewardBoard, RushRewardTier } from "./rush-settlement";

/** 已冻结的自制称号铭牌默认登记表；环境变量仍可逐项覆盖。 */
const DEFAULT_DEGREE_PLATES: Record<string, { name: string, image: string }> = {
    "9900001": {
        name: "断轮的原勇者",
        // 逻辑路径带 .png —— DegreeView 也是这么拼的
        // (`wf_client_legality.py:222-230` 记的 c8 列语义),
        // 且已用 sha1+SALT 在 .cdn 里实测存在。
        image: "dynamic/degree/degree_mod_broken_wheel_hero.png"
    },
    "9900002": {
        name: "深渊冠军",
        image: "dynamic/degree/degree_mod_abyss_rush_champion.png"
    },
    "9900003": {
        name: "深渊亚季军",
        image: "dynamic/degree/degree_mod_abyss_rush_runner_up.png"
    },
    "9900004": {
        name: "深渊上位者",
        image: "dynamic/degree/degree_mod_abyss_rush_upper_rank.png"
    },
    "9900005": {
        name: "深渊参与者",
        image: "dynamic/degree/degree_mod_abyss_rush_participant.png"
    },
    "9900006": {
        name: "资深玩家",
        image: "dynamic/degree/degree_mod_veteran_player.png"
    }
}

/**
 * 允许用环境变量登记更多称号,免得每加一枚铭牌就改代码:
 *
 *   WF_RUSH_RANK_DEGREES={"9900002":{"name":"某某","image":"dynamic/degree/xxx.png"}}
 *
 * @returns 称号 ID → 名字 + 铭牌逻辑路径。
 */
function degreePlates(): Record<string, { name: string, image: string }> {
    const raw = (process.env.WF_RUSH_RANK_DEGREES ?? "").trim()
    if (raw === "") return DEFAULT_DEGREE_PLATES
    try {
        const parsed = JSON.parse(raw) as Record<string, { name?: unknown, image?: unknown }>
        const merged: Record<string, { name: string, image: string }> = { ...DEFAULT_DEGREE_PLATES }
        for (const [id, entry] of Object.entries(parsed)) {
            if (entry === null || typeof entry !== "object") continue
            const name = typeof entry.name === "string" ? entry.name : `称号 #${id}`
            const image = typeof entry.image === "string" ? entry.image : ""
            merged[id] = { name, image }
        }
        return merged
    } catch (error) {
        console.error("[RUSH-LB] WF_RUSH_RANK_DEGREES parse failed:", error)
        return DEFAULT_DEGREE_PLATES
    }
}

let itemNames: Record<string, string> | null = null

/**
 * 道具名(与公告版同一张 `assets/item_lookup.json`)。
 *
 * 灰白深渊的两张新券(999015 / 999016)不在那张官方表里,所以这里补了一层
 * **默认覆盖**;`WF_RUSH_RANK_ITEM_NAMES` 可以再覆盖一次。
 * 刻意不去改 `assets/item_lookup.json` —— 那是官方表落盘,属于别的通道的资产。
 */
const DEFAULT_ITEM_NAMES: Record<string, string> = {
    "999015": "终焉裁定券",
    "999016": "终焉裁定券(十连)"
}

function itemNameOf(itemId: number): string {
    if (itemNames === null) {
        let base: Record<string, string> = {}
        try {
            const raw = readFileSync(
                path.join(__dirname, "..", "..", "assets", "item_lookup.json"), "utf-8")
            base = JSON.parse(raw) as Record<string, string>
        } catch {
            base = {}
        }
        let overrides: Record<string, string> = {}
        const rawOverrides = (process.env.WF_RUSH_RANK_ITEM_NAMES ?? "").trim()
        if (rawOverrides !== "") {
            try {
                overrides = JSON.parse(rawOverrides) as Record<string, string>
            } catch (error) {
                console.error("[RUSH-LB] WF_RUSH_RANK_ITEM_NAMES parse failed:", error)
            }
        }
        itemNames = { ...base, ...DEFAULT_ITEM_NAMES, ...overrides }
    }
    return itemNames[String(itemId)] ?? `道具 #${itemId}`
}

/** 测试用:丢掉道具名缓存。 */
export function clearRushRewardNameCache(): void {
    itemNames = null
}

/** 道具图标的逻辑路径;默认关(见文件头「取舍」)。 */
function itemIconPath(): string | null {
    const raw = (process.env.WF_RUSH_RANK_REWARD_ITEM_ICON ?? "").trim()
    return raw === "" ? null : raw
}

/** 一档报酬的预览行。 */
export interface RushRewardPreviewTier {
    fromRank: number
    toRank: number | null
    /** 「第 1 名」/「第 2 ~ 3 名」/「第 16 名起（到榜尾）」。 */
    rankLabel: string
    itemId: number | null
    itemName: string | null
    itemCount: number
    /** 道具图标逻辑路径;默认 null(见文件头)。 */
    itemIcon: string | null
    degreeId: number | null
    degreeName: string | null
    /** 铭牌图逻辑路径(带 `.png`),客户端 `<img src="file://…">` 直接吃。 */
    degreeImage: string | null
    /** 这一档什么都发不出来(itemId 与 degreeId 都没配)。 */
    unconfigured: boolean
}

export interface RushRewardPreview {
    /** 按哪张榜发奖。 */
    board: RushRewardBoard
    /** 有限档发到第几名为止;null 尾档不受它限制。 */
    rankLimit: number
    tiers: RushRewardPreviewTier[]
}

/**
 * 名次区间的中文标签。
 *
 * @param from 起始名次。
 * @param to 结束名次。
 */
export function rankRangeLabel(from: number, to: number | null): string {
    if (to === null) return `第 ${from} 名起（到榜尾）`
    return from === to ? `第 ${from} 名` : `第 ${from} ~ ${to} 名`
}

/**
 * 把结算档位投影成预览行(纯函数,单测只测这一层)。
 *
 * @param tiers 结算配置里的档位表。
 * @returns 预览行。
 */
export function toRewardPreviewTiers(tiers: RushRewardTier[]): RushRewardPreviewTier[] {
    const plates = degreePlates()
    const icon = itemIconPath()

    return tiers.map(tier => {
        const itemId = tier.itemId ?? null
        const degreeId = tier.degreeId ?? null
        const plate = degreeId === null ? undefined : plates[String(degreeId)]
        const hasItem = itemId !== null && tier.count > 0
        const hasDegree = degreeId !== null && degreeId > 0

        return {
            fromRank: tier.fromRank,
            toRank: tier.toRank,
            rankLabel: rankRangeLabel(tier.fromRank, tier.toRank),
            itemId: hasItem ? itemId : null,
            itemName: hasItem ? itemNameOf(itemId as number) : null,
            itemCount: hasItem ? tier.count : 0,
            itemIcon: hasItem ? icon : null,
            degreeId: hasDegree ? degreeId : null,
            degreeName: hasDegree ? (plate?.name ?? `称号 #${degreeId}`) : null,
            degreeImage: hasDegree ? (plate?.image ?? null) : null,
            unconfigured: !hasItem && !hasDegree
        }
    })
}

/**
 * 取某个事件/folder 的报酬预览(接数据库那一半)。
 *
 * @param eventId 事件 ID。
 * @param folderId folder ID。
 * @param board 只想要某张榜的预览时传;不传就不过滤。
 * @returns 预览;取不到配置时返回空档位表(不抛)。
 */
export function buildRushRewardPreview(
    eventId: number,
    folderId: number,
    board?: RushRewardBoard
): RushRewardPreview {
    try {
        const config = getRushSettlementConfigSync(eventId, folderId, Date.now())
        // 报酬只挂在真正发奖的那张榜上,免得两张榜都说自己发奖。
        if (board !== undefined && config.rewardBoard !== board) {
            return { board: config.rewardBoard, rankLimit: 0, tiers: [] }
        }
        return {
            board: config.rewardBoard,
            rankLimit: config.rewardRankLimit,
            tiers: toRewardPreviewTiers(config.rewardTiers)
        }
    } catch (error) {
        console.error("[RUSH-LB] reward preview failed:", error)
        return { board: "full-run", rankLimit: 0, tiers: [] }
    }
}
