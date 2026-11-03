// Character bond token and mana board opening endpoints

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerCharacterSync, insertPlayerCharacterBondTokenSync, updatePlayerCharacterBondTokenSync, updatePlayerCharacterSync } from "../../../data/domains/character"
import { getPlayerSync, updatePlayerSync } from "../../../data/domains/player"
import { getSession } from "../../../data/domains/session"
import { generateDataHeaders } from "../../../utils";
import { getCharacterDataSync, getCharacterManaBoardCountSync } from "../../../lib/assets";
import { clientSerializeDate } from "../../../data/utils";
import { resolvePlayerIdSync } from "../../../data/activeAccount";
import { validateSessionAndPlayer, buildCharacterListEntry, sendCharacterResponse, type CharacterResponseData } from "../../../lib/character-helpers";
import { characterExpCaps } from "../../../lib/character";
import { reconcileAwakeUnlockCharacterList } from "../../../lib/mission";
import { gameVerboseLog } from "../../../lib/game-logging";
import { runPersistenceTransaction } from "../../../lib/persistence-coordinator";

interface ReceiveBondTokenBody {
    character_id: number,
    mana_board_index: number,
    api_count: number,
    viewer_id: number
}

const openManaBoardRequiredUncaps: Record<number, number> = {
    [1]: 10, [2]: 8, [3]: 6, [4]: 4, [5]: 2
}

const openManaBoardRequiredExp: Record<number, number> = {
    [3]: characterExpCaps[3][0],
    [4]: characterExpCaps[4][0],
    [5]: characterExpCaps[5][0]
}

const routes = async (fastify: FastifyInstance) => {

    fastify.post("/receive_bond_token", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReceiveBondTokenBody

        const viewerId = body.viewer_id
        const characterId = body.character_id
        const manaBoardIndex = body.mana_board_index
        gameVerboseLog(() => `[MANA] receive_bond_token: viewer=${viewerId} char=${characterId} boardIdx=${manaBoardIndex}`)
        if (isNaN(viewerId) || isNaN(characterId) || isNaN(manaBoardIndex)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const sess = await validateSessionAndPlayer(viewerId, reply)
        if (!sess) return reply
        const { playerId } = sess
        const result = await runPersistenceTransaction({
            domain: "player", playerId, operation: "character_receive_bond_token",
        }, () => {
            const player = getPlayerSync(playerId)
            if (!player) throw new Error("Player not found.")
            const character = getPlayerCharacterSync(playerId, characterId)
            if (!character) return { error: "Character not owned." }
            const token = character.bondTokenList.find(entry => entry.manaBoardIndex === manaBoardIndex)
            if (!token || token.status === 0) return { error: "Cannot receive bond token." }

            // Replays read the committed claim marker inside the same player queue.
            const shouldClaim = token.status !== 2
            const balance = player.bondToken + (shouldClaim ? 1 : 0)
            if (shouldClaim) {
                updatePlayerSync({ id: playerId, bondToken: balance })
                updatePlayerCharacterBondTokenSync(playerId, characterId, { manaBoardIndex, status: 2 })
            }
            const entries = [buildCharacterListEntry(characterId, character, {
                bond_token_list: character.bondTokenList.map(entry => ({
                    mana_board_index: entry.manaBoardIndex,
                    status: entry.manaBoardIndex === manaBoardIndex ? 2 : entry.status,
                })),
            })]
            const data: CharacterResponseData = {
                user_info: { bond_token: balance },
                character_list: shouldClaim ? reconcileAwakeUnlockCharacterList(playerId, entries) : entries,
                user_character_mana_node_list: {}, item_list: {}, evolution: [], mail_arrived: false,
            }
            return { data }
        })
        if (result.error !== undefined) {
            return reply.status(400).send({ error: "Bad Request", message: result.error })
        }
        return sendCharacterResponse(reply, viewerId, result.data!, playerId)
    })

    fastify.post("/open_mana_board", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReceiveBondTokenBody

        const viewerId = body.viewer_id
        const characterId = body.character_id
        const manaBoardIndex = body.mana_board_index
        gameVerboseLog(() => `[MANA] open_mana_board: viewer=${viewerId} char=${characterId} boardIdx=${manaBoardIndex}`)
        if (isNaN(viewerId) || isNaN(characterId) || isNaN(manaBoardIndex)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })

        const viewerIdSession = await getSession(viewerId.toString())
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id."
        })

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No players bound to account."
        })

        const characterAssetData = getCharacterDataSync(characterId)
        if (characterAssetData === null) return reply.status(500).send({
            error: "Internal Server Error", message: "No character asset data found."
        })

        const result = await runPersistenceTransaction({
            domain: "player", playerId, operation: "character_open_mana_board",
        }, () => {
            const character = getPlayerCharacterSync(playerId, characterId)
            if (!character) return { error: "Character not owned." }
            const requiredExp = openManaBoardRequiredExp[characterAssetData.rarity]
            if (requiredExp !== undefined && requiredExp > character.exp) {
                return { error: "Character level is too low to unlock mana board." }
            }
            if (openManaBoardRequiredUncaps[characterAssetData.rarity] > character.overLimitStep) {
                return { error: "Character is not uncapped enough to unlock mana board." }
            }
            const previous = character.bondTokenList.find(token => token.manaBoardIndex === manaBoardIndex - 1)
            if (manaBoardIndex > 1 && (previous?.status ?? 0) < 1) {
                return { error: "Must unlock all previous mana board nodes." }
            }
            if (!character.bondTokenList.some(token => token.manaBoardIndex === manaBoardIndex)) {
                const boardCount = getCharacterManaBoardCountSync(characterId)
                const existingBoards = new Set(character.bondTokenList.map(token => token.manaBoardIndex))
                for (let i = 1; i <= boardCount; i++) {
                    if (!existingBoards.has(i)) {
                        insertPlayerCharacterBondTokenSync(playerId, characterId, { manaBoardIndex: i, status: 0 })
                    }
                }
            }
            updatePlayerCharacterSync(playerId, characterId, { manaBoardIndex })
            return { data: {
                character_list: [{
                    viewer_id: viewerId, character_id: characterId, mana_board_index: manaBoardIndex,
                    create_time: clientSerializeDate(character.joinTime),
                    update_time: clientSerializeDate(character.updateTime),
                    join_time: clientSerializeDate(character.joinTime),
                }],
                mail_arrived: false,
            } }
        })
        if (result.error !== undefined) {
            return reply.status(400).send({ error: "Bad Request", message: result.error })
        }
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }), data: result.data,
        })
    })
}

export default routes;
