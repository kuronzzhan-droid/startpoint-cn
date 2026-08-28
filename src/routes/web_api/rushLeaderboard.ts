/**
 * 深渊连战排行榜的后台 JSON 端点(挂在 /api/rush-leaderboard)。
 *
 * 口径与轮次裁定见 src/lib/rush-leaderboard.ts 顶部的说明,
 * 验收步骤见 work/agent-coordination/rush-leaderboard-20260827.md。
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
    getRushFullRunLeaderboardSync,
    getRushLeaderboardEventKeysSync,
    getRushLeaderboardStatsSync,
    getRushRunsSync,
    getRushSeasonFirstClearLeaderboardSync,
    type RushRunRecord
} from "../../data/domains/rushLeaderboard";
import {
    peekRushSeasonSync,
    getRushFolderTotalRoundsSync,
    getRushTowerFolderIdSync
} from "../../lib/rush-leaderboard-service";
import { getRushEventFolderMaxRounds, getRushEventIds } from "../../lib/assets";
import { buildRushLeaderboardNewsItems } from "../../lib/rush-leaderboard-news";
import {
    getRushSettlementConfigSync,
    getSeasonResultsSync,
    getSettlementHistorySync,
    putRushSettlementConfigSync
} from "../../data/domains/rushSettlement";
import { settleRushSeasonNow, settleThenRolloverRushSeason } from "../../lib/rush-settlement-service";
import { normalizeRewardTiers, validateRewardTiers } from "../../lib/rush-settlement";
import { buildRushRewardPreview } from "../../lib/rush-reward-preview";

interface EventParams {
    eventId: string
}

interface BoardQuery {
    folderId?: string
    limit?: string
    playerId?: string
}

/** 下发给前端的一行成绩。字段名保持和 UI 列一一对应,前端不用再算。 */
interface BoardRow {
    runId: number
    playerId: number
    playerName: string | null
    playerExists: boolean
    season: number
    status: string
    startedAt: string | null
    finishedAt: string | null
    durationMs: number | null
    battleMs: number
    roundsCleared: number
    totalRounds: number
    trackedFromRound: number
    fullRun: boolean
    characterIds: (number | null)[]
    unisonCharacterIds: (number | null)[]
}

function toIso(ms: number | null): string | null {
    return ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString()
}

function toRow(record: RushRunRecord): BoardRow {
    return {
        runId: record.id,
        playerId: record.playerId,
        playerName: record.displayName,
        playerExists: record.playerExists,
        season: record.season,
        status: record.status,
        startedAt: toIso(record.startedAtMs),
        finishedAt: toIso(record.finishedAtMs),
        durationMs: record.durationMs,
        battleMs: record.battleMs,
        roundsCleared: record.roundsCleared,
        totalRounds: record.totalRounds,
        trackedFromRound: record.trackedFromRound,
        fullRun: record.fullRun,
        characterIds: record.characterIds,
        unisonCharacterIds: record.unisonCharacterIds
    }
}

function parsePositiveInt(raw: string | undefined, fallback: number, max: number): number {
    if (raw === undefined) return fallback
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return fallback
    return Math.min(Math.floor(value), max)
}

/**
 * 解析路径里的 eventId 和查询串里的 folderId。
 *
 * @returns 解析结果;eventId 非法时 error 非空。
 */
function resolveTarget(
    params: EventParams,
    query: BoardQuery
): { eventId: number, folderId: number, totalRounds: number } | { error: string } {
    const eventId = Number(params.eventId)
    if (!Number.isFinite(eventId) || eventId <= 0) return { error: "Invalid event id." }

    const folderId = query.folderId === undefined
        ? getRushTowerFolderIdSync(eventId)
        : Number(query.folderId)
    if (folderId === null || !Number.isFinite(folderId)) {
        return { error: `Rush event ${eventId} has no multi-round folder.` }
    }

    return { eventId, folderId, totalRounds: getRushFolderTotalRoundsSync(eventId, folderId) }
}

const routes = async (fastify: FastifyInstance) => {

    // 可上榜的连战列表 = 够长的爬塔 + 任何已经留下过成绩的 folder。
    //
    // 服务端对所有 folder 一视同仁地记录,这里只是收窄「下拉框里默认列什么」:
    // 官方连战的 中级/上级/神级 folder 只有 2~3 关,给它们排「战斗用时榜」
    // 没有意义,却会把深渊连战(700099 folder 1,30 关)淹在四十来个条目里。
    // 阈值以下的 folder 一旦真的产生过成绩,下面那个循环会把它补回列表。
    fastify.get("/events", async (_request: FastifyRequest, reply: FastifyReply) => {
        const TOWER_MIN_ROUNDS = 5
        const keys = new Map<string, { eventId: number, folderId: number }>()

        for (const eventId of getRushEventIds()) {
            for (const [folder, rounds] of Object.entries(getRushEventFolderMaxRounds(eventId))) {
                if (rounds < TOWER_MIN_ROUNDS) continue
                keys.set(`${eventId}:${folder}`, { eventId, folderId: Number(folder) })
            }
        }
        for (const key of getRushLeaderboardEventKeysSync()) {
            keys.set(`${key.eventId}:${key.folderId}`, key)
        }

        const events = [...keys.values()]
            .sort((left, right) => left.eventId - right.eventId || left.folderId - right.folderId)
            .map(key => {
                const season = peekRushSeasonSync(key.eventId)
                return {
                    eventId: key.eventId,
                    folderId: key.folderId,
                    totalRounds: getRushFolderTotalRoundsSync(key.eventId, key.folderId),
                    season: season?.season ?? null,
                    seasonStartedAt: toIso(season?.startedAtMs ?? null),
                    seasonSource: season?.source ?? null,
                    // 统计卡必须同时给出「当期」和「累计」:榜已经按期收窄,
                    // 只发累计数的话换期后这一页会一边写「26 条成绩」一边给出空榜。
                    stats: getRushLeaderboardStatsSync(
                        key.eventId, key.folderId, season?.season ?? null)
                }
            })

        return reply.send(events)
    })

    // 游戏内排行榜公告的正文预览。
    //
    // 客户端拿到的就是这里的 `html` 字段(`POST /api/index.php/news/get_info`),
    // 所以真机之前可以先在后台/命令行看一眼排版对不对。
    // `?playerId=` 模拟「谁在看」,用来验「自身名次置顶 + 橙色高亮」。
    fastify.get("/news-preview", async (request: FastifyRequest, reply: FastifyReply) => {
        const raw = (request.query as { playerId?: string }).playerId
        const playerId = raw === undefined ? null : Number(raw)
        return reply.send(buildRushLeaderboardNewsItems(
            playerId !== null && Number.isFinite(playerId) && playerId > 0 ? playerId : null))
    })

    // 战斗用时榜(**只列当期** —— 与游戏内那张榜逐行同源)
    //
    // 重摇塔 = 换期 = 新的一张空榜(作者裁定 2026-08-28 晚)。后台这一页必须跟着
    // 收窄,否则「后台看得见、游戏里看不见」会被当成 bug 反复排查。
    // 想看跨期的全部历史成绩走 `/:eventId/runs`;想看某一期结算那一刻冻结的名次
    // 走 `/:eventId/settlement/:season/results`。
    fastify.get("/:eventId/full-run", async (request: FastifyRequest, reply: FastifyReply) => {
        const target = resolveTarget(request.params as EventParams, request.query as BoardQuery)
        if ("error" in target) return reply.status(400).send({ error: target.error })

        const limit = parsePositiveInt((request.query as BoardQuery).limit, 100, 500)
        const season = peekRushSeasonSync(target.eventId)
        return reply.send({
            eventId: target.eventId,
            folderId: target.folderId,
            totalRounds: target.totalRounds,
            season: season?.season ?? null,
            rows: getRushFullRunLeaderboardSync(
                target.eventId, target.folderId, limit, season?.season ?? null).map(toRow)
        })
    })

    // 当轮首通榜(每期每存档的第一次通关)
    fastify.get("/:eventId/season-first", async (request: FastifyRequest, reply: FastifyReply) => {
        const target = resolveTarget(request.params as EventParams, request.query as BoardQuery)
        if ("error" in target) return reply.status(400).send({ error: target.error })

        const limit = parsePositiveInt((request.query as BoardQuery).limit, 100, 500)
        const season = peekRushSeasonSync(target.eventId)
        return reply.send({
            eventId: target.eventId,
            folderId: target.folderId,
            totalRounds: target.totalRounds,
            season: season?.season ?? null,
            rows: getRushSeasonFirstClearLeaderboardSync(target.eventId, target.folderId, limit).map(toRow)
        })
    })

    // 原始 run 明细(含进行中/已作废),排查用
    fastify.get("/:eventId/runs", async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as BoardQuery
        const target = resolveTarget(request.params as EventParams, query)
        if ("error" in target) return reply.status(400).send({ error: target.error })

        const rawPlayerId = query.playerId === undefined ? undefined : Number(query.playerId)
        if (rawPlayerId !== undefined && (!Number.isFinite(rawPlayerId) || rawPlayerId <= 0)) {
            return reply.status(400).send({ error: "Invalid player id." })
        }

        return reply.send({
            eventId: target.eventId,
            folderId: target.folderId,
            totalRounds: target.totalRounds,
            rows: getRushRunsSync(target.eventId, target.folderId, {
                playerId: rawPlayerId,
                limit: parsePositiveInt(query.limit, 200, 1000)
            }).map(toRow)
        })
    })

    /**
     * 「报酬一览」预览 —— 游戏内那一页显示的就是这份数据。
     *
     * 数据源是结算配置本身(不是另写一份展示表),所以这个端点回答的是
     * **「现在这一刻按下结算,到底会发出什么」**。
     * `degreeImage` 是铭牌的资产逻辑路径(带 `.png`),客户端富文本
     * `<img src="file://…">` 直接吃;`itemIcon` 默认 null,理由见
     * `src/lib/rush-reward-preview.ts` 文件头的 store 寻址实测。
     */
    fastify.get("/:eventId/rewards", async (request: FastifyRequest, reply: FastifyReply) => {
        const target = resolveTarget(request.params as EventParams, request.query as BoardQuery)
        if ("error" in target) return reply.status(400).send({ error: target.error })

        const preview = buildRushRewardPreview(target.eventId, target.folderId)
        return reply.send({
            eventId: target.eventId,
            folderId: target.folderId,
            ...preview
        })
    })

    // ---- 赛季结算 ----

    // 结算配置 + 排期 + 历史台账概览
    fastify.get("/:eventId/settlement", async (request: FastifyRequest, reply: FastifyReply) => {
        const target = resolveTarget(request.params as EventParams, request.query as BoardQuery)
        if ("error" in target) return reply.status(400).send({ error: target.error })

        const config = getRushSettlementConfigSync(target.eventId, target.folderId, Date.now())
        const season = peekRushSeasonSync(target.eventId)
        return reply.send({
            eventId: target.eventId,
            folderId: target.folderId,
            currentSeason: season?.season ?? null,
            // 时刻一律以 epoch 毫秒下发,前端按作者本地时区渲染
            nowMs: Date.now(),
            config: {
                autoEnabled: config.autoEnabled,
                settleAtMs: config.settleAtMs,
                repeatIntervalMs: config.repeatIntervalMs,
                rewardBoard: config.rewardBoard,
                // 只截断 toRank !== null 的有限档;null 尾档继续覆盖完整通关玩家。
                rewardRankLimit: config.rewardRankLimit,
                rewardTiers: config.rewardTiers,
                mailSubject: config.mailSubject,
                mailBody: config.mailBody,
                updatedAtMs: config.updatedAtMs,
                excludeBots: config.excludeBots
            },
            rewardsConfigured: config.rewardTiers.some(tier =>
                (tier.itemId !== null && tier.count > 0)
                || (tier.degreeId !== null && tier.degreeId !== undefined && tier.degreeId > 0)),
            history: getSettlementHistorySync(target.eventId, target.folderId, 50)
        })
    })

    // 改结算配置(结算时刻 / 周期 / 奖励档位 / 邮件文案)
    fastify.put("/:eventId/settlement", async (request: FastifyRequest, reply: FastifyReply) => {
        const target = resolveTarget(request.params as EventParams, request.query as BoardQuery)
        if ("error" in target) return reply.status(400).send({ error: target.error })

        const body = (request.body ?? {}) as Record<string, unknown>
        const current = getRushSettlementConfigSync(target.eventId, target.folderId, Date.now())

        if (body.rewardTiers !== undefined) {
            const errors = validateRewardTiers(body.rewardTiers)
            if (errors.length > 0) return reply.status(400).send({ error: errors.join("; ") })
        }

        const settleAtMs = body.settleAtMs === undefined
            ? current.settleAtMs
            : (body.settleAtMs === null ? null : Number(body.settleAtMs))
        if (settleAtMs !== null && !Number.isFinite(settleAtMs)) {
            return reply.status(400).send({ error: "settleAtMs 必须是 epoch 毫秒或 null" })
        }

        const repeatIntervalMs = body.repeatIntervalMs === undefined
            ? current.repeatIntervalMs
            : (body.repeatIntervalMs === null ? null : Number(body.repeatIntervalMs))
        if (repeatIntervalMs !== null && (!Number.isFinite(repeatIntervalMs) || repeatIntervalMs <= 0)) {
            return reply.status(400).send({ error: "repeatIntervalMs 必须是正毫秒数或 null" })
        }

        // 这条上限只约束有限档。toRank=null 是显式「到榜尾」,不受它截断。
        const rankLimit = body.rewardRankLimit === undefined
            ? current.rewardRankLimit
            : Number(body.rewardRankLimit)
        if (!Number.isInteger(rankLimit) || rankLimit < 1 || rankLimit > 500) {
            return reply.status(400).send({ error: "rewardRankLimit 必须是 1~500 的整数" })
        }

        putRushSettlementConfigSync({
            ...current,
            autoEnabled: body.autoEnabled === undefined ? current.autoEnabled : Boolean(body.autoEnabled),
            settleAtMs,
            repeatIntervalMs,
            rewardBoard: body.rewardBoard === "season-first" ? "season-first"
                : body.rewardBoard === "full-run" ? "full-run" : current.rewardBoard,
            rewardRankLimit: rankLimit,
            rewardTiers: body.rewardTiers === undefined
                ? current.rewardTiers
                : normalizeRewardTiers(body.rewardTiers),
            mailSubject: typeof body.mailSubject === "string" && body.mailSubject.trim() !== ""
                ? body.mailSubject : current.mailSubject,
            mailBody: typeof body.mailBody === "string" && body.mailBody.trim() !== ""
                ? body.mailBody : current.mailBody,
            // 机器人发不发奖。undefined = 没带这个字段(局部保存),保持原值;
            // 别写成 `Boolean(body.excludeBots)` —— 那会把「只改档位」的 PUT
            // 悄悄把开关关掉。
            excludeBots: body.excludeBots === undefined
                ? current.excludeBots : Boolean(body.excludeBots),
            updatedAtMs: Date.now()
        })

        return reply.send({ ok: true })
    })

    // 立即结算
    fastify.post("/:eventId/settlement/run", async (request: FastifyRequest, reply: FastifyReply) => {
        const target = resolveTarget(request.params as EventParams, request.query as BoardQuery)
        if ("error" in target) return reply.status(400).send({ error: target.error })

        const outcome = settleRushSeasonNow(target.eventId, target.folderId, "admin-manual")
        if (!outcome.ok) return reply.status(400).send({ error: outcome.reason ?? "结算失败" })
        return reply.send(outcome)
    })

    // 某一期冻结下来的名次快照
    fastify.get("/:eventId/settlement/:season/results", async (request: FastifyRequest, reply: FastifyReply) => {
        const params = request.params as EventParams & { season: string }
        const target = resolveTarget(params, request.query as BoardQuery)
        if ("error" in target) return reply.status(400).send({ error: target.error })

        const season = Number(params.season)
        if (!Number.isInteger(season) || season < 1) {
            return reply.status(400).send({ error: "Invalid season." })
        }

        return reply.send({
            eventId: target.eventId,
            folderId: target.folderId,
            season,
            rows: getSeasonResultsSync(target.eventId, target.folderId, season)
        })
    })

    // 结算当期并开启新一期。
    //
    // **这是服务端唯一的换期入口** —— 后台那颗按钮、CLI `wf_rogue_reroll.py`、
    // GUI 的两条「重建整座塔并发布」都打到这里(游戏内整段重置的重摇钩子在进程内
    // 直接调同一个函数)。作者原话「每次重 roll 塔,排行榜结算,新塔是新榜」。
    //
    // 不提供「只换期」的选项:只换期的话上一期的名次冻结和奖励邮件永远补不回来
    // (settleRushSeasonNow 只能结算台账里当前那一期)。真要跳过发奖,
    // 先在结算配置里把奖励档位清空。
    //
    // 良性跳过(这一期已经结算过)仍然照换期;「这一期一条完整成绩都没有」则
    // **原地复用这一期**(期号不动,响应里 `rolled=false`)—— 空期 +1 只会在台账里
    // 留下一段没人打过的空榜,而期号不可逆。两种情况都用 `settled=false` +
    // `settleReason` 说明原因;
    // **真失败会把换期一起挡下**,这时返回 409 而不是 500 —— 它不是服务端内部错误,
    // 而是「按裁定拒绝执行这次换期」,期号一格没动,修好原因后重试即可。
    //
    // 调用方(CLI/GUI)据此判断:2xx = 期已经推进;409 = 塔换了但榜没换,要喊人。
    fastify.post("/:eventId/season/rollover", async (request: FastifyRequest, reply: FastifyReply) => {
        const eventId = Number((request.params as EventParams).eventId)
        if (!Number.isFinite(eventId) || eventId <= 0) {
            return reply.status(400).send({ error: "Invalid event id." })
        }

        // 来源走**查询串**而不是请求体:后台那颗按钮的 apiPost 发的是
        // `Content-Type: application/json` 但空 body,碰 request.body 有踩
        // FST_ERR_CTP_EMPTY_JSON_BODY 的风险,而这个端点必须对它保持零改动。
        const rawSource = (request.query as { source?: string }).source
        const source = typeof rawSource === "string" && /^[a-z0-9:_-]{1,40}$/i.test(rawSource)
            ? rawSource
            : "admin-manual"

        const outcome = settleThenRolloverRushSeason(eventId, source)
        if (outcome.blocked || outcome.season === null) {
            return reply.status(409).send({
                error: `结算失败,已按裁定拒绝换期(期号未动):${outcome.reason ?? "未知原因"}`,
                blocked: true,
                code: outcome.code,
                settleReason: outcome.reason ?? null
            })
        }

        const rolled = peekRushSeasonSync(eventId)
        return reply.send({
            eventId,
            season: outcome.season,
            // 期号**真的推进了吗**。false = 这一期一条完整成绩都没有,原地复用了它
            // (不白烧一个不可逆的期号)。调用方(后台按钮 / CLI / GUI)据此措辞,
            // 别把「复用」报成「已开启第 N 期」。
            rolled: outcome.rolled,
            startedAt: toIso(rolled?.startedAtMs ?? null),
            source: rolled?.source ?? source,
            settled: outcome.settled,
            blocked: false,
            code: outcome.code,
            settleReason: outcome.settled ? null : outcome.reason ?? null,
            settlement: outcome.settlement ?? null
        })
    })
}

export default routes;
