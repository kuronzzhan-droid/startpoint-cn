import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { playerOwnsCharacterSync } from "../../data/domains/character"
import { playerOwnsEquipmentSync } from "../../data/domains/equipment"
import { updatePlayerPartySync } from "../../data/domains/party"
import { getDb } from "../../data/db"
import { incrementActiveMissionPartyActionCountsSync } from "../../data/domains/active_mission_counters"
import { generateDataHeaders } from "../../utils";
import { PartyCategory } from "../../data/types";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { hasValidPartyCategory, parseGlobalPartyId } from "../../lib/special-event-parties";
import { getPublishedPartySync, publishPartySync } from "../../data/domains/publishedParty";
import { gameVerboseLog } from "../../lib/game-logging";
import { PROFILE_FAVORITE_PARTY_CATEGORY } from "../../lib/profileFavorite";

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

function hasEditablePartyCategory(
    value: unknown,
): value is { party_category: PartyCategory } {
    if (value !== null
        && typeof value === "object"
        && "party_category" in value
        && (value as { party_category: unknown }).party_category
            === PROFILE_FAVORITE_PARTY_CATEGORY) {
        return true
    }
    return hasValidPartyCategory(value)
}

/*
{
    "api_count": 2,
    "party_name": "Party G",
    "battle_party": {
        "equipments": [
            {
                "equipment_id": 5040028,
                "level": 5
            },
            {
                "equipment_id": 5090023,
                "level": 5
            },
            {
                "equipment_id": 5040029,
                "level": 5
            }
        ],
        "ability_soul_ids": [
            5010058,
            5040029,
            5040029
        ],
        "unison_characters": [
            {
                "id": 241045,
                "ex_boost": {
                    "status_id": 5,
                    "ability_id_list": [
                        15,
                        39
                    ]
                },
                "over_limit_step": 6,
                "mana_node_ids": [
                    482090201,
                    482090202,
                    482090203,
                    482090204,
                    482090205,
                    482090206,
                    482090207,
                    482090208,
                    482090209,
                    482090210,
                    482090211,
                    482090212,
                    482090213,
                    482090214,
                    482090215,
                    482090216,
                    482090217,
                    482090218,
                    482090219,
                    482090220,
                    482090221,
                    482090222,
                    482090223,
                    482090401,
                    482090402,
                    482090403,
                    482090404,
                    482090405,
                    482090406,
                    482090407,
                    482090408,
                    482090409,
                    482090410,
                    482090411,
                    482090412,
                    482090413,
                    482090414,
                    482090415,
                    482090416,
                    482090417,
                    482090418
                ],
                "illustration_settings": null,
                "evolution_level": 1,
                "exp": 342410
            },
            {
                "id": 141063,
                "ex_boost": {
                    "status_id": 3,
                    "ability_id_list": [
                        7,
                        35
                    ]
                },
                "over_limit_step": 4,
                "mana_node_ids": [
                    282126201,
                    282126202,
                    282126203,
                    282126204,
                    282126205,
                    282126206,
                    282126207,
                    282126208,
                    282126209,
                    282126210,
                    282126211,
                    282126212,
                    282126213,
                    282126214,
                    282126215,
                    282126216,
                    282126217,
                    282126218,
                    282126219,
                    282126220,
                    282126221,
                    282126222,
                    282126223,
                    282126401,
                    282126402,
                    282126403,
                    282126404,
                    282126405,
                    282126406,
                    282126407,
                    282126408,
                    282126409,
                    282126410,
                    282126411,
                    282126412,
                    282126413,
                    282126414,
                    282126415,
                    282126416,
                    282126417,
                    282126418
                ],
                "illustration_settings": null,
                "evolution_level": 1,
                "exp": 379988
            },
            {
                "id": 341009,
                "ex_boost": {
                    "status_id": 3,
                    "ability_id_list": [
                        19,
                        52
                    ]
                },
                "over_limit_step": 8,
                "mana_node_ids": [
                    682018201,
                    682018202,
                    682018203,
                    682018204,
                    682018205,
                    682018206,
                    682018207,
                    682018208,
                    682018209,
                    682018210,
                    682018211,
                    682018212,
                    682018213,
                    682018214,
                    682018215,
                    682018216,
                    682018217,
                    682018218,
                    682018219,
                    682018220,
                    682018221,
                    682018222,
                    682018223,
                    682018401
                ],
                "illustration_settings": null,
                "evolution_level": 1,
                "exp": 308043
            }
        ],
        "characters": [
            {
                "id": 241069,
                "ex_boost": {
                    "status_id": 3,
                    "ability_id_list": [
                        9,
                        38
                    ]
                },
                "over_limit_step": 6,
                "mana_node_ids": [
                    482138201,
                    482138202,
                    482138203,
                    482138204,
                    482138205,
                    482138206,
                    482138207,
                    482138208,
                    482138209,
                    482138210,
                    482138211,
                    482138212,
                    482138213,
                    482138214,
                    482138215,
                    482138216,
                    482138217,
                    482138218,
                    482138219,
                    482138220,
                    482138221,
                    482138222,
                    482138223,
                    482138401,
                    482138402,
                    482138403,
                    482138404,
                    482138405,
                    482138406,
                    482138407,
                    482138408,
                    482138409,
                    482138410,
                    482138411,
                    482138412,
                    482138413,
                    482138414,
                    482138415,
                    482138416,
                    482138417,
                    482138418
                ],
                "illustration_settings": null,
                "evolution_level": 1,
                "exp": 342410
            },
            {
                "id": 141045,
                "ex_boost": {
                    "status_id": 3,
                    "ability_id_list": [
                        8,
                        41
                    ]
                },
                "over_limit_step": 4,
                "mana_node_ids": [
                    282090201,
                    282090202,
                    282090203,
                    282090204,
                    282090205,
                    282090206,
                    282090207,
                    282090208,
                    282090209,
                    282090210,
                    282090211,
                    282090212,
                    282090213,
                    282090214,
                    282090215,
                    282090216,
                    282090217,
                    282090218,
                    282090219,
                    282090220,
                    282090221,
                    282090222,
                    282090223,
                    282090401,
                    282090402,
                    282090403,
                    282090404,
                    282090405,
                    282090406,
                    282090407,
                    282090408,
                    282090409,
                    282090410,
                    282090411,
                    282090412,
                    282090413,
                    282090414,
                    282090415,
                    282090416,
                    282090417,
                    282090418
                ],
                "illustration_settings": null,
                "evolution_level": 1,
                "exp": 379988
            },
            {
                "id": 141141,
                "ex_boost": null,
                "over_limit_step": 4,
                "mana_node_ids": [
                    282282201,
                    282282202,
                    282282203,
                    282282204,
                    282282205,
                    282282206,
                    282282207,
                    282282208,
                    282282209,
                    282282210,
                    282282211,
                    282282212,
                    282282213,
                    282282214,
                    282282215,
                    282282216,
                    282282217,
                    282282218,
                    282282219,
                    282282220,
                    282282221,
                    282282222,
                    282282223
                ],
                "illustration_settings": null,
                "evolution_level": 1,
                "exp": 379988
            }
        ]
    },
    "viewer_id": 276818168
}
*/
interface PublishBody {
    party_name: string,
    battle_party: unknown,
    viewer_id: number
}

interface ReferBody {
    party_code: string,
    viewer_id: number
}

interface PublishedCharacter {
    id: number
    mana_node_ids: number[] | null
    evolution_level: number
    exp: number
    over_limit_step: number
    illustration_settings: number[] | null
    ex_boost: {
        ability_id_list: number[]
        status_id: number
    } | null
}

interface PublishedEquipment {
    equipment_id: number
    level: number
}

interface PublishedBattleParty {
    characters: (PublishedCharacter | null)[]
    unison_characters: (PublishedCharacter | null)[]
    equipments: (PublishedEquipment | null)[]
    ability_soul_ids: (number | null)[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const asInteger = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) ? value : null

function sanitizeIntegerArray(value: unknown, maxLength: number): number[] | null {
    if (!Array.isArray(value) || value.length > maxLength) return null
    const result: number[] = []
    for (const entry of value) {
        const integer = asInteger(entry)
        if (integer === null) return null
        result.push(integer)
    }
    return result
}

function sanitizeCharacter(value: unknown): PublishedCharacter | null | undefined {
    if (value === null) return null
    if (!isObject(value)) return undefined

    const id = asInteger(value.id)
    const evolutionLevel = asInteger(value.evolution_level)
    const exp = asInteger(value.exp)
    const overLimitStep = asInteger(value.over_limit_step)
    if (id === null || evolutionLevel === null || exp === null || overLimitStep === null) return undefined

    let manaNodeIds: number[] | null = null
    if (value.mana_node_ids !== null && value.mana_node_ids !== undefined) {
        manaNodeIds = sanitizeIntegerArray(value.mana_node_ids, 256)
        if (manaNodeIds === null) return undefined
    }

    let illustrationSettings: number[] | null = null
    if (value.illustration_settings !== null && value.illustration_settings !== undefined) {
        illustrationSettings = sanitizeIntegerArray(value.illustration_settings, 32)
        if (illustrationSettings === null) return undefined
    }

    let exBoost: PublishedCharacter["ex_boost"] = null
    if (value.ex_boost !== null && value.ex_boost !== undefined) {
        if (!isObject(value.ex_boost)) return undefined
        const statusId = asInteger(value.ex_boost.status_id)
        const abilityIdList = sanitizeIntegerArray(value.ex_boost.ability_id_list, 32)
        if (statusId === null || abilityIdList === null) return undefined
        exBoost = { status_id: statusId, ability_id_list: abilityIdList }
    }

    return {
        id,
        mana_node_ids: manaNodeIds,
        evolution_level: evolutionLevel,
        exp,
        over_limit_step: overLimitStep,
        illustration_settings: illustrationSettings,
        ex_boost: exBoost,
    }
}

function sanitizeCharacterArray(value: unknown): (PublishedCharacter | null)[] | null {
    if (!Array.isArray(value) || value.length !== 3) return null
    const result: (PublishedCharacter | null)[] = []
    for (const entry of value) {
        const character = sanitizeCharacter(entry)
        if (character === undefined) return null
        result.push(character)
    }
    return result
}

function sanitizeEquipmentArray(value: unknown): (PublishedEquipment | null)[] | null {
    if (!Array.isArray(value) || value.length !== 3) return null
    const result: (PublishedEquipment | null)[] = []
    for (const entry of value) {
        if (entry === null) {
            result.push(null)
            continue
        }
        if (!isObject(entry)) return null
        const equipmentId = asInteger(entry.equipment_id)
        const level = asInteger(entry.level)
        if (equipmentId === null || level === null) return null
        result.push({ equipment_id: equipmentId, level })
    }
    return result
}

function sanitizeAbilitySoulArray(value: unknown): (number | null)[] | null {
    if (!Array.isArray(value) || value.length !== 3) return null
    const result: (number | null)[] = []
    for (const entry of value) {
        if (entry === null) {
            result.push(null)
            continue
        }
        const id = asInteger(entry)
        if (id === null) return null
        result.push(id)
    }
    return result
}

function sanitizeBattleParty(value: unknown): PublishedBattleParty | null {
    if (!isObject(value)) return null
    const characters = sanitizeCharacterArray(value.characters)
    const unisonCharacters = sanitizeCharacterArray(value.unison_characters)
    const equipments = sanitizeEquipmentArray(value.equipments)
    const abilitySoulIds = sanitizeAbilitySoulArray(value.ability_soul_ids)
    if (!characters || !unisonCharacters || !equipments || !abilitySoulIds) return null
    return {
        characters,
        unison_characters: unisonCharacters,
        equipments,
        ability_soul_ids: abilitySoulIds,
    }
}

async function resolvePartyPlayer(body: { viewer_id?: unknown }) {
    const viewerId = Number(body?.viewer_id)
    if (!Number.isFinite(viewerId)) return null
    const session = await getSession(String(viewerId))
    if (!session) return null
    const playerId = resolvePlayerIdSync(session.accountId)
    return playerId === null ? null : { viewerId, playerId }
}

function sendPartyResponse(reply: FastifyReply, viewerId: number, data: unknown, resultCode = 1) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({
        data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: resultCode }),
        data,
    })
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/publish", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PublishBody
        const context = await resolvePartyPlayer(body)
        if (!context) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })
        if (typeof body.party_name !== "string" || body.party_name.length > 100) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid party name." })
        }
        const battleParty = sanitizeBattleParty(body.battle_party)
        if (!battleParty || JSON.stringify(battleParty).length > 65536) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid battle party." })
        }

        const partyCode = publishPartySync(context.playerId, body.party_name, battleParty)
        console.log(`[PARTY CODE] publish player=${context.playerId} code=${partyCode}`)
        return sendPartyResponse(reply, context.viewerId, { party_code: partyCode })
    })

    fastify.post("/refer", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReferBody
        const context = await resolvePartyPlayer(body)
        if (!context) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })

        const partyCode = typeof body.party_code === "string" ? body.party_code.trim().toUpperCase() : ""
        if (!/^[2-9A-HJ-NP-Z]{10}$/.test(partyCode)) {
            return sendPartyResponse(reply, context.viewerId, {}, 3404)
        }

        const publishedParty = getPublishedPartySync(partyCode)
        if (!publishedParty) return sendPartyResponse(reply, context.viewerId, {}, 3404)
        if (publishedParty.schemaVersion !== 1) return sendPartyResponse(reply, context.viewerId, {}, 3403)

        const battleParty = sanitizeBattleParty(publishedParty.battleParty)
        if (!battleParty) return sendPartyResponse(reply, context.viewerId, {}, 3403)

        console.log(`[PARTY CODE] refer player=${context.playerId} code=${partyCode}`)
        return sendPartyResponse(reply, context.viewerId, {
            party_name: publishedParty.partyName,
            battle_party: battleParty,
        })
    })

    fastify.post("/edit", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as EditBody

        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        })
        if (!Array.isArray(body.party_info_list)
            || body.party_info_list.some(info => !hasEditablePartyCategory(info)
                || parseGlobalPartyId(info.party_id) === null)) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid party category or party ID."
            })
        }

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

        // update each slot
        const characterOwnedMap: Record<number, boolean> = {}
        const equipmentOwnedMap: Record<number, boolean> = {}
        const editCategories: number[] = []
        for (const updateInfo of body.party_info_list) {
            editCategories.push(updateInfo.party_category)
        }
        gameVerboseLog(() => `[PARTY] edit: viewer=${viewerId} parties=${body.party_info_list.length} categories=${JSON.stringify(editCategories)} mainPartyId=${body.main_party_id}`)

        const mapOwnedCharacters = (characterId: number | null): number | null => {
            let isOwned = characterId === null ? false : characterOwnedMap[characterId]
            if (isOwned === undefined) {
                isOwned = playerOwnsCharacterSync(playerId, characterId as number)
                characterOwnedMap[characterId as number] = isOwned
            }
            
            return isOwned ? characterId : null
        }

        const mapOwnedEquipment = (equipmentId: number | null): number | null => {
            let isOwned = equipmentId === null ? false : equipmentOwnedMap[equipmentId]
            if (isOwned === undefined) {
                isOwned = playerOwnsEquipmentSync(playerId, equipmentId as number)
                equipmentOwnedMap[equipmentId as number] = isOwned
            }
            
            return isOwned ? equipmentId : null
        }

        const mappedParties = body.party_info_list.map(updateInfo => {
            const parsed = parseGlobalPartyId(updateInfo.party_id)!
            gameVerboseLog(() => `[PARTY] edit: player=${playerId} id=${updateInfo.party_id} -> group=${parsed.groupId} slot=${parsed.slot} name="${updateInfo.party_name}" chars=${updateInfo.character_ids?.filter(Boolean).length || 0}`)
            return {
                parsed,
                party: {
                    name: updateInfo.party_name,
                    unisonCharacterIds: updateInfo.unison_character_ids.map(mapOwnedCharacters),
                    characterIds: updateInfo.character_ids.map(mapOwnedCharacters),
                    equipmentIds: updateInfo.equipment_ids.map(mapOwnedEquipment), // TODO: Implement stack checking, to see if more equipment is being equipped than is owned.
                    abilitySoulIds: updateInfo.ability_soul_ids,
                    options: { allowOtherPlayersToHealMe: updateInfo.options.allow_other_players_to_heal_me },
                    edited: updateInfo.party_edited,
                    category: updateInfo.party_category as PartyCategory,
                    currentBattlePower: updateInfo.current_battle_power ?? 0,
                    beforeBattlePower: updateInfo.before_battle_power ?? 0,
                },
            }
        })

        getDb().transaction(() => {
            const battleParties = mappedParties.filter(
                ({ party }) => party.category !== PROFILE_FAVORITE_PARTY_CATEGORY,
            )
            // store full global PartyId so /load returns the correct group+slot combo
            // Editing profile favorites is independent from the battle SET selected
            // by the player. Empty edits are still used by the client to switch SETs.
            if ((mappedParties.length === 0 || battleParties.length > 0)
                && player.partySlot !== body.main_party_id) {
                updatePlayerSync({
                    id: playerId,
                    partySlot: body.main_party_id,
                })
            }
            for (const { parsed, party } of mappedParties) {
                updatePlayerPartySync(playerId, parsed.slot, party, parsed.groupId)
            }
            if (battleParties.length > 0) {
                incrementActiveMissionPartyActionCountsSync(playerId, {
                    equipmentEquipCount: battleParties.some(({ party }) => party.equipmentIds.some(id => id !== null)) ? 1 : 0,
                    unisonSetCount: battleParties.some(({ party }) => party.unisonCharacterIds.some(id => id !== null)) ? 1 : 0,
                    partyCharacterSetCount: battleParties.some(({ party }) => party.characterIds.some(id => id !== null)) ? 1 : 0,
                })
            }
        })()

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
