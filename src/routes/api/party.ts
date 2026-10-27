import { recordContentActionFactsSync } from "../../lib/mission/content-action-facts";
import { stripWeaponRivenPublicPayload } from "../../lib/weapon-riven/public-payload"
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { getPlayerCharacterManaNodesSync, getPlayerCharactersSync, playerOwnsCharacterSync } from "../../data/domains/character"
import { getPlayerEquipmentListSync, playerOwnsEquipmentSync } from "../../data/domains/equipment"
import { getPlayerItemsSync } from "../../data/domains/item"
import { findValidNormalPartySlotSync, updatePlayerPartySync } from "../../data/domains/party"
import { getDb } from "../../data/db"
import { incrementActiveMissionPartyActionCountsSync } from "../../data/domains/active_mission_counters"
import { generateDataHeaders } from "../../utils";
import { PartyCategory } from "../../data/types";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { hasValidPartyCategory, parseGlobalPartyId } from "../../lib/special-event-parties";
import { getPublishedPartySync, publishPartySync } from "../../data/domains/publishedParty";
import { gameVerboseLog } from "../../lib/game-logging";
import { PROFILE_FAVORITE_PARTY_CATEGORY } from "../../lib/profileFavorite";
import { addMissionCounterSync } from "../../lib/mission/counters";
import { settleDegreeMissionResponse } from "../../lib/mission/degree-response";
import { countNewAbilitySoulEquipments } from "../../lib/mission/ability-soul-facts";
import { runPersistenceTransaction } from "../../lib/persistence-coordinator";
import { invalidateRealPartySnapshot } from "../../multi/party-snapshot";
import { getRoomCommandGateway } from "../../multi/coordinator/default-runtime";
import { createTeamCodeClient, GAME_CODE_PATTERN, TeamCodeError, TeamCodeLimiter } from "../../lib/wiki-team-code-client";
import { loadTeamCodeAssets, nativeBattleParty, resolvePublicTeam, TeamAssets, TeamInventory } from "../../lib/wiki-team-code-inventory";
import { hasWeaponRivenCapability } from "../../lib/client-admission";
import { protectWeaponRivenPartySave, projectWeaponRivenClientResponse } from "../../lib/weapon-riven/client";
import { getPlayerWeaponRivenListSync } from "../../data/domains/weaponRiven";
import { getWeaponRivenPartyInfoListSync, type WeaponRivenPartyKey } from "../../data/domains/weapon-riven-party";
import { limitWeaponRivenPartySouls } from "../../lib/weapon-riven/party-limit";

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
    if (!characters || characters[0] === null
        || !unisonCharacters || !equipments || !abilitySoulIds) return null
    return {
        characters,
        unison_characters: unisonCharacters,
        equipments,
        ability_soul_ids: stripWeaponRivenPublicPayload({ ability_soul_ids: abilitySoulIds }).ability_soul_ids,
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

function isCharacterIdTriplet(value: unknown): value is (number | null)[] {
    return Array.isArray(value)
        && value.length === 3
        && value.every(id => id === null
            || (typeof id === "number" && Number.isSafeInteger(id) && id > 0))
}

const wikiTeamCodeLookup = createTeamCodeClient()
const wikiTeamCodeLimiter = new TeamCodeLimiter()
let wikiTeamCodeAssets: TeamAssets | undefined

function getWikiTeamCodeAssets(): TeamAssets {
    return wikiTeamCodeAssets || (wikiTeamCodeAssets = loadTeamCodeAssets())
}

function getPlayerTeamInventory(playerId: number): TeamInventory {
    return {
        characters: getPlayerCharactersSync(playerId),
        equipment: getPlayerEquipmentListSync(playerId),
        items: getPlayerItemsSync(playerId),
        nodes: characterId => getPlayerCharacterManaNodesSync(playerId, characterId),
    }
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
        gameVerboseLog(() => `[PARTY CODE] publish player=${context.playerId} code=${partyCode}`)
        return sendPartyResponse(reply, context.viewerId, { party_code: partyCode })
    })

    fastify.post("/refer", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ReferBody
        const context = await resolvePartyPlayer(body)
        if (!context) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." })

        const partyCode = typeof body.party_code === "string" ? body.party_code.trim().toUpperCase() : ""
        if (/^[2-9A-HJ-NP-Z]{10}$/.test(partyCode)) {
            const publishedParty = getPublishedPartySync(partyCode)
            if (!publishedParty) return sendPartyResponse(reply, context.viewerId, {}, 3404)
            if (publishedParty.schemaVersion !== 1) return sendPartyResponse(reply, context.viewerId, {}, 3403)

            const battleParty = sanitizeBattleParty(publishedParty.battleParty)
            if (!battleParty) return sendPartyResponse(reply, context.viewerId, {}, 3403)

            gameVerboseLog(() => `[PARTY CODE] refer player=${context.playerId} code=${partyCode}`)
            return sendPartyResponse(reply, context.viewerId, {
                party_name: publishedParty.partyName,
                battle_party: battleParty,
            })
        }

        // Wiki-managed administrator codes use the same native response as a
        // local code, but are projected onto the requesting player's inventory.
        if (!GAME_CODE_PATTERN.test(partyCode)) {
            return sendPartyResponse(reply, context.viewerId, {}, 3404)
        }
        if (!wikiTeamCodeLimiter.take(`ip:${request.ip}`, 60)
            || !wikiTeamCodeLimiter.take(`viewer:${context.viewerId}`, 12)
            || !wikiTeamCodeLimiter.take(`player:${context.playerId}`, 12)) {
            reply.header("Retry-After", "60")
            return sendPartyResponse(reply, context.viewerId, {}, 3404)
        }
        try {
            const entry = await wikiTeamCodeLookup(partyCode)
            const assets = getWikiTeamCodeAssets()
            const battleParty = stripWeaponRivenPublicPayload(nativeBattleParty(
                resolvePublicTeam(entry.team, assets),
                getPlayerTeamInventory(context.playerId),
                assets,
            ))
            // A public code may reference a leader that this player does not
            // own. Inventory projection turns that slot into null, but the
            // game cannot save or battle a party without a leader. Reject the
            // code at the import boundary instead of returning a successful
            // response that later fails as C2330 during /party/edit.
            if (battleParty.characters[0] === null) {
                return sendPartyResponse(reply, context.viewerId, {}, 3403)
            }
            return sendPartyResponse(reply, context.viewerId, {
                party_name: entry.title,
                battle_party: battleParty,
            })
        } catch (error) {
            const resultCode = error instanceof TeamCodeError && error.kind === "not-found"
                ? 3404
                : 3403
            return sendPartyResponse(reply, context.viewerId, {}, resultCode)
        }
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
                || parseGlobalPartyId(info.party_id) === null
                || !Array.isArray(info.ability_soul_ids)
                || info.ability_soul_ids.length > 3
                || info.ability_soul_ids.some(id => id !== null
                    && (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)))) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid party category or party ID."
            })
        }
        // Check the wire shape before inventory mapping or SQL bindings. Empty
        // favorites remain legal; battle parties require exactly three slots.
        if (body.party_info_list.some(info =>
            info.party_category !== PROFILE_FAVORITE_PARTY_CATEGORY
            && !isCharacterIdTriplet(info.character_ids),
        )) {
            return sendPartyResponse(reply, viewerId, {}, 2330)
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

        // A battle party cannot have an empty leader. Profile favorites are
        // presentation-only and retain their existing empty-slot semantics.
        if (mappedParties.some(({ party }) =>
            party.category !== PROFILE_FAVORITE_PARTY_CATEGORY
            && party.characterIds[0] === null,
        )) {
            return sendPartyResponse(reply, viewerId, {}, 2330)
        }

        const changedNormalPartyIds: number[] = []
        let normalSelectionChanged = false
        const rivenCapable = hasWeaponRivenCapability(request)
        const correctedRivenParties = new Map<string, WeaponRivenPartyKey>()
        const saved = await runPersistenceTransaction({
            domain: "player", playerId, operation: "edit_party",
        }, () => {
            const battleParties = mappedParties.filter(
                ({ party }) => party.category !== PROFILE_FAVORITE_PARTY_CATEGORY,
            )
            const hasOwnedLeader = (id: unknown): id is number =>
                typeof id === "number"
                && Number.isSafeInteger(id)
                && id > 0
                && playerOwnsCharacterSync(playerId, id)
            if (battleParties.some(({ party }) => !hasOwnedLeader(party.characterIds[0]))) {
                return false
            }

            let abilitySoulEquipCount = 0
            const ownedRivens = getPlayerWeaponRivenListSync(playerId)
            const getPreviousSouls = getDb().prepare(`
                SELECT ability_soul_1, ability_soul_2, ability_soul_3
                FROM players_parties
                WHERE player_id = ? AND group_id = ? AND slot = ? AND category = ?
            `)
            const previousParty = getDb().prepare(`
                SELECT character_id_1, character_id_2, character_id_3,
                    unison_character_1, unison_character_2, unison_character_3,
                    equipment_1, equipment_2, equipment_3,
                    ability_soul_1, ability_soul_2, ability_soul_3
                FROM players_parties
                WHERE player_id = ? AND category = 1 AND group_id = ? AND slot = ?
            `)
            for (const { parsed, party } of mappedParties) {
                const previousSouls = getPreviousSouls.get(playerId, parsed.groupId, parsed.slot, party.category) as
                    { ability_soul_1: number | null; ability_soul_2: number | null; ability_soul_3: number | null } | undefined
                const previousIds = previousSouls
                    ? [previousSouls.ability_soul_1, previousSouls.ability_soul_2, previousSouls.ability_soul_3] : []
                party.abilitySoulIds = protectWeaponRivenPartySave(party.abilitySoulIds, previousIds,
                    rivenCapable, itemId => Object.prototype.hasOwnProperty.call(ownedRivens, String(itemId)))
                const limitedSouls = limitWeaponRivenPartySouls(party.abilitySoulIds)
                if (limitedSouls.some((id, index) => id !== party.abilitySoulIds[index])) {
                    correctedRivenParties.set(`${party.category}:${parsed.groupId}:${parsed.slot}`,
                        { category: party.category, group_id: parsed.groupId, slot: parsed.slot })
                    party.abilitySoulIds = limitedSouls
                }
                if (party.category === PartyCategory.NORMAL) {
                    const previous = previousParty.get(playerId, parsed.groupId, parsed.slot) as
                        Record<string, number | null> | undefined
                    const ids = [...party.characterIds, ...party.unisonCharacterIds,
                        ...party.equipmentIds, ...party.abilitySoulIds]
                    if (!previous || Object.values(previous).some((id, i) => id !== ids[i])) {
                        changedNormalPartyIds.push((parsed.groupId - 1) * 10 + parsed.slot)
                    }
                }
                if (party.category !== PROFILE_FAVORITE_PARTY_CATEGORY) {
                    abilitySoulEquipCount += countNewAbilitySoulEquipments(
                        previousIds,
                        party.abilitySoulIds,
                    )
                }
                updatePlayerPartySync(playerId, parsed.slot, party, parsed.groupId)
            }
            // Resolve after the protected writes, so the last edit in this
            // request is visible when repairing and selecting the same SET.
            // Favorites remain independent; an empty batch still switches SET.
            if (mappedParties.length === 0 || battleParties.length > 0) {
                const normalPartySlot = findValidNormalPartySlotSync(playerId, body.main_party_id)
                const currentPlayer = getPlayerSync(playerId)
                if (normalPartySlot !== null && currentPlayer?.partySlot !== normalPartySlot) {
                    updatePlayerSync({ id: playerId, partySlot: normalPartySlot })
                    normalSelectionChanged = true
                }
            }
            if (abilitySoulEquipCount > 0) {
                recordContentActionFactsSync(playerId, { kind: "ability_soul_equip", amount: abilitySoulEquipCount })
                addMissionCounterSync(playerId, {
                    dimension: "party.ability_soul_equip",
                    scopeType: "lifetime",
                    scopeKey: "all",
                    qualifier: {},
                }, abilitySoulEquipCount)
            }
            if (battleParties.length > 0) {
                incrementActiveMissionPartyActionCountsSync(playerId, {
                    equipmentEquipCount: battleParties.some(({ party }) => party.equipmentIds.some(id => id !== null)) ? 1 : 0,
                    unisonSetCount: battleParties.some(({ party }) => party.unisonCharacterIds.some(id => id !== null)) ? 1 : 0,
                    partyCharacterSetCount: battleParties.some(({ party }) => party.characterIds.some(id => id !== null)) ? 1 : 0,
                })
            }
            return true
        })
        if (!saved) return sendPartyResponse(reply, viewerId, {}, 2330)
        // A party edit can happen while the player is still on the lobby
        // screen. Drop the pre-handshake snapshot so a later reconnect reads
        // the newly persisted party instead of waiting for its TTL.
        invalidateRealPartySnapshot(playerId)
        try {
            await getRoomCommandGateway().execute("runtime.partyChanged", {
                playerId, changedPartyIds: changedNormalPartyIds, selectionChanged: normalSelectionChanged,
            })
        } catch (error) {
            // The save committed. Ready/Start will recheck authoritative data;
            // a failed lobby refresh must not make the client retry this save.
            console.error(`[PARTY] lobby equipment refresh failed: player=${playerId}`, error)
        }

        const responseData: Record<string, any> = { mail_arrived: false }
        if (correctedRivenParties.size > 0) responseData.party_info_list = projectWeaponRivenClientResponse(
            getWeaponRivenPartyInfoListSync(playerId, [...correctedRivenParties.values()]), rivenCapable)
        settleDegreeMissionResponse(playerId, viewerId, responseData, undefined, [35])
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({
                viewer_id: viewerId
            }),
            "data": responseData
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
