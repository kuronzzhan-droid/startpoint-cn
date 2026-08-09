import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { resolvePlayerIdSync } from "../../data/activeAccount"
import { getDb } from "../../data/db"
import { getSession } from "../../data/domains/session"
import { generateDataHeaders } from "../../utils"

interface RecentPartyRequestBody {
    viewer_id: number
    category: number
    quest_id: number
}

interface RecentPartyRow {
    player_id: number
    party_name: string
    power: number
    character_id_1: number | null
    character_id_2: number | null
    character_id_3: number | null
    evolution_img_level_1: number | null
    evolution_img_level_2: number | null
    evolution_img_level_3: number | null
    unison_character_id_1: number | null
    unison_character_id_2: number | null
    unison_character_id_3: number | null
    unison_evolution_img_level_1: number | null
    unison_evolution_img_level_2: number | null
    unison_evolution_img_level_3: number | null
    equipment_id_1: number | null
    equipment_id_2: number | null
    equipment_id_3: number | null
    ability_soul_id_1: number | null
    ability_soul_id_2: number | null
    ability_soul_id_3: number | null
}

/**
 * Returns up to ten distinct parties owned by other players. The original
 * service calls this "recent other player party"; this server does not retain
 * historical battle-party snapshots, so current saved parties are used as the
 * recommendation source. The response shape matches the CN client's strict
 * decoder and is valid for every quest category.
 */
const routes = async (fastify: FastifyInstance) => {
    fastify.post("/get_recent_other_player_party", async (
        request: FastifyRequest,
        reply: FastifyReply,
    ) => {
        const body = request.body as RecentPartyRequestBody
        const viewerId = Number(body?.viewer_id)
        const category = Number(body?.category)
        const questId = Number(body?.quest_id)

        if (
            !Number.isFinite(viewerId) ||
            !Number.isFinite(category) ||
            !Number.isFinite(questId)
        ) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body.",
            })
        }

        const session = await getSession(String(viewerId))
        if (!session) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id.",
            })
        }

        const playerId = resolvePlayerIdSync(session.accountId)
        if (playerId === null) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account.",
            })
        }

        const candidates = getDb().prepare(`
            SELECT
                p.player_id,
                p.name AS party_name,
                p.current_battle_power AS power,
                p.character_id_1,
                p.character_id_2,
                p.character_id_3,
                c1.evolution_level AS evolution_img_level_1,
                c2.evolution_level AS evolution_img_level_2,
                c3.evolution_level AS evolution_img_level_3,
                p.unison_character_1 AS unison_character_id_1,
                p.unison_character_2 AS unison_character_id_2,
                p.unison_character_3 AS unison_character_id_3,
                u1.evolution_level AS unison_evolution_img_level_1,
                u2.evolution_level AS unison_evolution_img_level_2,
                u3.evolution_level AS unison_evolution_img_level_3,
                p.equipment_1 AS equipment_id_1,
                p.equipment_2 AS equipment_id_2,
                p.equipment_3 AS equipment_id_3,
                p.ability_soul_1 AS ability_soul_id_1,
                p.ability_soul_2 AS ability_soul_id_2,
                p.ability_soul_3 AS ability_soul_id_3
            FROM players_parties p
            LEFT JOIN players_characters c1
                ON c1.player_id = p.player_id AND c1.id = p.character_id_1
            LEFT JOIN players_characters c2
                ON c2.player_id = p.player_id AND c2.id = p.character_id_2
            LEFT JOIN players_characters c3
                ON c3.player_id = p.player_id AND c3.id = p.character_id_3
            LEFT JOIN players_characters u1
                ON u1.player_id = p.player_id AND u1.id = p.unison_character_1
            LEFT JOIN players_characters u2
                ON u2.player_id = p.player_id AND u2.id = p.unison_character_2
            LEFT JOIN players_characters u3
                ON u3.player_id = p.player_id AND u3.id = p.unison_character_3
            WHERE p.player_id <> ?
              AND p.character_id_1 IS NOT NULL
              AND p.category IN (1, 4)
            ORDER BY
                CASE WHEN p.current_battle_power > 0 THEN 0 ELSE 1 END,
                p.current_battle_power DESC,
                p.edited DESC,
                p.player_id DESC
            LIMIT 200
        `).all(playerId) as RecentPartyRow[]

        const seenCompositions = new Set<string>()
        const recentParties: Omit<RecentPartyRow, "player_id">[] = []
        for (const candidate of candidates) {
            const compositionKey = [
                candidate.character_id_1,
                candidate.character_id_2,
                candidate.character_id_3,
                candidate.unison_character_id_1,
                candidate.unison_character_id_2,
                candidate.unison_character_id_3,
                candidate.equipment_id_1,
                candidate.equipment_id_2,
                candidate.equipment_id_3,
                candidate.ability_soul_id_1,
                candidate.ability_soul_id_2,
                candidate.ability_soul_id_3,
            ].join(":")
            if (seenCompositions.has(compositionKey)) continue
            seenCompositions.add(compositionKey)

            const { player_id: _playerId, ...party } = candidate
            recentParties.push({
                ...party,
                party_name: party.party_name || "推荐编成",
                power: Math.max(0, Math.trunc(Number(party.power) || 0)),
            })
            if (recentParties.length >= 10) break
        }

        console.log(
            `[QUEST-RECOMMEND] player=${playerId} category=${category} ` +
            `quest=${questId} candidates=${candidates.length} returned=${recentParties.length}`,
        )

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                recent_other_player_party: recentParties,
            },
        })
    })
}

export default routes
