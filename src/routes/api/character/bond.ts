// Character bond token and mana board opening endpoints

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerCharacterSync, insertPlayerCharacterBondTokenSync, updatePlayerCharacterBondTokenSync, updatePlayerCharacterSync } from "../../../data/domains/character"
import { getPlayerSync, updatePlayerSync } from "../../../data/domains/player"
import { getSession } from "../../../data/domains/session"
import { generateDataHeaders } from "../../../utils";
import { getCharacterDataSync, getCharacterManaBoardCountSync } from "../../../lib/assets";
import { clientSerializeDate } from "../../../data/utils";
import { resolvePlayerIdSync } from "../../../data/activeAccount";
import { validateSessionAndPlayer, validateCharacterOwnership, buildCharacterListEntry, sendCharacterResponse } from "../../../lib/character-helpers";
import { characterExpCaps } from "../../../lib/character";
import { reconcileAwakeUnlockCharacterList } from "../../../lib/mission";
import { gameVerboseLog } from "../../../lib/game-logging";

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
        if (!sess) return
        const { playerId, player } = sess

        const characterData = validateCharacterOwnership(playerId, characterId, reply)
        if (!characterData) return

        const bondToken = characterData.bondTokenList
            .find(token => token.manaBoardIndex === manaBoardIndex)
        if (!bondToken || bondToken.status === 0) return reply.status(400).send({
            "error": "Bad Request", "message": "Cannot receive bond token."
        })

        // Already claimed — return current state
        if (bondToken.status === 2) {
            return sendCharacterResponse(reply, viewerId, {
                user_info: { bond_token: player.bondToken },
                character_list: [buildCharacterListEntry(characterId, characterData, {
                    bond_token_list: characterData.bondTokenList.map(e => ({ mana_board_index: e.manaBoardIndex, status: e.status })),
                })],
                user_character_mana_node_list: {},
                item_list: {},
                evolution: [],
                mail_arrived: false,
            }, playerId)
        }

        // Claim the bond token
        const newBondTokens = player.bondToken + 1
        updatePlayerSync({ id: playerId, bondToken: newBondTokens })
        updatePlayerCharacterBondTokenSync(playerId, characterId, { manaBoardIndex, status: 2 })

        const bondTokenList: Object[] = []
        for (const entry of characterData.bondTokenList) {
            bondTokenList.push({ "mana_board_index": entry.manaBoardIndex, "status": entry.manaBoardIndex === manaBoardIndex ? 2 : entry.status })
        }
        const characterList = reconcileAwakeUnlockCharacterList(playerId, [
            buildCharacterListEntry(characterId, characterData, { bond_token_list: bondTokenList })
        ])

        return sendCharacterResponse(reply, viewerId, {
            user_info: { bond_token: newBondTokens },
            character_list: characterList,
            user_character_mana_node_list: {},
            item_list: {},
            evolution: [],
            mail_arrived: false,
        }, playerId)
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

        // get character data
        const characterData = getPlayerCharacterSync(playerId, characterId)
        if (characterData === null) return reply.status(400).send({
            "error": "Bad Request", "message": "Character not owned."
        })

        // get character asset data
        const characterAssetData = getCharacterDataSync(characterId)
        if (characterAssetData === null) return reply.status(500).send({
            "error": "Internal Server Error", "message": "No character asset data found."
        })

        // make sure that the mana board index is valid, auto-create missing bond tokens
        if (!characterData.bondTokenList.some(token => token.manaBoardIndex === manaBoardIndex)) {
            const boardCount = getCharacterManaBoardCountSync(characterId)
            gameVerboseLog(() => `[MANA] open_mana_board: auto-creating bond tokens, bondListLen=${characterData.bondTokenList.length} boardCount=${boardCount}`)
            const existingBoards = new Set(characterData.bondTokenList.map(token => token.manaBoardIndex))
            for (let i = 1; i <= boardCount; i++) {
                if (existingBoards.has(i)) continue
                insertPlayerCharacterBondTokenSync(playerId, characterId, { manaBoardIndex: i, status: 0 })
                characterData.bondTokenList.push({ manaBoardIndex: i, status: 0 })
            }
            characterData.bondTokenList.sort((left, right) => left.manaBoardIndex - right.manaBoardIndex)
        }

        // ensure that the mana board can be opened
        const requiredLevelExp = openManaBoardRequiredExp[characterAssetData.rarity]
        if (requiredLevelExp !== undefined && requiredLevelExp > characterData.exp) {
            console.warn(`[MANA] open_mana_board FAIL: exp too low, need=${requiredLevelExp} have=${characterData.exp}`)
            return reply.status(400).send({
                "error": "Bad Request", "message": `Character level is too low to unlock mana board.`
            })
        }
        if (openManaBoardRequiredUncaps[characterAssetData.rarity] > characterData.overLimitStep) {
            console.warn(`[MANA] open_mana_board FAIL: uncap too low, need=${openManaBoardRequiredUncaps[characterAssetData.rarity]} have=${characterData.overLimitStep}`)
            return reply.status(400).send({
                "error": "Bad Request", "message": `Character is not uncapped enough to unlock mana board.`
            })
        }
        const previousBoardToken = characterData.bondTokenList
            .find(token => token.manaBoardIndex === manaBoardIndex - 1)
        if (manaBoardIndex > 1 && 1 > (previousBoardToken?.status ?? 0)) {
            console.warn(`[MANA] open_mana_board FAIL: prev board bond not claimed, prevBoard=${manaBoardIndex - 1} prevStatus=${previousBoardToken?.status}`)
            return reply.status(400).send({
                "error": "Bad Request", "message": `Must unlock all previous mana board nodes.`
            })
        }

        updatePlayerCharacterSync(playerId, characterId, { manaBoardIndex: manaBoardIndex })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "character_list": [{
                    "viewer_id": viewerId,
                    "character_id": characterId,
                    "mana_board_index": manaBoardIndex,
                    "create_time": clientSerializeDate(characterData.joinTime),
                    "update_time": clientSerializeDate(characterData.updateTime),
                    "join_time": clientSerializeDate(characterData.joinTime)
                }],
                "mail_arrived": false
            }
        })
    })
}

export default routes;
