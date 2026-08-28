// Handles mail.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PartyCategory, PlayerPartyGroup, RushEventBattleType, UserRushEventPlayedParty } from "../../data/types";
import { deletePlayerRushEventPlayedPartiesUntilSync, deletePlayerRushEventPlayedPartyListSync, deletePlayerRushEventPlayedPartySync, getDefaultPlayerRushEventSync, getPlayerRushEventClearedFoldersSync, getPlayerRushEventNextEndlessBattleRoundSync, getPlayerRushEventPlayedPartiesSync, getPlayerRushEventSync, insertPlayerRushEventClearedFolderSync, insertPlayerRushEventPlayedPartySync, insertPlayerRushEventSync, serializePlayerRushEventPlayedParty, updatePlayerRushEventSync } from "../../data/domains/rushEvent"
import { getAccountPlayers } from "../../data/domains/account"
import { getDefaultPlayerPartyGroupsSync } from "../../data/domains/player"
import { getPlayerCharacterSync } from "../../data/domains/character"
import { getPlayerPartyGroupListSync, insertPlayerPartyGroupListSync } from "../../data/domains/party"
import { getSession } from "../../data/domains/session"
import { getQuestFromCategorySync, getRogueEventConfig } from "../../lib/assets";
import { spawn } from "child_process";
import path from "path";
import { BattleQuest, QuestCategory, RushEventFolder } from "../../lib/types";
import { generateDataHeaders, getServerTime } from "../../utils";
import { FinishBody, insertActiveQuest } from "./singleBattleQuest";
import { getPlayerRushEventEndlessBattleRankingSync, getRushRankingPlayedPartyListSync, getSerializedPlayerRushEventPlayedPartiesSync } from "../../lib/rush";
import {
    RUSH_RANKING_PAGE_SIZE,
    getRushRankingAggregatedTime,
    getRushRankingMyRowSync,
    getRushRankingPageSync,
    getRushRankingRecordAtRankSync,
    resolveRushRankingTargetSync
} from "../../lib/rush-leaderboard-ranking";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { noteRushRoundStart, noteRushRunAbandoned } from "../../lib/rush-leaderboard-service";
import { settleThenRolloverRushSeason } from "../../lib/rush-settlement-service";
import { clearRogueRerollInFlight, markRogueRerollInFlight } from "../../lib/rogue-reroll-inflight";
import rushEventRankingRewards from "../../../assets/rush_event_ranking_reward.json";

interface SummaryBody {
    event_id: number,
    viewer_id: number
}

interface PartyBody {
    viewer_id: number
}

interface SelectFolderBody {
    folder_id: number,
    event_id: number,
    viewer_id: number
}

interface BattleStartBody {
    is_auto_start_mode: boolean,
    party_id: number,
    play_id: string,
    quest_id: number,
    viewer_id: number
}

interface ResetBody {
    quest_type: number,
    event_id: number,
    viewer_id: number,
    reset_target_id?: number,
    is_reset_after_target_round?: boolean
}

interface RankingBody {
    viewer_id: number,
    event_id: number,
    page?: number,
    aggregated_time?: string
}

interface RankingPlayedPartyBody {
    viewer_id: number,
    rank_number: number,
    aggregated_time: string,
    event_id: number
}

enum ResetQuestType {
    EMPTY,
    FOLDER,
    ENDLESS
}

interface RushEventRankingRewardEntry {
    fromRank: number,
    toRank: number,
    kind: number,
    kindId: number,
    number: number
}

type RushEventRankingRewards = Record<string, Record<string, RushEventRankingRewardEntry[]>>

const rankingRewards = rushEventRankingRewards as RushEventRankingRewards

/**
 * 客户端 `ResultCode.EventOutOfPeriod`。排行榜请求打到一个没有塔的活动 id 时用它。
 *
 * 为什么不是 HTTP 400:客户端的 remote 层先读 `data_headers.result_code`,
 * 非 1 才走 `defaultErrorHandler` 的业务分支(5002 → OutOfPeriod → 退回活动首页)。
 * 回 400 JSON 的话它走的是 `HttpStatusError`,弹的是通用网络错误框。
 *
 * ⚠ 这条通路在客户端接回排行榜界面(P2)之前**无法真机验证** —— CN 这一版把
 * 消费方整段裁掉了,现在没有任何客户端代码会读到它。
 */
const RUSH_RANKING_RESULT_CODE_OUT_OF_PERIOD = 5002

function sendRushRankingOutOfPeriod(
    reply: FastifyReply,
    viewerId: number,
    eventId: number
) {
    console.log(`[RUSH] ranking: no leaderboard bound to eventId=${eventId}; replying OutOfPeriod`)
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        "data_headers": generateDataHeaders({
            viewer_id: viewerId,
            result_code: RUSH_RANKING_RESULT_CODE_OUT_OF_PERIOD
        }),
        "data": {}
    })
}

interface RushParty {
    ability_soul_ids: (number | null)[],
    character_ids: (number | null)[],
    equipment_ids: (number | null)[],
    options: {
        allow_other_players_to_heal_me: boolean
    },
    party_edited: boolean,
    party_id: number,
    party_name: string,
    unison_character_ids: (number | null)[]
}

interface RushPartyGroup {
    party_group_color_id: number,
    party_group_id: number,
    party_list: RushParty[]
}

export function serializeRushPartyGroups(
    playerPartyGroups: Record<string, PlayerPartyGroup>
): RushPartyGroup[] {
    const userPartyGroupList: RushPartyGroup[] = []

    for (const [idString, group] of Object.entries(playerPartyGroups)) {
        const groupId = Number(idString)
        const partyList: RushParty[] = []

        for (const [slotString, party] of Object.entries(group.list)) {
            const localSlot = Number(slotString)
            partyList.push({
                ability_soul_ids: party.abilitySoulIds,
                character_ids: party.characterIds,
                equipment_ids: party.equipmentIds,
                unison_character_ids: party.unisonCharacterIds,
                options: {
                    allow_other_players_to_heal_me: party.options.allowOtherPlayersToHealMe
                },
                party_edited: party.edited,
                party_id: (groupId - 1) * 10 + localSlot,
                party_name: party.name
            })
        }

        userPartyGroupList.push({
            party_group_color_id: group.colorId,
            party_group_id: groupId,
            party_list: partyList
        })
    }

    return userPartyGroupList
}

export const rushEventFolderMaxRounds: { [key in RushEventFolder]?: number } = {
    [RushEventFolder.INTERMEDIATE]: 2,
    [RushEventFolder.ADVANCED]: 2,
    [RushEventFolder.GODLY]: 2
}

let lastRogueRerollMs = 0

/**
 * mod: 「游戏内重置 → 自动重摇塔」的开关。
 *
 * 这个钩子会在**服务端所在的机器上** spawn `wf_rogue_reroll.py --apply`:
 * 重建整座塔、写进那台机器的 .cdn 并推版本号、清掉该服所有存档的爬塔进度。
 * 对作者本机是「一键重开」的便利,对拿这个仓库自建服的人则是一次预料之外的
 * 内容改写(而且他们多半没装 mod-tools/python,只会静默失败)。
 *
 * 所以 `assets/rogue_event.json` 里的 `reset_rerolls_tower` 保持 null 发布,
 * 想开的人用环境变量单独开——.env 不进版本库,不会波及别人的服。
 *
 *   WF_ROGUE_REROLL_ON_RESET=1                                  # 用默认(30 层)
 *   WF_ROGUE_REROLL_ON_RESET={"rounds":30,"difficulty":"hell","mix":true}
 *
 * 环境变量优先于 rogue_event.json;两者都没有就不触发。
 */
function rogueRerollOverride(): { rounds?: number, difficulty?: string, mix?: boolean } | null {
    const raw = (process.env.WF_ROGUE_REROLL_ON_RESET ?? "").trim()
    if (raw === "" || raw === "0" || raw.toLowerCase() === "false") return null
    if (!raw.startsWith("{")) return {}
    try {
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === "object" ? parsed : {}
    } catch {
        console.error("[RUSH] WF_ROGUE_REROLL_ON_RESET is not valid JSON; using defaults")
        return {}
    }
}

/**
 * 环境变量重摇钩子只对**这一个**连战事件生效。
 *
 * 为什么必须有这道闸(20260828 复核):`WF_ROGUE_REROLL_ON_RESET` 是一个不带事件号的
 * 全局开关,而 assets 里一共有 15 个 rush 事件(700001–700017 与 700099)。没有这道闸
 * 时,**任何**一个连战的「整段重置」都会命中钩子 —— 给那个事件的台账换期(清空它的榜),
 * 同时拉起一个默认 `--event 700099` 的重摇子进程,把深渊塔重建并清掉 700099 的爬塔进度。
 * 玩家重置的是别的活动,炸的是深渊塔。
 *
 * 默认值必须与 `mod-tools/wf_rogue_reroll.py` 的 `--event` 默认值同步。
 */
function rogueTowerEventId(): number {
    const raw = Number((process.env.WF_ROGUE_REROLL_EVENT ?? "").trim())
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 700099
}

/**
 * 拉起塔重摇子进程,**成功退出后**才回调换期。
 *
 * ── 为什么换期必须等子进程 ─────────────────────────────────────
 * 20260828 之前这里是「spawn 完立刻 return true」,调用方据此当场换期。子进程失败
 * (python 不在 PATH、`wf_rogue_build` 退出码非 0 —— 脚本自己会打印
 * `[ERR] … 中止(进度未动)`)时塔一点没变,服务端却已经换了期:**当期榜被清空、
 * 进行中的 run 被作废,而旧期再也结算不了**(结算只能结算台账里当前那一期)。
 * 按期过滤上线之前这种误换期几乎没有可见代价,现在代价是整张榜。
 * 钩子本来就是异步旁挂的,晚几十秒换期没有任何副作用 ⇒ 等 rc===0 再换。
 *
 * `detached + unref` 保留:服务端要能在子进程还在跑的时候正常关闭。这不影响
 * `exit` 事件 —— 只要父进程还活着就照常收得到。
 *
 * ⚠ **窗口里服务端重启会丢掉这次换期**(20260828 三轮复核):换期挂在 `exit`
 * 事件上,服务端若在重摇窗口(秒级~分钟级)里退出/重启,回调随进程一起没了 ——
 * 塔已经重建并发上链,榜却留在旧期,而指纹兜底看不见(轮数没变,fingerprint
 * 恒为 `1:30`),完全静默。⇒ spawn 之前落一条**持久**的「重摇在途」标记
 * (`src/lib/rogue-reroll-inflight.ts`),子进程退出时清掉;服务端下次启动时
 * 若发现残留就显著告警(**不自动补做换期**:那一刻无从判断塔到底换没换,
 * 而换期不可逆)。作者到后台点一次「结算并开启新一期」即可补上。
 *
 * @param eventId 要重摇的连战事件 ID(透传给子进程的 `--event`,也是换期的对象)。
 * @param cfg 重摇配置。
 * @param onRerolled 子进程 rc===0 时的回调(换期就挂在这里)。
 * @returns 是否真的拉起了(冷却期内会跳过)。
 */
function triggerRogueTowerReroll(
    eventId: number,
    cfg: { rounds?: number, difficulty?: string, mix?: boolean },
    onRerolled: () => void
): boolean {
    const now = Date.now()
    if (now - lastRogueRerollMs < 120_000) {
        console.log("[RUSH] tower reroll skipped (120s cooldown)")
        return false
    }
    lastRogueRerollMs = now
    const repoRoot = path.resolve(__dirname, "..", "..", "..")
    // `--keep-season` 是必须的:这条路上服务端自己会在子进程成功后换期
    // (见下面的 exit 监听),而 wf_rogue_reroll.py 现在默认也会换期
    // (它得覆盖 GUI/CLI 那条完全绕开 8001 的路)。两边都换 = 一次重摇跳两期,
    // 中间那一期永远是空榜。更要紧的是:服务端这一侧换期会**先结算**,
    // 子进程那一侧只会写 SQL —— 让服务端换才发得出上一期的奖励。
    const args = ["-X", "utf8", "mod-tools/wf_rogue_reroll.py",
        "--event", String(eventId),
        "--rounds", String(cfg.rounds ?? 30), "--apply", "--no-restart", "--keep-season"]
    if (cfg.difficulty) args.push("--difficulty", String(cfg.difficulty))
    if (cfg.mix) args.push("--mix")
    console.log("[RUSH] spawning tower reroll:", args.join(" "))
    // 先落标记再 spawn:顺序反了的话「刚 spawn 完就被杀」那一格窗口没人管。
    markRogueRerollInFlight(eventId, now)
    const child = spawn(process.env.WF_PYTHON ?? "python", args,
        { cwd: repoRoot, detached: true, stdio: "ignore" })
    child.on("error", error => {
        clearRogueRerollInFlight()
        console.error("[RUSH] tower reroll failed to spawn (season NOT rolled):", error)
    })
    child.on("exit", (code, signal) => {
        if (code === 0) {
            console.log(`[RUSH] tower reroll finished (event=${eventId}); rolling season`)
            try {
                onRerolled()
            } catch (error) {
                console.error("[RUSH] season rollover after reroll failed:", error)
            }
            // 换期被挡下时不留标记:那一档已经自己喊过了(而且**塔确实换了**,
            // 下次启动再喊一遍同样的话只会让人以为出了两件事)。
            clearRogueRerollInFlight()
            return
        }
        clearRogueRerollInFlight()
        console.error(`[RUSH] tower reroll exited code=${code} signal=${signal}`
            + " — tower unchanged, season NOT rolled")
    })
    child.unref()
    return true
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/summary", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SummaryBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        console.log(`[RUSH] summary: viewer=${viewerId} eventId=${eventId}`)
        if (isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // get rush event data
        let rushEventData = getPlayerRushEventSync(playerId, eventId)
        if (rushEventData === null) {
            rushEventData = getDefaultPlayerRushEventSync(eventId)
            insertPlayerRushEventSync(playerId, rushEventData)
        }

        // get cleared folder id list
        const clearedFolderIdList = getPlayerRushEventClearedFoldersSync(playerId, eventId)

        // get serialized parties
        const serializedPlayedParties = getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId)
        console.log(`[RUSH] summary: folderParties=${Object.keys(serializedPlayedParties.folderParties ?? {}).length} endlessParties=${Object.keys(serializedPlayedParties.endlessParties ?? {}).length}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "endless_battle_next_round": rushEventData.endlessBattleNextRound,
                "endless_battle_max_round": rushEventData.endlessBattleMaxRound,
                "active_rush_battle_folder_id": rushEventData.activeRushBattleFolderId,
                "endless_battle_played_max_round": rushEventData.endlessBattleMaxRound,
                "cleared_folder_id_list": clearedFolderIdList,
                "endless_battle_played_party_list": serializedPlayedParties.endlessParties,
                "rush_battle_played_party_list": serializedPlayedParties.folderParties,
                "endless_battle_my_ranking": getPlayerRushEventEndlessBattleRankingSync(playerId, eventId, {
                    rushEventData: rushEventData
                }),
                // 三个端点(summary / aggregated_time / ranking)必须发同一个值,
                // 否则活动首页和榜上的「N时更新」会互相打架。
                "aggregated_time": getRushRankingAggregatedTime(),
            }
        })
    })

    fastify.post("/select_folder", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SelectFolderBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        const folderId = body.folder_id
        console.log(`[RUSH] select_folder: viewer=${viewerId} eventId=${eventId} folderId=${folderId}`)
        if (isNaN(viewerId) || isNaN(eventId) || isNaN(folderId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // get existing rush event data 
        const rushEventData = getPlayerRushEventSync(playerId, eventId)
        if (rushEventData === null) return reply.status(400).send({
            "error": "Bad Request",
            "message": `No rush event data for rush event with id '${eventId}'`
        });

        // Error if a folder has already been selected
        if (rushEventData.activeRushBattleFolderId !== null) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Already selected a folder for this rush event."
        });

        // update folder
        updatePlayerRushEventSync(playerId, {
            eventId: eventId,
            activeRushBattleFolderId: folderId
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "folder_id": folderId,
                "event_id": eventId
            }
        })
    })

    /**
     * 深渊连战排行榜。契约逐字段对齐官方 `event/rush/ranking`
     * (从韩版已编译字节码恢复,见 mod-tools/docs/排行榜类移植-可行性与方案-20260827.md §5.1)。
     *
     * 顶层五个键**恰好**是 aggregated_time / current_page / page_max / my_data /
     * ranking_list —— 少一个或名字写错,客户端在 successHandler 里直接抛 ClientError,
     * 整个界面开不起来(ranking_list 缺 = 8704,current_page/page_max 缺 = 8700,
     * aggregated_time 缺 = 8702)。
     */
    fastify.post("/ranking", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RankingBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        // 客户端发的 page 是 **1 起**:rankingListPageChanged 里是
        // `currentPageIndex + 1` 之后才交给 Page(...),而 currentPageIndex 是 0 起。
        // Initial 请求只带 event_id、不带 page,按第 1 页处理。
        const page = Math.max(1, Math.trunc(Number(body.page ?? 1)) || 1)
        console.log(`[RUSH] ranking: viewer=${viewerId} eventId=${eventId} page=${page}`)
        if (isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // 一个 event_id = 一张榜(界面上没有任何 tab / 榜类型参数)。
        const target = resolveRushRankingTargetSync(eventId)
        if (target === null) return sendRushRankingOutOfPeriod(reply, viewerId, eventId)

        // 「::value::更新」那一格。向下取整到最近的聚合时刻,并当作本轮名次的快照键。
        const aggregatedTime = getRushRankingAggregatedTime()

        const rankings = getRushRankingPageSync(
            target.eventId, target.folderId, target.board,
            page, RUSH_RANKING_PAGE_SIZE, aggregatedTime
        )
        const myRow = getRushRankingMyRowSync(
            target.eventId, target.folderId, target.board, playerId, aggregatedTime
        )

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "aggregated_time": aggregatedTime,
                // 原样回抛。回 page + 1 会让这一页的行被存到下一页的页号上,
                // 当前页缓存永远命不中 => 每次翻页都重发请求且列表不刷新。
                "current_page": page,
                "page_max": rankings.pageMax,
                "my_data": myRow,
                "ranking_list": rankings.list
            }
        })
    })

    fastify.post("/ranking/played_party", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RankingPlayedPartyBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        const rankNumber = body.rank_number
        if (isNaN(viewerId) || isNaN(eventId) || isNaN(rankNumber)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // 名次反查必须走**同一张榜、同一个排序、同一个快照**,否则点开的是别人的队伍。
        const target = resolveRushRankingTargetSync(eventId)
        if (target === null) return sendRushRankingOutOfPeriod(reply, viewerId, eventId)

        const aggregatedTime = getRushRankingAggregatedTime()
        const record = getRushRankingRecordAtRankSync(
            target.eventId, target.folderId, target.board, rankNumber, aggregatedTime
        )

        // 键必须是能 parseInt 的字符串(轮次号),值 18 个字段全部可空。
        // 名次越界就发空 Map —— 客户端拿到零行,不会崩。
        const partyList = record === null
            ? {}
            : getRushRankingPlayedPartyListSync(record.playerId, target.eventId)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "rush_ranking_party": partyList
            }
        })
    })

    fastify.post("/aggregated_time", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SummaryBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        if (isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "aggregated_time": getRushRankingAggregatedTime()
            }
        })
    })

    fastify.post("/party", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PartyBody

        const viewerId = body.viewer_id
        if (isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // get parties
        let playerPartyGroups = getPlayerPartyGroupListSync(playerId, PartyCategory.EVENT)
        console.log(`[RUSH] party: EVENT groups=${Object.keys(playerPartyGroups).length}`)
        if (0 >= Object.keys(playerPartyGroups).length) {
            console.log(`[RUSH] party: creating default EVENT parties`)
            playerPartyGroups = getDefaultPlayerPartyGroupsSync(PartyCategory.EVENT)
            insertPlayerPartyGroupListSync(playerId, playerPartyGroups)
        }

        const userPartyGroupList = serializeRushPartyGroups(playerPartyGroups)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "user_party_group_list": userPartyGroupList
            }
        })
    })

    fastify.post("/battle/start", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BattleStartBody

        const viewerId = body.viewer_id
        const isAutoStartMode = body.is_auto_start_mode
        const partyId = body.party_id
        const questId = body.quest_id
        console.log(`[RUSH] battle/start: viewer=${viewerId} questId=${questId} partyId=${partyId} autoStart=${isAutoStartMode}`)
        if (isNaN(viewerId) || isNaN(partyId) || isNaN(questId) || isAutoStartMode === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        // get quest
        const questData = getQuestFromCategorySync(QuestCategory.RUSH_EVENT, questId) as BattleQuest | null
        if (questData === null || !('rankPointReward' in questData) || questData.rushEventId === undefined) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Quest doesn't exist."
        })

        // 排行榜:第 1 关开一条 run 并记下起跑时刻,后续关沿用(见 lib/rush-leaderboard)
        if (questData.rushEventFolderId !== undefined && questData.rushEventRound !== undefined) {
            noteRushRoundStart({
                playerId,
                eventId: questData.rushEventId,
                folderId: questData.rushEventFolderId,
                round: questData.rushEventRound
            })
        }

        // insert active quest for '/single_battle_quest/finish' endpoint
        insertActiveQuest(playerId, {
            questId: questId,
            category: QuestCategory.RUSH_EVENT,
            useBoostPoint: false,
            useBossBoostPoint: false,
            isAutoStartMode: isAutoStartMode,
            isMulti: false,
            playId: body.play_id,
            continueCount: 0
        })

        const headers = generateDataHeaders({
            viewer_id: viewerId
        })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": headers,
            "data": {
                "user_info": {
                    "last_main_quest_id": body.quest_id
                },
                "is_multi": "single",
                "start_time": headers['servertime'],
                "quest_name": ""
            }
        })
    })

    fastify.post("/reset", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ResetBody

        const viewerId = body.viewer_id
        const eventId = body.event_id
        const questType: ResetQuestType = body.quest_type
        const resetTargetId: number | undefined = body.reset_target_id
        const isResetAfterTargetRound: boolean | undefined = body.is_reset_after_target_round
        console.log(`[RUSH] reset: viewer=${viewerId} eventId=${eventId} questType=${questType} resetTargetId=${resetTargetId} isResetAfterTarget=${isResetAfterTargetRound}`)

        // mod: roguelike 塔重摇钩子——整段 folder 重置时按配置拉起重摇
        // (rogue_event.json reset_rerolls_tower;冷却 120s;完成后玩家重启游戏拉新塔)
        try {
            // 环境变量那一支只对深渊塔生效(见 rogueTowerEventId 的注释:它不带事件号,
            // 不加闸的话别的连战重置会把深渊塔炸掉);按事件配的那一支各管各的。
            const rerollCfg = (eventId === rogueTowerEventId() ? rogueRerollOverride() : null)
                ?? (getRogueEventConfig(eventId) as any)?.reset_rerolls_tower
            if (rerollCfg && questType === ResetQuestType.FOLDER && resetTargetId === undefined) {
                // 重摇 = 塔被重造 = 结算当期 + 换一期。
                // 换期挂在**子进程成功退出之后**(见 triggerRogueTowerReroll):
                // 重摇失败却换了期 = 白清一张榜,而旧期再也结算不了。
                triggerRogueTowerReroll(eventId, rerollCfg, () => {
                    const outcome = settleThenRolloverRushSeason(eventId, "reroll-hook")
                    if (outcome.blocked) {
                        // 结算真炸了 ⇒ 期号一格没动(刻意的,见该函数的说明)。
                        // 塔已经换了,榜还是旧塔的成绩 —— 必须喊出来,否则没人知道
                        // 该去后台点「结算并开启新一期」补上。
                        console.error(`[RUSH] ⛔ 塔已重摇但排行榜没换期(event=${eventId}):`
                            + ` ${outcome.reason ?? "未知原因"}。`
                            + " 榜上仍是上一座塔的成绩,请到后台排行榜页点「结算并开启新一期」。")
                    } else if (!outcome.rolled) {
                        // 这一期一条完整成绩都没有 ⇒ 原地复用它(期号不动)。
                        // 空期 +1 只会在台账里留下一段没人打过的空榜,而期号不可逆。
                        console.log(`[RUSH] 塔已重摇;第 ${outcome.season} 期还没人打过,`
                            + ` 期号保持不动,已重新对上新塔(${outcome.reason ?? "空期"})。`)
                    } else if (!outcome.settled) {
                        console.warn(`[RUSH] 塔已重摇,第 ${outcome.season} 期已开启,但这次没结算:`
                            + ` ${outcome.reason ?? "未知原因"}`)
                    }
                })
            }
        } catch (err) {
            console.error("[RUSH] reroll hook failed:", err)
        }
        if (isNaN(viewerId) || isNaN(eventId) || isNaN(questType)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        // get player
        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        })

        if (questType === ResetQuestType.FOLDER) {

            // mod(2026-08-25 作者定案):单层/到某层的部分重置禁用——战斗
            // 记录仅供查看;唯一的重置=整段放弃从第一关重打。返回 400 让
            // 客户端弹错并保持本地状态不变(返回 200 会让客户端本地演一次
            // 假重置,实测有误导)。
            if (resetTargetId !== undefined) {
                console.log(`[RUSH] partial folder reset blocked (view-only records): target=${resetTargetId}`)
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "Partial reset is disabled on this server."
                })
            } else {
                // reset entire folder
                // 排行榜:整段放弃 = 这一程作废,不进榜。
                //
                // ── 本服的裁定(作者 2026-08-28):**整段重置 = 换塔换期** ──────
                // 「真的重摇一座新塔 = 换期 = 当期榜清空,塔刷新榜也刷新。」
                // 本机 .env 的 `WF_ROGUE_REROLL_ON_RESET` 就是为此开着的(不要动它),
                // 所以在这台服务器上,游戏里按下整段重置的正常结果是:
                // 本文件上方那个钩子拉起 wf_rogue_reroll → 子进程成功退出 →
                // **结算当期(冻结名次 + 发奖邮件)+ 期号 +1**,当期榜清空。
                // 别把这段读成「整段重置永远不换期」—— 那是 08-27 的旧口径,已被推翻。
                //
                // 四条例外,都不是 bug:
                //   · **120 秒冷却期内的重置不换期**。钩子在冷却里直接 return false,
                //     子进程根本没起 ⇒ 塔一点没变 ⇒ 期号也不该动。
                //     所以连按两次重置,第二次是「同一座塔的又一次挑战」,
                //     成绩按 battle_ms 去重(打得更慢不会覆盖上一程的最优)。
                //   · **重摇子进程失败也不换期**(钩子只在 exit code 0 时回调),
                //     以及**结算真失败时换期被主动挡下**(见 settleThenRolloverRushSeason):
                //     宁可塔没换,也别把上一期的名次和奖励丢了 —— 后者不可恢复。
                //   · **这一期还没人打过时期号不动**:结算返回 empty-season ⇒ 原地复用
                //     那一期(刷新指纹 + 作废进行中的 run)。空期 +1 只会在台账里留下
                //     一段没人打过的空榜,而期号不可逆。榜照样是空的,语义没差别。
                //   · **服务端在重摇窗口里重启 ⇒ 这一次换期丢失**(见
                //     triggerRogueTowerReroll 的注释):换期挂在子进程的 exit 事件上,
                //     父进程没了就收不到。表现是「新塔挂着旧榜」且指纹兜底看不见
                //     (轮数没变)。所以 spawn 之前会落一条持久的「重摇在途」标记,
                //     下次启动时告警(src/lib/rogue-reroll-inflight.ts);
                //     到后台点一次「结算并开启新一期」即可补上。
                //
                // 把钩子关掉(`WF_ROGUE_REROLL_ON_RESET` 未设 且 rogue_event.json 的
                // `reset_rerolls_tower` 为 null)时才退化成「同一座塔、同一期」。
                // 那不是本机的配置,别照着它推断线上行为。
                noteRushRunAbandoned(playerId, eventId)
                // update the active folder value
                updatePlayerRushEventSync(playerId, {
                    eventId: eventId,
                    activeRushBattleFolderId: null
                })
                // delete played parties
                deletePlayerRushEventPlayedPartyListSync(playerId, eventId, RushEventBattleType.FOLDER)
            }

        } else if (resetTargetId !== undefined) {
            // endless battle resetting
            if (isResetAfterTargetRound) {
                // "reset up until here"
                deletePlayerRushEventPlayedPartiesUntilSync(playerId, eventId, RushEventBattleType.ENDLESS, resetTargetId)
            } else {
                // "reset only here"
                deletePlayerRushEventPlayedPartySync(playerId, eventId, resetTargetId, RushEventBattleType.ENDLESS)
            }
        }
        
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": []
        })
    })

    // ---- reward ----
    fastify.post("/reward", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { event_id: number, viewer_id: number, api_count: number };
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        console.log(`[RUSH] reward: viewer=${viewerId} eventId=${eventId}`)
        if (!viewerId || isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No player bound to account."
        })

        // get player's rank
        const myRanking = getPlayerRushEventEndlessBattleRankingSync(playerId, eventId)
        const rankNumber = myRanking?.rank_number ?? null

        // find matching reward tier
        const rewards = rankingRewards[String(eventId)] ?? {}
        let rewardList: RushEventRankingRewardEntry[] = []
        if (rankNumber !== null && rankNumber > 0) {
            for (const entries of Object.values(rewards)) {
                for (const entry of entries) {
                    if (rankNumber >= entry.fromRank && rankNumber <= entry.toRank) {
                        rewardList.push(entry)
                        break
                    }
                }
            }
        }

        console.log(`[RUSH] reward: rank=${rankNumber} rewards=${rewardList.length}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "rank_number": rankNumber,
                "ranking_reward": {
                    "reward_list": rewardList.map(r => ({
                        "kind": r.kind,
                        "kind_id": r.kindId,
                        "number": r.number
                    })),
                    "status": 0
                }
            }
        });
    })

    // ---- endless_battle ----
    fastify.post("/endless_battle", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { event_id: number, viewer_id: number, api_count: number };
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        console.log(`[RUSH] endless_battle: viewer=${viewerId} eventId=${eventId}`)
        if (!viewerId || isNaN(viewerId) || isNaN(eventId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        });

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No player bound to account."
        })

        const rushEventData = getPlayerRushEventSync(playerId, eventId)
        const serializedPlayedParties = rushEventData !== null
            ? getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId)
            : { endlessParties: null, folderParties: null }
        const maxRound = rushEventData?.endlessBattleMaxRound ?? null
        const nextRound = rushEventData?.endlessBattleNextRound ?? 1

        console.log(`[RUSH] endless_battle: maxRound=${maxRound} nextRound=${nextRound}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "endless_battle_max_round": maxRound,
                "endless_battle_next_round": nextRound,
                "endless_battle_played_party_list": serializedPlayedParties.endlessParties ?? null
            }
        });
    })
}

export default routes;
