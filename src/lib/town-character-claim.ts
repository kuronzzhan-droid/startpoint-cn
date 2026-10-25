import type { FastifyReply, FastifyRequest } from "fastify"
import { getContentSnapshot } from "../content/runtime/content-snapshot"
import { resolvePlayerIdSync } from "../data/activeAccount"
import { getPlayerCharacterSync } from "../data/domains/character"
import { getPlayerSingleQuestProgressSync } from "../data/domains/quest"
import { getSession } from "../data/domains/session"
import { clientSerializeDate } from "../data/utils"
import { generateDataHeaders } from "../utils"
import { givePlayerCharacterSync } from "./character"
import { readGameplayMutationRequestSync, recordGameplayMutationResponseSync } from "./gameplay-mutation-receipt"
import { reconcileAwakeUnlockCharacterList, settleDegreeMissionResponse } from "./mission"
import { runPersistenceTransaction } from "./persistence-coordinator"
import { QuestCategory } from "./types"

/** getTownCharacterId also offers missing quest-join characters on old saves.
 * Ownership and cleared quest progress are portable entitlement facts; neither
 * a login counter nor the absence of a server-local receipt establishes one. */
function isTownCharacterUnlocked(playerId: number, characterId: number): boolean {
    const table = getContentSnapshot().repository.table<Record<string, string[][]>>("story_join_character.json")
    const rows = table[String(characterId)]
    if (!rows) return false
    if (rows.length !== 1 || !Array.isArray(rows[0]) || rows[0].length !== 8) {
        throw new Error(`Invalid story join row for character ${characterId}.`)
    }
    const [referenceKind, chapter, section, episode, encodedQuestId, , joinType, temporary] = rows[0]
    if (referenceKind !== "0" || temporary !== "false" || !["town", "quest"].includes(joinType)) {
        throw new Error(`Unsupported town story join for character ${characterId}.`)
    }
    const components = [chapter, section, episode, encodedQuestId].map(Number)
    if (components.some(value => !Number.isSafeInteger(value) || value < 0)
        || components[0] * 1_000_000 + components[1] * 1_000 + components[2] !== components[3]) {
        throw new Error(`Invalid town story join quest identity for character ${characterId}.`)
    }
    return getPlayerSingleQuestProgressSync(playerId, QuestCategory.MAIN, components[3])?.finished === true
}

export async function handleTownCharacterClaim(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = request.body as { character_id?: number; viewer_id?: number; api_count?: number } | undefined
    const viewerId = body?.viewer_id, characterId = body?.character_id
    if (!Number.isSafeInteger(viewerId) || Number(viewerId) <= 0
        || !Number.isSafeInteger(characterId) || Number(characterId) <= 0) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
    }
    const session = await getSession(String(viewerId))
    if (!session) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })
    const playerId = resolvePlayerIdSync(session.accountId)
    if (playerId === null) return reply.status(500).send({ error: "Internal Server Error", message: "No player bound to account." })
    const result = await runPersistenceTransaction({ domain: "player", playerId, operation: "character_add_from_town" }, () => {
        const mutation = readGameplayMutationRequestSync(playerId,
            { headerToken: request.headers.login_token, body: body!, accountId: session.accountId },
            "character.add_from_town", { characterId })
        if (!mutation) return { ok: false as const, message: "Town request identity is invalid or superseded." }
        if (mutation.response) return { ok: true as const, data: mutation.response }
        if (!isTownCharacterUnlocked(playerId, characterId!)) {
            return { ok: false as const, message: "Character is not eligible to join from town." }
        }

        const existing = getPlayerCharacterSync(playerId, characterId!)
        const granted = existing ? null : givePlayerCharacterSync(playerId, characterId!)
        if (!existing && !granted?.character) throw new Error(`Town character ${characterId} is missing from content.`)
        const character = existing ? {
            character_id: characterId, entry_count: existing.entryCount, stack: existing.stack,
            create_time: clientSerializeDate(existing.joinTime), join_time: clientSerializeDate(existing.joinTime),
            update_time: clientSerializeDate(existing.updateTime),
        } : granted!.character as Record<string, unknown>
        const data: Record<string, any> = {
            character_list: reconcileAwakeUnlockCharacterList(playerId, [character]),
            item_list: {}, mail_arrived: false,
        }
        if (!existing) settleDegreeMissionResponse(playerId, viewerId!, data, undefined, [4])
        recordGameplayMutationResponseSync(playerId, mutation, data)
        return { ok: true as const, data }
    })
    if (!result.ok) return reply.status(400).send({ error: "Bad Request", message: result.message })
    return reply.header("content-type", "application/x-msgpack").status(200).send({
        data_headers: generateDataHeaders({ viewer_id: viewerId }), data: result.data,
    })
}
