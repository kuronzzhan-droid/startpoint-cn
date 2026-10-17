import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { getLeaderboardRankPageSync } from "../../data/domains/leaderboard"
import {
    getLeaderboardCompetition,
    getLeaderboardCompetitions,
    getLeaderboardCompetitionSeasonSync,
} from "../../lib/leaderboard/competition"
import {
    getLeaderboardSettlementConfigSync,
    getLeaderboardSettlementOverviewSync,
    getLeaderboardSeasonRewardViewSync,
    putLeaderboardSettlementConfigSync,
    rolloverLeaderboardSeasonSync,
    settleLeaderboardSeason,
    validateRewardTiers,
} from "../../lib/leaderboard/settlement"
import type { LeaderboardRewardRule } from "../../lib/leaderboard/rewards"
import {
    getLeaderboardAvailabilitySync,
    isLeaderboardDeadlineDueSync,
    setLeaderboardAvailabilitySync,
} from "../../lib/leaderboard/availability"
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator"
import { LeaderboardWorkBusyError, runLeaderboardWork } from "../../lib/leaderboard/work-control"
import { LeaderboardSyncLimitError, SYNCHRONOUS_SETTLEMENT_LIMITS } from "../../lib/leaderboard/sync-budget"
import { isPersistenceAdmissionError } from "../../lib/persistence-admission"

interface KeyParams { key: string }

function resolveKey(request: FastifyRequest, reply: FastifyReply): string | null {
    const key = (request.params as KeyParams).key
    if (getLeaderboardCompetition(key) !== null) return key
    reply.status(404).send({ error: "Leaderboard competition not found." })
    return null
}

const routes = async (fastify: FastifyInstance) => {
    fastify.setErrorHandler((error, _request, reply) => {
        if (error instanceof LeaderboardSyncLimitError) return reply.status(409).send({
            error: error.message, code: error.code, resource: error.resource,
            limit: SYNCHRONOUS_SETTLEMENT_LIMITS[error.resource], observed: error.observed,
        })
        if (!(error instanceof LeaderboardWorkBusyError)) return reply.send(error)
        return reply.header("retry-after", "2").status(429).send({ error: error.message, code: error.code })
    })
    fastify.get("/", async (_request, reply) => reply.send(
        getLeaderboardCompetitions().map(competition => ({
            competition,
            availability: getLeaderboardAvailabilitySync(competition.key),
            overview: getLeaderboardSettlementOverviewSync(competition.key),
        })),
    ))

    fastify.get("/:key", async (request, reply) => {
        const key = resolveKey(request, reply)
        if (key === null) return reply
        const competition = getLeaderboardCompetition(key)!
        const season = getLeaderboardCompetitionSeasonSync(key)
        const query = request.query as { page?: string }
        const requestedPage = Number(query.page ?? 0)
        if (!Number.isSafeInteger(requestedPage) || requestedPage < 0) {
            return reply.status(400).send({ error: "page must be a non-negative safe integer." })
        }
        const { total, filter } = getLeaderboardSeasonRewardViewSync(key, season)
        const page = Math.min(requestedPage, Math.max(0, Math.ceil(total / competition.pageSize) - 1))
        return reply.send({
            competition,
            availability: getLeaderboardAvailabilitySync(key),
            overview: getLeaderboardSettlementOverviewSync(key),
            page,
            rows: getLeaderboardRankPageSync({
                competitionKey: key,
                season,
                offset: page * competition.pageSize,
                limit: competition.pageSize,
                filter,
            }),
            total,
        })
    })

    fastify.patch("/:key/availability", async (request, reply) => {
        const key = resolveKey(request, reply)
        if (key === null) return reply
        const body = (request.body ?? {}) as Record<string, unknown>
        if (typeof body.enabled !== "boolean") {
            return reply.status(400).send({ error: "enabled must be a boolean." })
        }
        const enabled = body.enabled
        if (enabled) {
            const season = getLeaderboardCompetitionSeasonSync(key)
            if (getLeaderboardSeasonRewardViewSync(key, season).settled) {
                return reply.status(409).send({ error: "当前赛季已结算，请先换季再开启排行榜。" })
            }
            if (isLeaderboardDeadlineDueSync(key)) {
                return reply.status(409).send({ error: "已到截止时间，请先修改截止时间或关闭定时开关，再开启排行榜。" })
            }
        }
        return reply.send({
            ok: true,
            ...runPersistenceTransactionSync({
                domain: "leaderboard", operation: `admin_availability:${key}`,
            }, () => setLeaderboardAvailabilitySync(key, enabled)),
        })
    })

    fastify.patch("/:key/config", async (request, reply) => {
        const key = resolveKey(request, reply)
        if (key === null) return reply
        const current = getLeaderboardSettlementConfigSync(key)
        const body = (request.body ?? {}) as Record<string, unknown>
        const rewardTiers = body.rewardTiers === undefined
            ? current.rewardTiers
            : body.rewardTiers as LeaderboardRewardRule[]
        try {
            for (const field of ["autoEnabled", "freezeEnabled"] as const) {
                if (body[field] !== undefined && typeof body[field] !== "boolean") {
                    throw new Error("到时冻结和自动发奖开关必须是布尔值。")
                }
            }
            const autoEnabled = body.autoEnabled === undefined ? current.autoEnabled : body.autoEnabled as boolean
            const freezeEnabled = autoEnabled || (body.freezeEnabled === undefined
                ? current.freezeEnabled : body.freezeEnabled as boolean)
            const settleAtMs = body.settleAtMs === undefined ? current.settleAtMs
                : body.settleAtMs === null ? null : Number(body.settleAtMs)
            if ((autoEnabled || freezeEnabled) && settleAtMs === null) {
                throw new Error("开启定时冻结或自动发奖时必须设置截止时间。")
            }
            validateRewardTiers(rewardTiers)
            runPersistenceTransactionSync({
                domain: "leaderboard", operation: `admin_config:${key}`,
            }, () => putLeaderboardSettlementConfigSync({
                    ...current,
                    autoEnabled,
                    freezeEnabled,
                    settleAtMs,
                    repeatIntervalMs: body.repeatIntervalMs === undefined
                        ? current.repeatIntervalMs
                        : body.repeatIntervalMs === null ? null : Number(body.repeatIntervalMs),
                    rewardTiers,
                    mailSubject: typeof body.mailSubject === "string"
                        ? body.mailSubject : current.mailSubject,
                    mailBody: typeof body.mailBody === "string"
                        ? body.mailBody : current.mailBody,
                    excludeBots: body.excludeBots === undefined
                        ? current.excludeBots : Boolean(body.excludeBots),
                    updatedAtMs: Date.now(),
                }))
        } catch (error) {
            if (isPersistenceAdmissionError(error)) throw error
            return reply.status(400).send({
                error: error instanceof Error ? error.message : "Invalid settlement config.",
            })
        }
        return reply.send({ ok: true, config: getLeaderboardSettlementConfigSync(key) })
    })

    fastify.post("/:key/settle", async (request, reply) => {
        const key = resolveKey(request, reply)
        if (key === null) return reply
        const body = (request.body ?? {}) as Record<string, unknown>
        const expectedSeason = body.expectedSeason
        if (expectedSeason !== undefined && (!Number.isSafeInteger(expectedSeason) || (expectedSeason as number) < 1)) {
            return reply.status(400).send({ error: "expectedSeason must be a positive safe integer." })
        }
        const outcome = await settleLeaderboardSeason(key, "admin-manual", undefined, expectedSeason as number | undefined)
        return reply.status(outcome.ok ? 200 : 409).send(outcome)
    })

    fastify.post("/:key/rollover", async (request, reply) => {
        const key = resolveKey(request, reply)
        if (key === null) return reply
        const outcome = await runLeaderboardWork(key, "rollover", () => rolloverLeaderboardSeasonSync(key, "admin-rollover"))
        return reply.status(outcome.ok ? 200 : 409).send(outcome.ok ? outcome : {
            ...outcome,
            error: "当前赛季尚未结算，不能换季。",
        })
    })
}

export default routes
