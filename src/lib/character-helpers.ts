// Character endpoint shared helpers — session validation, mana/item deduction

import { FastifyReply } from "fastify"
import type { Player, PlayerCharacter } from "../data/types"
import { getPlayerSync } from "../data/domains/player"
import {
    getPlayerCharacterSync,
    getPlayerCharactersManaNodesSync,
    getPlayerCharactersSync,
    insertPlayerCharacterBondTokenSync,
    updatePlayerCharacterBondTokenSync,
    updatePlayerCharacterSync,
} from "../data/domains/character"
import { getSession } from "../data/domains/session"
import { resolvePlayerIdSync } from "../data/activeAccount"
import { getPlayerItemSync } from "../data/domains/item"
import { getDb } from "../data/db"
import { generateDataHeaders } from "../utils"
import { clientSerializeDate } from "../data/utils"
import { getCharacterManaBoardCountSync, getCharacterManaNodesSync } from "./assets"
import { settleDegreeMissionResponse } from "./mission/degree-response"

// ─── Response types ───

export interface CharacterResponseData {
    user_info: Record<string, unknown>
    character_list: Record<string, unknown>[]
    user_character_mana_node_list: Record<string, { multiplied_id: number; awake_level: number }[]>
    item_list: Record<string, number>
    evolution: Object
    mail_arrived: boolean
    mission_info?: Record<string, unknown>[]
    degree_list?: Record<string, unknown>[]
    equipment_list?: Record<string, unknown>[]
}

// ─── Shared validation ───

export interface ValidatedSession {
    viewerId: number
    playerId: number
    player: Player
}

/** Validates session + player existence. Sends 400/500 on failure. */
export async function validateSessionAndPlayer(
    viewerId: number,
    reply: FastifyReply
): Promise<ValidatedSession | null> {
    const session = await getSession(viewerId.toString())
    if (!session) {
        reply.status(400).send({ "error": "Bad Request", "message": "Invalid viewer id." })
        return null
    }
    const playerId = resolvePlayerIdSync(session.accountId)!
    const player = getPlayerSync(playerId)
    if (!player) {
        reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." })
        return null
    }
    return { viewerId, playerId, player }
}

export interface ValidatedCharacter extends ValidatedSession {
    characterId: number
    characterData: PlayerCharacter
}

/** Validates character ownership. Sends 400 on failure. */
export function validateCharacterOwnership(
    playerId: number,
    characterId: number,
    reply: FastifyReply
): PlayerCharacter | null {
    const characterData = getPlayerCharacterSync(playerId, characterId)
    if (!characterData) {
        reply.status(400).send({ "error": "Bad Request", "message": "Character not owned." })
        return null
    }
    return characterData
}

// ─── Mana deduction ───

export function computeManaDeduction(player: Player, manaCost: number): {
    newFreeMana: number
    newPaidMana: number
} | null {
    let remaining = manaCost
    let newFreeMana = player.freeMana
    let newPaidMana = player.paidMana
    if (remaining <= newFreeMana) {
        newFreeMana -= remaining
    } else {
        remaining -= newFreeMana
        newFreeMana = 0
        newPaidMana -= remaining
    }
    if (newFreeMana < 0 || newPaidMana < 0) return null
    return { newFreeMana, newPaidMana }
}

// ─── Item deduction ───

/** Validates item availability and computes remaining amounts. Returns null on insufficient. */
export function computeItemDeductions(
    playerId: number,
    itemsCosts: Record<string, number>,
    reply: FastifyReply
): Record<string, number> | null {
    const result: Record<string, number> = {}
    for (const [itemId, itemCost] of Object.entries(itemsCosts)) {
        const item = getPlayerItemSync(playerId, itemId)
        const newAmount = (item ?? 0) - itemCost
        if (newAmount < 0) {
            reply.status(400).send({ "error": "Bad Request", "message": `Not enough of item with id ${itemId}` })
            return null
        }
        result[itemId] = newAmount
    }
    return result
}

// ─── Response builders ───

/** Builds the standard character_list entry for mana-related responses. */
export function buildCharacterListEntry(
    characterId: number,
    characterData: PlayerCharacter,
    extras: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        character_id: characterId,
        evolution_level: characterData.evolutionLevel,
        evolution_img_level: characterData.evolutionLevel,
        create_time: clientSerializeDate(characterData.joinTime),
        update_time: clientSerializeDate(characterData.updateTime),
        join_time: clientSerializeDate(characterData.joinTime),
        bond_token_list: [],
        ...extras,
    }
}

/** Merges mission-unlocked and persisted mana-board awake levels. */
export function mergeManaBoardAwakeMaps(
    ...maps: Map<string, Record<number, number>>[]
): Map<string, Record<number, number>> {
    const merged = new Map<string, Record<number, number>>()

    for (const map of maps) {
        for (const [characterId, boardLevels] of map) {
            const current = merged.get(characterId) ?? {}
            for (const [boardIndex, awakeLevel] of Object.entries(boardLevels)) {
                const index = Number(boardIndex)
                current[index] = Math.max(current[index] ?? 0, awakeLevel)
            }
            merged.set(characterId, current)
        }
    }

    return merged
}

/** Builds the minimal common-response entries needed to refresh Awake unlocks. */
export function buildManaBoardAwakeCharacterList(
    characters: Record<string, PlayerCharacter>,
    manaBoardAwakeMap: Map<string, Record<number, number>>,
    learnedManaNodes: Record<string, number[]>,
): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = []

    for (const [characterId, manaBoardAwake] of manaBoardAwakeMap) {
        const character = characters[characterId]
        if (!character) continue
        const visibleAwakeLevels = filterCharacterManaBoardAwakeLevels(
            Number(characterId),
            manaBoardAwake,
            learnedManaNodes[characterId] ?? [],
        )
        if (Object.keys(visibleAwakeLevels).length === 0) continue

        result.push({
            character_id: Number(characterId),
            // Every entry in a common-response character_list must carry
            // entry_count. The 1.8.1 client rejects otherwise-valid partial
            // Awake refresh entries with C2274 before it can apply the reward.
            entry_count: character.entryCount,
            exp: character.exp,
            join_time: clientSerializeDate(character.joinTime),
            update_time: clientSerializeDate(character.updateTime),
            mana_board_awake: visibleAwakeLevels,
        })
    }

    return result
}

export function isManaBoardComplete(
    characterId: number,
    boardIndex: number,
    learnedNodeIds: readonly number[],
): boolean {
    const boardNodes = getCharacterManaNodesSync(characterId, boardIndex)
    if (!boardNodes || Object.keys(boardNodes).length === 0) return false
    const learned = new Set(learnedNodeIds)
    return Object.keys(boardNodes).every(nodeId => learned.has(Number(nodeId)))
}

/**
 * `mana_board_awake` is also the client's target node level. Publishing it
 * before the base board is complete replaces normal nodes with awake nodes.
 */
export function filterCharacterManaBoardAwakeLevels(
    characterId: number,
    levels: Record<number, number>,
    learnedNodeIds: readonly number[],
): Record<number, number> {
    const filtered: Record<number, number> = {}
    for (const [boardIndexText, awakeLevel] of Object.entries(levels)) {
        const boardIndex = Number(boardIndexText)
        if (!Number.isSafeInteger(boardIndex) || boardIndex <= 0 || awakeLevel <= 0) continue
        if (!isManaBoardComplete(characterId, boardIndex, learnedNodeIds)) continue
        filtered[boardIndex] = awakeLevel
    }
    return filtered
}

export function validateManaBoardAwakeRequest(
    requestedNodeIds: unknown,
    targetAwakeLevel: unknown,
    unlockedAwakeLevel: number,
    boardNodeIds: readonly number[],
    learnedNodeIds: readonly number[]
): string | null {
    if (!Array.isArray(requestedNodeIds) || requestedNodeIds.length === 0
        || requestedNodeIds.some(nodeId => !Number.isInteger(nodeId))
        || new Set(requestedNodeIds).size !== requestedNodeIds.length) {
        return "Invalid mana node list."
    }
    if (unlockedAwakeLevel <= 0) return "Awake missions are not complete."
    if (!Number.isInteger(targetAwakeLevel) || targetAwakeLevel !== unlockedAwakeLevel) {
        return "Invalid awake level."
    }

    const learned = new Set(learnedNodeIds)
    if (boardNodeIds.some(nodeId => !learned.has(nodeId))) {
        return "Base mana board is not complete."
    }
    const board = new Set(boardNodeIds)
    if (requestedNodeIds.some(nodeId => !board.has(nodeId))) {
        return "Mana node is outside the awake board."
    }
    return null
}

// ─── Bond token + evolution ───

/**
 * Validates the client-controlled portion of an awake-node request without
 * reintroducing strict retail progression gates. The private-server build
 * accepts an existing node-awake level as legacy authorization, while still
 * rejecting malformed lists, nodes from another board, and arbitrary jumps.
 */
export function validateCompatibleManaBoardAwakeRequest(
    requestedNodeIds: unknown,
    targetAwakeLevel: unknown,
    expectedAwakeLevel: number,
    boardNodeIds: readonly number[]
): string | null {
    if (!Array.isArray(requestedNodeIds) || requestedNodeIds.length === 0
        || requestedNodeIds.some(nodeId => !Number.isInteger(nodeId))
        || new Set(requestedNodeIds).size !== requestedNodeIds.length) {
        return "Invalid mana node list."
    }
    if (!Number.isInteger(targetAwakeLevel) || targetAwakeLevel !== expectedAwakeLevel) {
        return "Invalid awake level."
    }

    const board = new Set(boardNodeIds)
    if (requestedNodeIds.some(nodeId => !board.has(nodeId))) {
        return "Mana node is outside the awake board."
    }
    return null
}

export interface BondTokenResult {
    characterEvolutionLevel: number
    evolutionData: Object
    bondTokenList: Object[]
}

/**
 * Checks board completion and handles bond token grant + first evolution.
 * Used by both /learn_mana_node and /awake_mana_node.
 *
 * @param boardIndex — the mana board index being processed (1 for awake, currentManaNodeIndex for learn)
 */
export function computeBondTokenAndEvolution(
    playerId: number,
    characterId: number,
    characterData: PlayerCharacter,
    boardIndex: number,
    isBoardComplete: boolean
): BondTokenResult {
    let characterEvolutionLevel = characterData.evolutionLevel
    let evolutionData: Object = []
    const bondTokenList: Object[] = []

    const boardCount = getCharacterManaBoardCountSync(characterId)
    const tokenByBoard = new Map(
        characterData.bondTokenList.map(token => [token.manaBoardIndex, token]),
    )
    for (let index = 1; index <= boardCount; index++) {
        if (tokenByBoard.has(index)) continue
        const token = { manaBoardIndex: index, status: 0 }
        insertPlayerCharacterBondTokenSync(playerId, characterId, token)
        tokenByBoard.set(index, token)
        characterData.bondTokenList.push(token)
    }
    characterData.bondTokenList.sort((left, right) => left.manaBoardIndex - right.manaBoardIndex)

    if (tokenByBoard.get(boardIndex)?.status === 0 && isBoardComplete) {
        updatePlayerCharacterBondTokenSync(playerId, characterId, { manaBoardIndex: boardIndex, status: 1 })
        for (const entry of characterData.bondTokenList) {
            bondTokenList.push({
                "mana_board_index": entry.manaBoardIndex,
                "status": entry.manaBoardIndex === boardIndex ? 1 : entry.status,
            })
        }
        if (characterEvolutionLevel === 0) {
            characterEvolutionLevel = 1
            updatePlayerCharacterSync(playerId, characterId, { evolutionLevel: characterEvolutionLevel })
            evolutionData = { "character_id": characterId, "level": 1, "img_level": 1 }
        }
    }

    return { characterEvolutionLevel, evolutionData, bondTokenList }
}

export interface ManaBoardCompletionRepair {
    repairedCharacterIds: number[]
    evolutionCharacterIds: number[]
}

/**
 * Repairs old/imported saves that have complete mana boards but are missing
 * their receivable bond-token row or first-board evolution marker.
 */
export function reconcilePlayerManaBoardCompletionSync(
    playerId: number,
    candidateCharacterIds?: readonly number[],
): ManaBoardCompletionRepair {
    const characters = getPlayerCharactersSync(playerId)
    const learnedNodes = getPlayerCharactersManaNodesSync(playerId)
    const candidates = candidateCharacterIds ? new Set(candidateCharacterIds.map(String)) : null
    const repairedCharacterIds = new Set<number>()
    const evolutionCharacterIds = new Set<number>()

    getDb().transaction(() => {
        for (const [characterIdText, character] of Object.entries(characters)) {
            if (candidates && !candidates.has(characterIdText)) continue
            const characterId = Number(characterIdText)
            const boardCount = getCharacterManaBoardCountSync(characterId)
            if (boardCount <= 0) continue

            const tokenByBoard = new Map(
                character.bondTokenList.map(token => [token.manaBoardIndex, token]),
            )
            for (let boardIndex = 1; boardIndex <= boardCount; boardIndex++) {
                let token = tokenByBoard.get(boardIndex)
                if (!token) {
                    token = { manaBoardIndex: boardIndex, status: 0 }
                    insertPlayerCharacterBondTokenSync(playerId, characterId, token)
                    tokenByBoard.set(boardIndex, token)
                    repairedCharacterIds.add(characterId)
                }
                if (
                    token.status === 0
                    && isManaBoardComplete(
                        characterId,
                        boardIndex,
                        learnedNodes[characterIdText] ?? [],
                    )
                ) {
                    updatePlayerCharacterBondTokenSync(
                        playerId,
                        characterId,
                        { manaBoardIndex: boardIndex, status: 1 },
                    )
                    token.status = 1
                    repairedCharacterIds.add(characterId)
                    if (boardIndex === 1 && character.evolutionLevel === 0) {
                        updatePlayerCharacterSync(playerId, characterId, { evolutionLevel: 1 })
                        character.evolutionLevel = 1
                        evolutionCharacterIds.add(characterId)
                    }
                }
            }
        }
    })()

    return {
        repairedCharacterIds: [...repairedCharacterIds],
        evolutionCharacterIds: [...evolutionCharacterIds],
    }
}

/** Sends a standard-format mana-related response. */
export function sendCharacterResponse(
    reply: FastifyReply,
    viewerId: number,
    data: CharacterResponseData,
    playerId?: number,
) {
    if (playerId !== undefined) {
        const changedCharacterIds = (data.character_list ?? [])
            .map(character => Number((character as Record<string, unknown>)?.character_id))
            .filter(characterId => Number.isFinite(characterId) && characterId > 0)
        settleDegreeMissionResponse(
            playerId,
            viewerId,
            data,
            undefined,
            [7, 8, 44, 48],
            changedCharacterIds,
        )
    }
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        "data_headers": generateDataHeaders({ viewer_id: viewerId }),
        "data": data,
    })
}

// ─── Mana board awake level computation ───

/** Computes persisted mana-board awake levels from node state. */
export function computeManaBoardAwakeFromNodes(
    characterManaNodeAwakeLevels: Record<string, Record<number, number>>
): Map<string, Record<number, number>> {
    const result = new Map<string, Record<number, number>>()
    for (const [charId, nodeLevels] of Object.entries(characterManaNodeAwakeLevels)) {
        const boardNodes = getCharacterManaNodesSync(Number(charId), 1)
        if (!boardNodes) continue
        const boardNodeIds = Object.keys(boardNodes).map(Number)
        if (boardNodeIds.length === 0) continue
        let completedAwakeLevel = Number.POSITIVE_INFINITY
        for (const nodeId of boardNodeIds) {
            completedAwakeLevel = Math.min(completedAwakeLevel, nodeLevels[nodeId] ?? 0)
        }
        if (Number.isFinite(completedAwakeLevel) && completedAwakeLevel > 0) {
            result.set(charId, { 1: completedAwakeLevel })
        }
    }
    return result
}
