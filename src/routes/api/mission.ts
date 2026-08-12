// Mission progress endpoints: get and update
// Uses lib/mission/ computer registry for compute dispatch

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
    getPlayerCategoryMissionsSync,
    updatePlayerActiveMissionSync,
} from "../../data/domains/mission"
import { getSession } from "../../data/domains/session"
import { getPlayerMailCountSync } from "../../data/domains/mail"
import { generateDataHeaders, getServerTimeForPlayer } from "../../utils";
import {
    getCurrentStage,
    getMissionIdsByCategory,
    getMissionsByPattern,
    getCharacterIdFromMission,
    mergeMissionSettlementResponse,
    settleAwakeMissionCandidatesAsync,
    settleMissionCategoriesAsync,
} from "../../lib/mission/index";
import {
    getMissionMasterDefinition,
    isMissionDefinitionEnabledAt,
} from "../../lib/mission/master-data"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import type { MissionSettlementResult } from "../../lib/mission/index";

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

        const requestList = body.category_list || [{ category: 1 }]
        const requestCategories = requestList.map(c => c.category)
        const missionEvaluationTime = new Date(getServerTimeForPlayer(playerId) * 1000)
        const automaticScopes = requestList
            .filter(entry => [1, 2, 3, 4, 5, 6, 7, 8, 10].includes(entry.category))
            .map(entry => ({ category: entry.category, eventId: entry.event_id }))
        const automaticSettlement = automaticScopes.length === 0
            ? null
            : await settleMissionCategoriesAsync(playerId, automaticScopes, missionEvaluationTime)

        const missionProgressList: any[] = []
        const categoryMissionCache = new Map<number, ReturnType<typeof getPlayerCategoryMissionsSync>>()
        const awakeSettlements: MissionSettlementResult[] = []

        for (const requestEntry of requestList) {
            const category = requestEntry.category
            const allIds = getMissionIdsByCategory(category).filter(missionId => {
                const definition = getMissionMasterDefinition(category, missionId)
                if (!definition) throw new Error(`Mission master definition ${category}:${missionId} is missing.`)
                return isMissionDefinitionEnabledAt(
                    definition,
                    missionEvaluationTime,
                    requestEntry.event_id,
                )
            })
            const charId = requestEntry.character_id === undefined
                ? undefined
                : String(requestEntry.character_id)
            const requestedIds = charId && category === 9
                ? allIds.filter(missionId => getCharacterIdFromMission(missionId) === charId)
                : allIds

            if (category === 9) {
                awakeSettlements.push(await settleAwakeMissionCandidatesAsync(
                    playerId,
                    requestedIds,
                    missionEvaluationTime,
                ))
            }

            let categoryMissions = categoryMissionCache.get(category)
            if (!categoryMissions || category === 9) {
                categoryMissions = getPlayerCategoryMissionsSync(playerId, category)
                categoryMissionCache.set(category, categoryMissions)
            }
            for (const missionId of requestedIds) {
                const progress = categoryMissions[String(missionId)]?.progress ?? 0
                missionProgressList.push({
                    mission_category: category,
                    mission_id: missionId,
                    progress_value: Number(progress),
                    stage: getCurrentStage(category, missionId, progress),
                })
            }
        }

        console.log(`[MISSION] get_progress viewer=${viewerId} categories=${requestCategories} missions=${missionProgressList.length}`)

        const responseData: Record<string, any> = {
            mission_progress_list: missionProgressList,
            mission_info: [],
            item_list: {},
            character_list: [],
            equipment_list: [],
            degree_list: [],
        }
        if (automaticSettlement) mergeMissionSettlementResponse(responseData, automaticSettlement, viewerId)
        for (const settlement of awakeSettlements) {
            mergeMissionSettlementResponse(responseData, settlement, viewerId)
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
        const missionParams = body.mission_param_list || []
        let updatedCount = 0

        for (const param of missionParams) {
            const matches = getMissionsByPattern(param.mission_pattern)
            for (const m of matches) {
                updatePlayerActiveMissionSync(playerId, m.missionId, param.progress_value)
                updatedCount++
            }
        }

        console.log(`[MISSION] update_progress viewer=${viewerId} params=${missionParams.length} db_updates=${updatedCount}`)

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "mission_info": [],
                "degree_list": []
            }
        })
    })
}

export default routes;
