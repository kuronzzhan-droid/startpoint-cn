import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerSync } from "../../data/domains/player"
import { getPlayerCharacterSync } from "../../data/domains/character"
import { getFollowRelationSync } from "../../data/domains/follow"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { generateDataHeaders } from "../../utils";
import { resolveAttentionEstablisherRank } from "../../lib/attention-rank"
import { getFavoritePartySelectionSync } from "../../lib/profileFavorite"
import { getRoom, isRoomWaitingForExpectedMember } from "../../multi/room/manager"
import { sessionManager } from "../../multi/state/SessionManager"
import { takeRandomRecruitments } from "../../multi/recruitment"
import { gameVerboseLog } from "../../lib/game-logging"
import { isNewbiePlayerSync } from "../../lib/newbie"

interface CheckBody {
    viewer_id: number
    holding_number: number
    retry_count: number
    request_number: number
}

interface ActionBody {
    viewer_id: number
    priority_factors: string[]
    api_count: number
}

interface LoggerBody {
    viewer_id: number
    client_logs: any[]
    api_count: number
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/check", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as CheckBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
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
        const player = playerId !== null ? getPlayerSync(playerId) : null

        if (player === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No players bound to account."
        })

        const requested = Number.isFinite(body.request_number) ? body.request_number : 3
        const holding = Number.isFinite(body.holding_number) ? body.holding_number : 0
        const availableSlots = Math.max(0, Math.min(3, requested) - Math.max(0, holding))

        const recruitments = takeRandomRecruitments(viewerId, availableSlots, recruitment => {
            const room = getRoom(recruitment.roomNumber)
            if (!room || room.host_viewer_id === viewerId) return false
            if (room.is_npc_mode || room.raising_state === 4) return false
            if (!sessionManager.isHostOnline(room.host_viewer_id, room.room_number, room.lobby_generation)) return false
            if (isRoomWaitingForExpectedMember(room)) return false
            return sessionManager.getRoomClientCount(room.room_number, room.lobby_generation) < 3
        })

        const multi = recruitments.flatMap(recruitment => {
            const room = getRoom(recruitment.roomNumber)
            if (!room) return []
            const host = getPlayerSync(room.host_player_id)
            if (!host) return []
            // Rescue cards must use the same avatar source as the public
            // profile. The legacy leaderCharacterId is still character 1
            // (Arcl) on many old saves, even after the player edits favorites.
            const favorite = getFavoritePartySelectionSync(
                room.host_player_id,
                host.leaderCharacterId,
            )
            const profileLeaderId =
                favorite.characterIds[0]
                ?? room.host_main_character_id
                ?? host.leaderCharacterId
                ?? 1
            const leader = getPlayerCharacterSync(
                room.host_player_id,
                profileLeaderId,
            )
            const isNewbie = isNewbiePlayerSync(room.host_player_id, host)
            return [{
                "attention_key": recruitment.attentionKey,
                "quest_info": {
                    "category_id": room.category,
                    "establisher_character": profileLeaderId,
                    "establisher_character_evolution_img_level": leader?.evolutionLevel ?? 0,
                    "establisher_follow": getFollowRelationSync(playerId, room.host_player_id).state,
                    "establisher_rank": resolveAttentionEstablisherRank(host.rankPoint || 0),
                    "host_entry_time": room.host_entry_time,
                    "is_newbie": isNewbie,
                    "quest_id": room.quest_id,
                    "room_number": room.room_number,
                }
            }]
        })

        if (multi.length > 0) {
            gameVerboseLog(() => `[ATTENTION] check: viewer=${viewerId} delivered=${multi.length} rooms=${multi.map(item => item.quest_info.room_number).join(",")}`)
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "config": {
                    "attention_recruitment_interval_seconds": 15,
                    "attention_recruitment_redeliver_limit": 20,
                    "attention_polling_interval_seconds_normal": 10,
                    "attention_polling_interval_seconds_battle": 15,
                    "multi_attention_lifetime_seconds": 30,
                    "contribution_score_rate_to_parasite": 0.25,
                    "attention_log_interval_seconds": 600,
                    "disable_finish_duration_seconds": 5,
                    "disable_decline_count_seconds": 60,
                    "disable_decline_count_limit": 14,
                    "disable_decline_duration_seconds": 30,
                    "disable_intent_disconnect_duration_seconds": 300,
                    "disable_unintent_disconnect_duration_seconds": 5,
                    "disable_remote_error_duration_seconds": 300,
                    "attention_animation_time_seconds": 6,
                    "disable_expire_count_limit": 4,
                    "disable_expire_duration_seconds": 180,
                    "polling_delay_normal_seconds_range_min": 1,
                    "polling_delay_normal_seconds_range_max": 10,
                    "polling_delay_battle_seconds_range_min": 1,
                    "polling_delay_battle_seconds_range_max": 15,
                    "return_attention_max_num": 3
                },
                "multi": multi,
            }
        })
    })

    // ---- action (stub: NPC-only, no real matching) ----
    fastify.post("/action", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ActionBody
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) {
            console.log(`[ATTENTION] action: 400 invalid viewer_id=${viewerId}`)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            })
        }
        gameVerboseLog(() => `[ATTENTION] action: viewer=${viewerId} factors=${body.priority_factors?.length ?? 0}`)
        gameVerboseLog(() => `[ATTENTION] action: factors_detail=${JSON.stringify(body.priority_factors)}`)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "priority_action_score": 0,
                "priority_playing_score": 0
            }
        })
    })

    // ---- logger (stub: NPC-only, discard logs) ----
    fastify.post("/logger", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as LoggerBody
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) {
            console.log(`[ATTENTION] logger: 400 invalid viewer_id=${viewerId}`)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            })
        }
        gameVerboseLog(() => `[ATTENTION] logger: viewer=${viewerId} logs=${body.client_logs?.length ?? 0}`)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {}
        })
    })
}

export default routes;
