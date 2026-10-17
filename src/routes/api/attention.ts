import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerSync } from "../../data/domains/player"
import { getPlayerCharacterSync } from "../../data/domains/character"
import { getFollowRelationSync } from "../../data/domains/follow"
import { generateDataHeaders } from "../../utils";
import { resolveAttentionEstablisherRank } from "../../lib/attention-rank"
import { getFavoritePartySelectionSync } from "../../lib/profileFavorite"
import { gameVerboseLog } from "../../lib/game-logging"
import { isNewbiePlayerSync } from "../../lib/newbie"
import { resolveMultiPlayerContext } from "../../multi/player-context"
import { getAttentionConfig } from "../../multi/attention-config"
import { isMode15RoomClosed } from "../../multi/mode15-room-gate"
import { canJoinMultiGuestQuestSync } from "../../multi/guest-eligibility"

import { getRoomCommandGateway } from "../../multi/coordinator/default-runtime"
import type { LobbyRoomProjection } from "../../multi/coordinator/lobby-command-handlers"
import { fetchLobbyRoomProjections } from "../../multi/http/lobby"
import { installRealtimeHttpFailureHandler } from "../../multi/http/command-error"

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
    installRealtimeHttpFailureHandler(fastify)
    fastify.post("/check", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as CheckBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })

        const ctx = await resolveMultiPlayerContext(viewerId)
        if (!ctx) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id or no player bound."
        })
        const { playerId, player } = ctx

        const requested = Number.isFinite(body.request_number) ? body.request_number : 3
        const holding = Number.isFinite(body.holding_number) ? body.holding_number : 0
        const availableSlots = Math.max(0, Math.min(3, requested) - Math.max(0, holding))
        const guestEligibilityByQuest = new Map<string, boolean>()

        const candidates = await fetchLobbyRoomProjections(viewerId, undefined, undefined, true)
        const eligible = candidates.filter(room => {
            if (room.host_viewer_id === viewerId || room.is_npc_mode || isMode15RoomClosed(room)) return false
            if (!room.hostOnline || room.occupancy >= 3 || room.waitingForExpectedMember || ["STARTING", "BATTLE"].includes(room.phase)) return false
            const key = `${room.category}:${room.quest_id}`
            let allowed = guestEligibilityByQuest.get(key)
            if (allowed === undefined) {
                allowed = canJoinMultiGuestQuestSync(playerId, room.category, room.quest_id, player).allowed
                guestEligibilityByQuest.set(key, allowed)
            }
            // Do not consume delivery quota for an absent host business record.
            return allowed && !!getPlayerSync(room.host_player_id)
        })
        const recruitments = await getRoomCommandGateway().execute("lobby.attention.take", {
            viewerId, limit: availableSlots,
            eligible: eligible.map(room => ({ roomNumber: room.room_number, identity: room.identity })),
        }) as { attentionKey: string; room: LobbyRoomProjection }[]

        const multi = recruitments.flatMap(recruitment => {
            const room = recruitment.room
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
                "config": getAttentionConfig(),
                "multi": multi.length > 0 ? multi : null,
            }
        })
    })

    // ---- action (stub: NPC-only, no real matching) ----
    fastify.post("/action", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ActionBody
        const viewerId = body.viewer_id
        if (!await resolveMultiPlayerContext(viewerId)) {
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

    // ---- logger ----
    fastify.post("/logger", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as LoggerBody
        const viewerId = body.viewer_id
        if (!await resolveMultiPlayerContext(viewerId)) {
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
