import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { updatePlayerPartySync } from "../../data/domains/party"
import { generateDataHeaders } from "../../utils";
import { registerWikiTeamCodeRoutes, playerTeamInventory } from "../../lib/wiki-team-code-routes";
import { loadTeamCodeAssets, ownedTeam } from "../../lib/wiki-team-code-inventory";
import { resolvePlayerIdSync } from "../../data/activeAccount";

interface PartyInfoListItem {
    party_edited: boolean
    party_category: number
    party_name: string
    party_id: number
    unison_character_ids: (number | null)[]
    equipment_ids: (number | null)[]
    character_ids: (number | null)[]
    ability_soul_ids: (number | null)[]
    options: {
        allow_other_players_to_heal_me: boolean
    }
    current_battle_power?: number
    before_battle_power?: number
}

interface EditBody {
    use_party_group_edit: boolean,
    main_party_id: number,
    viewer_id: number,
    ignore_ngword: boolean,
    api_count: number,
    party_info_list: PartyInfoListItem[]
}

const routes = async (fastify: FastifyInstance) => {
    registerWikiTeamCodeRoutes(fastify)

    fastify.post("/edit", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as EditBody

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

        // parse global PartyId: (groupIndex * 10 + slot), groupIndex 0-based
        const parsePartyId = (partyId: number) => {
            const gIdx = Math.floor((partyId - 1) / 10)
            const s = ((partyId - 1) % 10) + 1
            return { groupIndex: gIdx, groupId: gIdx + 1, slot: s }
        }

        // store full global PartyId so /load returns the correct group+slot combo
        if (player.partySlot !== body.main_party_id) {
            updatePlayerSync({
                id: playerId,
                partySlot: body.main_party_id
            })
        }

        // update each slot
        const inventory = playerTeamInventory(playerId)
        const teamAssets = loadTeamCodeAssets()
        const editCategories: number[] = []
        for (const updateInfo of body.party_info_list) {
            editCategories.push(updateInfo.party_category)
        }
        console.log(`[PARTY] edit: viewer=${viewerId} parties=${body.party_info_list.length} categories=${JSON.stringify(editCategories)} mainPartyId=${body.main_party_id}`)

        for (const updateInfo of body.party_info_list) {
            const parsed = parsePartyId(updateInfo.party_id)
            const owned = ownedTeam({main: updateInfo.character_ids, unison: updateInfo.unison_character_ids,
                weapon: updateInfo.equipment_ids, soul: updateInfo.ability_soul_ids}, inventory, teamAssets)
            console.log(`[PARTY] edit: player=${playerId} id=${updateInfo.party_id} -> group=${parsed.groupId} slot=${parsed.slot} name="${updateInfo.party_name}" chars=${updateInfo.character_ids?.filter(Boolean).length || 0}`)
            updatePlayerPartySync(
                playerId,
                parsed.slot,
                {
                    name: updateInfo.party_name,
                    unisonCharacterIds: owned.unison,
                    characterIds: owned.main,
                    equipmentIds: owned.weapon,
                    abilitySoulIds: owned.soul,
                    options: { allowOtherPlayersToHealMe: updateInfo.options.allow_other_players_to_heal_me },
                    edited: updateInfo.party_edited,
                    category: updateInfo.party_category === 3 ? 4 : updateInfo.party_category,
                    currentBattlePower: updateInfo.current_battle_power ?? 0,
                    beforeBattlePower: updateInfo.before_battle_power ?? 0
                },
                parsed.groupId
            )
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": {
                "mail_arrived": false
            }
        })
    })

    fastify.post("/check_word", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, word: string }
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": { "check_passed": true }
        })
    })
}

export default routes;