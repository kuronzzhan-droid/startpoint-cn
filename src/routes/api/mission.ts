// Mission progress endpoints — get and update
// Uses lib/mission/ computer registry for compute dispatch

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerCategoryMissionsSync, updatePlayerCategoryMissionSync } from "../../data/domains/mission"
import { getSession } from "../../data/domains/session"
import { getPlayerMailCountSync } from "../../data/domains/mail"
import { generateDataHeaders, getServerTime, getServerDate } from "../../utils";
import { getComputer, getMissionIdsByCategory, getCurrentStage, getCharacterIdFromMission, getMissionFinalTargetProgress, isMissionEnabledAt, mergeMissionSettlementResponse, reconcileAwakeUnlockCharacterList, settleAwakeMissionRewards, settleMissionCategories, settleMissionCategoriesWithProgress } from "../../lib/mission/index";
import { collectClientProgressDeltas, resolveClientProgressTargets } from "../../lib/mission/client-progress";
import type { AwakeMissionComputedProgress, AwakeMissionInfo } from "../../lib/mission/index";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import type { CategoryContext } from "../../lib/mission/index";
import { gameVerboseLog } from "../../lib/game-logging";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";

interface GetMissionProgressBody {
    api_count: number,
    viewer_id: number,
    category_list: {
        category: number,
        event_id?: number,
        character_id?: number
    }[]
}

interface UpdateMissionProgressBody {
    viewer_id: number,
    api_count: number,
    mission_param_list: {
        progress_value: number,
        mission_pattern: string
    }[]
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_mission_progress", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetMissionProgressBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // Cache computer+context per category to avoid redundant builds
        const computerCache = new Map<string, { ctx: CategoryContext }>()

        function getCtx(category: number, missionIds?: readonly number[]): CategoryContext {
            const cacheKey = missionIds === undefined
                ? String(category)
                : `${category}:${missionIds.join(",")}`
            let entry = computerCache.get(cacheKey)
            if (!entry) {
                const computer = getComputer(category)
                const ctx = computer.buildContext(
                    playerId,
                    category,
                    evaluationTime,
                    missionIds,
                ) as CategoryContext
                entry = { ctx }
                computerCache.set(cacheKey, entry)
            }
            return entry.ctx
        }

        const requestList = body.category_list || [{ category: 1 }]
        const requestCategories = requestList.map(c => c.category)
        const evaluationTime = new Date(getServerTime() * 1000)
        const automaticScopes = requestList
            .filter(entry => [1, 2, 3, 4, 5, 6, 7, 8, 10].includes(entry.category))
            .map(entry => ({ category: entry.category, eventId: entry.event_id }))
        const automaticResult = automaticScopes.length > 0
            ? settleMissionCategoriesWithProgress(playerId, automaticScopes, evaluationTime)
            : null
        const automaticSettlement = automaticResult?.settlement ?? null
        const automaticProgress = new Map(
            (automaticResult?.evaluatedProgress ?? []).map(progress => [
                `${progress.category}:${progress.missionId}`,
                progress.progress,
            ]),
        )
        const missionProgressList: any[] = []
        const categoryMissionCache = new Map<number, ReturnType<typeof getPlayerCategoryMissionsSync>>()
        const awakeProgressByCharacter = new Map<string, AwakeMissionComputedProgress[]>()
        const awakeSnapshots = new Map<string, ReturnType<typeof getPlayerCategoryMissionsSync>>()

        for (const requestEntry of requestList) {
            const category = requestEntry.category
            const computer = getComputer(category)
            const allIds = getMissionIdsByCategory(category).filter(missionId =>
                isMissionEnabledAt(category, missionId, evaluationTime, requestEntry.event_id)
            )
            const charId = requestEntry.character_id === undefined ? undefined : String(requestEntry.character_id)
            const requestedIds = charId && category === 9
                ? allIds.filter(missionId => getCharacterIdFromMission(missionId) === charId)
                : allIds
            let ctx: CategoryContext | undefined
            let categoryMissions = category === 9 ? undefined : categoryMissionCache.get(category)

            for (const missionId of requestedIds) {
                const settledKey = `${category}:${missionId}`
                if (automaticProgress.has(settledKey)) {
                    const progress = automaticProgress.get(settledKey) ?? 0
                    missionProgressList.push({
                        mission_category: category,
                        mission_id: missionId,
                        progress_value: Number(progress),
                        stage: getCurrentStage(category, missionId, progress),
                    })
                    continue
                }
                if (!categoryMissions) {
                    if (category === 9) {
                        ctx ??= getCtx(category, requestedIds)
                        categoryMissions = ctx.persistedMissions ?? getPlayerCategoryMissionsSync(playerId, category, requestedIds)
                        if (charId !== undefined) awakeSnapshots.set(charId, categoryMissions)
                    } else {
                        categoryMissions = getPlayerCategoryMissionsSync(playerId, category)
                        categoryMissionCache.set(category, categoryMissions)
                    }
                }
                ctx ??= getCtx(category, requestedIds)
                const dbProgress = categoryMissions[String(missionId)]?.progress ?? 0
                const computed = computer.compute(missionId, ctx, dbProgress)
                const finalTarget = getMissionFinalTargetProgress(category, missionId)
                const monotonicProgress = Math.max(
                    0,
                    dbProgress,
                    Number.isFinite(computed) ? computed : 0,
                )
                const progress = finalTarget === undefined
                    ? monotonicProgress
                    : Math.min(monotonicProgress, finalTarget)
                const stage = getCurrentStage(category, missionId, progress)

                missionProgressList.push({
                    mission_category: category,
                    mission_id: missionId,
                    progress_value: Number(progress),
                    stage: stage
                })

                if (category === 9 && charId !== undefined) {
                    const awakeProgress = awakeProgressByCharacter.get(charId) ?? []
                    awakeProgress.push({ missionId, progress: Number(progress) })
                    awakeProgressByCharacter.set(charId, awakeProgress)
                }
            }
        }

        gameVerboseLog(() => `[MISSION] get_progress viewer=${viewerId} categories=${requestCategories} missions=${missionProgressList.length}`)

        const missionInfo: AwakeMissionInfo[] = []
        const itemList: Record<string, number> = {}
        let characterList: Record<string, unknown>[] = []
        const equipmentList: Object[] = []
        const degreeIds: number[] = []
        let userInfo: Record<string, number> | undefined

        for (const [characterId, awakeProgress] of awakeProgressByCharacter) {
            const settlement = settleAwakeMissionRewards(playerId, awakeProgress, awakeSnapshots.get(characterId))
            missionInfo.push(...settlement.missionInfo)
            Object.assign(itemList, settlement.itemList)
            characterList.push(...settlement.characterList)
            equipmentList.push(...settlement.equipmentList)
            for (const degreeId of settlement.degreeIds) {
                if (!degreeIds.includes(degreeId)) degreeIds.push(degreeId)
            }
            if (settlement.userInfo) userInfo = settlement.userInfo
        }

        const responseData: Record<string, unknown> = {
            mission_progress_list: missionProgressList,
            mission_info: missionInfo,
            item_list: itemList,
            character_list: characterList,
            equipment_list: equipmentList,
            degree_list: degreeIds.map(degreeId => ({ viewer_id: viewerId, degree_id: degreeId })),
        }
        if (userInfo) responseData.user_info = userInfo
        if (automaticSettlement) {
            mergeMissionSettlementResponse(
                responseData,
                automaticSettlement,
                viewerId,
            )
        }
        responseData.mail_arrived = getPlayerMailCountSync(playerId, true) > 0

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": responseData
        })
    })

    fastify.post("/update_mission_progress", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as UpdateMissionProgressBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const session = await getSession(viewerId.toString())
        if (!session) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(session.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        // Update mission progress counters in DB (fire-and-forget from client)
        const missionParams = collectClientProgressDeltas(body.mission_param_list)
        let updatedCount = 0
        const updatedMissionIdsByCategory = new Map<number, Set<number>>()
        const evaluationTime = await runPersistenceTransaction({
            domain: "mission", playerId, operation: "update_progress",
        }, () => {
            const evaluationTime = getServerDate()
            const categoryMissionCache = new Map<number, ReturnType<typeof getPlayerCategoryMissionsSync>>()
            for (const [pattern, delta] of missionParams) {
                const matches = resolveClientProgressTargets(
                    pattern,
                    evaluationTime,
                )
                for (const match of matches) {
                    let categoryMissions = categoryMissionCache.get(match.category)
                    if (!categoryMissions) {
                        categoryMissions = getPlayerCategoryMissionsSync(playerId, match.category)
                        categoryMissionCache.set(match.category, categoryMissions)
                    }
                    const current = categoryMissions[String(match.missionId)]
                    const previousProgress = current?.progress ?? 0
                    const finalTarget = getMissionFinalTargetProgress(match.category, match.missionId)
                    const unboundedProgress = previousProgress + delta
                    const nextProgress = finalTarget === undefined
                        ? unboundedProgress
                        : Math.max(previousProgress, Math.min(unboundedProgress, finalTarget))
                    updatePlayerCategoryMissionSync(
                        playerId,
                        match.category,
                        match.missionId,
                        nextProgress,
                    )
                    categoryMissions[String(match.missionId)] = {
                        progress: nextProgress,
                        stages: current?.stages ?? [],
                    }
                    const updatedMissionIds = updatedMissionIdsByCategory.get(match.category) ?? new Set<number>()
                    updatedMissionIds.add(match.missionId)
                    updatedMissionIdsByCategory.set(match.category, updatedMissionIds)
                    updatedCount++
                }
            }
            return evaluationTime
        })

        const characterList = reconcileAwakeUnlockCharacterList(playerId, [])
        const responseData: Record<string, unknown> = {
            "mission_info": [],
            "degree_list": [],
            character_list: characterList,
            "mail_arrived": getPlayerMailCountSync(playerId, true) > 0
        }
        // Settle only the missions whose validated client counters changed.
        // Daily all-clear is the sole exception because it depends on the full
        // active daily set rather than one reported pattern.
        const changedScopes = [...updatedMissionIdsByCategory]
            .filter(([category]) => [1, 2, 3, 4, 5, 6, 7, 8, 10].includes(category))
            .map(([category, missionIds]) => category === 2
                ? { category }
                : { category, missionIds: [...missionIds] })
        if (changedScopes.length > 0) {
            mergeMissionSettlementResponse(
                responseData,
                settleMissionCategories(playerId, changedScopes, evaluationTime),
                viewerId,
            )
        }
        gameVerboseLog(() => `[MISSION] update_progress viewer=${viewerId} patterns=${missionParams.size} db_updates=${updatedCount}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": responseData
        })
    })
}

export default routes;
