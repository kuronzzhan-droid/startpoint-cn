import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { resolvePlayerIdSync } from "../../data/activeAccount"
import { getPlayerCharactersSync } from "../../data/domains/character"
import { hasPlayerDegreeSync } from "../../data/domains/degree"
import {
    getPlayerHistorySettingsSync,
    PlayerHistorySettings,
    PlayerHistorySettingsUpdate,
    updatePlayerHistorySettingsSync,
} from "../../data/domains/player-history"
import { getAccountFromPlayerIdSync, getPlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import {
    createEmptyPlayerHistoryTopicValues,
    getPlayerHistoryCatalog,
    PlayerHistoryCatalog,
} from "../../lib/player-history-catalog"
import {
    buildPlayerHistoryTopicAggregatesSync,
    formatPlayerHistoryJstDate,
    PlayerHistoryTopicAggregates,
} from "../../lib/player-history-aggregates"
import { getFavoritePartySelectionSync } from "../../lib/profileFavorite"
import { generateDataHeaders, getServerTimeForPlayer } from "../../utils"
import { getServerDate, getTimeOffset } from "../../utils"
import { runPersistenceTransaction } from "../../lib/persistence-coordinator"

interface RequestBody {
    viewer_id?: unknown
    party_info?: unknown
    degree_id?: unknown
    background_card_id?: unknown
    player_history_topic_visible?: unknown
}

function isPositiveInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0
}

async function resolvePlayer(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as RequestBody
    if (!isPositiveInteger(body?.viewer_id)) {
        reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        return null
    }

    const session = await getSession(String(body.viewer_id))
    if (!session) {
        reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })
        return null
    }

    const playerId = resolvePlayerIdSync(session.accountId)
    const player = playerId === null ? null : getPlayerSync(playerId)
    if (playerId === null || !player) {
        reply.status(400).send({ error: "Bad Request", message: "Player not found." })
        return null
    }

    return { viewerId: body.viewer_id, playerId, player }
}

function sendResultCode(reply: FastifyReply, viewerId: number, resultCode: number) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: resultCode }),
        data: {},
    })
}

function getDefaults(
    playerId: number,
    player: { leaderCharacterId: number; degreeId: number },
    catalog: PlayerHistoryCatalog,
): PlayerHistorySettings {
    const favorite = getFavoritePartySelectionSync(playerId, player.leaderCharacterId)
    return {
        playerHistoryId: catalog.playerHistoryId,
        backgroundCardId: catalog.defaultBackgroundId,
        degreeId: player.degreeId || 1,
        characterIds: favorite.characterIds,
        unisonCharacterIds: favorite.unisonCharacterIds,
        topicVisibility: {},
    }
}

function parseCharacterIds(value: unknown): Array<number | null> | null {
    if (!Array.isArray(value) || value.length !== 3) return null
    if (!value.every(id => id === null || isPositiveInteger(id))) return null
    return value as Array<number | null>
}

function parseTopicVisibility(value: unknown): Record<string, boolean> | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null
    const entries = Object.entries(value)
    if (!entries.every(([key, visible]) => /^[1-9]\d*$/.test(key) && typeof visible === "boolean")) {
        return null
    }
    return Object.fromEntries(entries) as Record<string, boolean>
}

function serializeTopics(
    catalog: PlayerHistoryCatalog,
    topicVisibility: Record<string, boolean>,
    aggregates: PlayerHistoryTopicAggregates,
) {
    return Object.fromEntries(catalog.topics.map(topic => [
        String(topic.index),
        {
            is_visible: topicVisibility[String(topic.index)] ?? topic.toggleDefault,
            value_list: {
                ...createEmptyPlayerHistoryTopicValues(topic.aggregationTarget),
                ...(aggregates[topic.aggregationTarget] ?? {}),
            },
        },
    ]))
}

function getStartGameDate(playerId: number, offsetMs: number): string {
    const account = getAccountFromPlayerIdSync(playerId)
    if (!account) return "2025-07-17 12:00:00"
    return formatPlayerHistoryJstDate(account.firstLoginTime, offsetMs)
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/index", async (request: FastifyRequest, reply: FastifyReply) => {
        const resolved = await resolvePlayer(request, reply)
        if (!resolved) return reply

        const catalog = getPlayerHistoryCatalog(getServerTimeForPlayer(resolved.playerId) * 1000)
        if (!catalog) return sendResultCode(reply, resolved.viewerId, 11101)

        const defaults = getDefaults(resolved.playerId, resolved.player, catalog)
        const settings = getPlayerHistorySettingsSync(resolved.playerId, defaults)
        const backgroundCardId = catalog.backgroundIds.has(settings.backgroundCardId)
            ? settings.backgroundCardId
            : catalog.defaultBackgroundId
        const degreeId = hasPlayerDegreeSync(resolved.playerId, settings.degreeId)
            ? settings.degreeId
            : defaults.degreeId
        const offsetMs = getTimeOffset() ?? 0
        const aggregates = buildPlayerHistoryTopicAggregatesSync(
            resolved.playerId,
            resolved.player,
            getStartGameDate(resolved.playerId, offsetMs),
            formatPlayerHistoryJstDate(getServerDate(), 0),
            offsetMs,
        )

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: resolved.viewerId }),
            data: {
                player_history_id: catalog.playerHistoryId,
                background_card_id: backgroundCardId,
                degree_id: degreeId,
                favorite_character: {
                    character_ids: settings.characterIds,
                    unison_character_ids: settings.unisonCharacterIds,
                },
                player_history_topic_list: serializeTopics(
                    catalog,
                    settings.topicVisibility,
                    aggregates,
                ),
            },
        })
    })

    fastify.post("/edit", async (request: FastifyRequest, reply: FastifyReply) => {
        const resolved = await resolvePlayer(request, reply)
        if (!resolved) return reply

        const catalog = getPlayerHistoryCatalog(getServerTimeForPlayer(resolved.playerId) * 1000)
        if (!catalog) return sendResultCode(reply, resolved.viewerId, 11101)

        const body = request.body as RequestBody
        const fields = [
            body.party_info,
            body.degree_id,
            body.background_card_id,
            body.player_history_topic_visible,
        ].filter(value => value !== undefined && value !== null)
        if (fields.length !== 1) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Exactly one history setting is required.",
            })
        }

        const update: PlayerHistorySettingsUpdate = {}
        if (body.party_info !== undefined && body.party_info !== null) {
            if (typeof body.party_info !== "object" || Array.isArray(body.party_info)) {
                return reply.status(400).send({ error: "Bad Request", message: "Invalid party info." })
            }
            const party = body.party_info as Record<string, unknown>
            const characterIds = parseCharacterIds(party.character_ids)
            const unisonCharacterIds = parseCharacterIds(party.unison_character_ids)
            if (!characterIds || !unisonCharacterIds) {
                return reply.status(400).send({ error: "Bad Request", message: "Invalid party info." })
            }
            const owned = new Set(Object.keys(getPlayerCharactersSync(resolved.playerId)).map(Number))
            if (![...characterIds, ...unisonCharacterIds].every(id => id === null || owned.has(id))) {
                return reply.status(400).send({
                    error: "Bad Request",
                    message: "Favorite character is not owned.",
                })
            }
            update.characterIds = characterIds
            update.unisonCharacterIds = unisonCharacterIds
        } else if (body.degree_id !== undefined && body.degree_id !== null) {
            if (!isPositiveInteger(body.degree_id)
                || !hasPlayerDegreeSync(resolved.playerId, body.degree_id)) {
                return reply.status(400).send({ error: "Bad Request", message: "Degree is not owned." })
            }
            update.degreeId = body.degree_id
        } else if (body.background_card_id !== undefined && body.background_card_id !== null) {
            if (!isPositiveInteger(body.background_card_id)
                || !catalog.backgroundIds.has(body.background_card_id)) {
                return reply.status(400).send({
                    error: "Bad Request",
                    message: "Invalid background card id.",
                })
            }
            update.backgroundCardId = body.background_card_id
        } else {
            const visibility = parseTopicVisibility(body.player_history_topic_visible)
            const topicIndexes = new Set(catalog.topics.map(topic => String(topic.index)))
            if (!visibility || Object.keys(visibility).some(index => !topicIndexes.has(index))) {
                return reply.status(400).send({
                    error: "Bad Request",
                    message: "Invalid topic visibility.",
                })
            }
            update.topicVisibility = visibility
        }

        await runPersistenceTransaction({
            domain: "player", playerId: resolved.playerId, operation: "player_history_edit",
        }, () => updatePlayerHistorySettingsSync(
            resolved.playerId,
            getDefaults(resolved.playerId, resolved.player, catalog),
            update,
        ))
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: resolved.viewerId }),
            data: {},
        })
    })
}

export default routes
