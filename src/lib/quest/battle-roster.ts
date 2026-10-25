import { getDb } from "../../data/db"
import { PartyCategory } from "../../data/types"
import { getPlayerCharacterSync } from "../../data/domains/character"
import { QuestCategory } from "../types"
import { parseGlobalPartyId } from "../special-event-parties"
import { partyCategoryForRushEvent } from "../rush-party-categories"

export interface BattleParty {
    characters: ({ id: number, [key: string]: unknown } | null)[]
    unison_characters: ({ id: number, [key: string]: unknown } | null)[]
    equipments: ({ id: number, [key: string]: unknown } | null)[]
    ability_soul_ids: (number | null)[]
    [key: string]: unknown
}

export interface BattleRoster {
    version: 1
    party: BattleParty | null
    fixedParty?: number
    raid?: {
        partyGroupId: number
        parties: { partyId: number, subId: number, party: BattleParty }[]
    }
    multi?: {
        battleInstanceId: string
        roomInstanceId?: string
        roomGeneration: number
        participants: { viewerId: number, comId: number }[]
        expectedRealViewerIds: number[]
        isRescueGuest?: boolean
        isRescueFragmentEligible?: boolean
        isNewbieRescueGuest?: boolean
    }
}

export class BattleRosterValidationError extends Error {
    readonly code = "INVALID_BATTLE_PARTY"
}

export function isBattleRosterError(error: unknown): error is BattleRosterValidationError {
    return (error as { code?: string } | null)?.code === "INVALID_BATTLE_PARTY"
}

function invalid(): never {
    throw new BattleRosterValidationError("Invalid battle party: expected up to three main and three unique unison characters.")
}

function id(value: unknown): number | null {
    if (value === null || value === undefined || value === 0) return null
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return invalid()
    return value
}

/** Bounds apply to the primary 3+3 party, not Raid's separate sub_statistics. */
export function normalizeBattleParty(value: unknown, allowDuplicateCharacters = false): BattleParty {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid()
    const input = value as Record<string, unknown>
    const seen = new Set<number>()
    const slots = (key: string, required: boolean, characters: boolean): ({ id: number } | null)[] => {
        const entries = input[key]
        if (entries === undefined && !required) return [null, null, null]
        if (!Array.isArray(entries) || entries.length > 3) return invalid()
        return Array.from({ length: 3 }, (_, index) => {
            const entry = entries[index]
            if (entry === null || entry === undefined) return null
            if (typeof entry !== "object" || Array.isArray(entry)) return invalid()
            const entryId = id(entry.id)
            if (entryId === null) return null
            if (characters && !allowDuplicateCharacters) {
                if (seen.has(entryId)) return invalid()
                seen.add(entryId)
            }
            return { ...entry, id: entryId }
        })
    }
    const characters = slots("characters", true, true)
    const unison = slots("unison_characters", true, true)
    const equipments = slots("equipments", false, false)
    const souls = input.ability_soul_ids
    if (souls !== undefined && (!Array.isArray(souls) || souls.length > 3)) return invalid()
    return { ...input, characters, unison_characters: unison, equipments,
        ability_soul_ids: Array.from({ length: 3 }, (_, index) => id((souls as unknown[] | undefined)?.[index])) }
}

export function cloneBattleRoster(roster: BattleRoster | null | undefined): BattleRoster | undefined {
    return roster ? JSON.parse(JSON.stringify(roster)) : undefined
}

/** The realtime lobby uses Haxe Option arrays, unlike HTTP finish statistics. */
export function battlePartyFromWire(value: any): BattleParty | undefined {
    if (!Array.isArray(value?.characters) || !Array.isArray(value?.unison_characters)) return undefined
    const options = (values: any, field?: string) => {
        if (!Array.isArray(values) || values.length > 3) return invalid()
        return values.map(entry => {
            if (!Array.isArray(entry)) return invalid()
            if (entry[0] === 1 && entry.length === 1) return null
            if (entry[0] !== 0 || entry.length !== 2) return invalid()
            return field ? { id: id(entry[1]?.[field]) } : id(entry[1])
        })
    }
    return normalizeBattleParty({ characters: options(value.characters, "id"),
        unison_characters: options(value.unison_characters, "id"),
        equipments: options(value.equipments ?? [], "equipmentId"),
        ability_soul_ids: options(value.abilitySoulIds ?? []) })
}

export function decodeBattleRoster(raw: string | null | undefined): BattleRoster | null {
    if (raw === null || raw === undefined) return null
    const roster = JSON.parse(raw) as BattleRoster
    if (!roster || roster.version !== 1 || !("party" in roster)) throw new Error("Invalid stored battle roster.")
    if (roster.party !== null) roster.party = normalizeBattleParty(roster.party)
    if (roster.raid) {
        if (!Number.isSafeInteger(roster.raid.partyGroupId) || roster.raid.partyGroupId < 1
            || !Array.isArray(roster.raid.parties) || roster.raid.parties.length !== 3) throw new Error("Invalid stored Raid roster.")
        const ids = new Set<number>()
        roster.raid.parties = roster.raid.parties.map((entry, index) => {
            if (entry.subId !== index || !Number.isSafeInteger(entry.partyId) || entry.partyId < 1
                || ids.has(entry.partyId)) throw new Error("Invalid stored Raid party identity.")
            ids.add(entry.partyId)
            return { ...entry, party: normalizeBattleParty(entry.party) }
        })
    }
    if (roster.multi && (!Array.isArray(roster.multi.participants) || !Array.isArray(roster.multi.expectedRealViewerIds)
        || typeof roster.multi.battleInstanceId !== "string")) throw new Error("Invalid stored multiplayer roster.")
    return roster
}

function assertOwned(playerId: number, party: BattleParty): void {
    for (const entry of [...party.characters, ...party.unison_characters]) {
        if (entry && getPlayerCharacterSync(playerId, entry.id) === null) return invalid()
    }
}

/** Capture within the start transaction, before fees, never from a finish-time SET. */
export function captureBattleRosterSync(args: {
    playerId: number, questCategory: number, questId: number, partyId: number,
    fixedParty?: number, party?: BattleParty,
}): BattleRoster {
    if (args.fixedParty !== undefined) return { version: 1, party: null, fixedParty: args.fixedParty }
    if (args.party) {
        const party = normalizeBattleParty(args.party)
        assertOwned(args.playerId, party)
        return { version: 1, party }
    }
    const selected = parseGlobalPartyId(args.partyId)
    if (!selected) {
        // These are client-defined recommended/fixed/history/temporary sources,
        // not saved SET slots. Their old protocol has no server roster at start.
        if ([1000, 2000, 3000, 4000, 9001, 10000].includes(args.partyId)) return { version: 1, party: null }
        return invalid()
    }
    const category = args.questCategory === QuestCategory.CARNIVAL_EVENT ? PartyCategory.CARNIVAL
        : args.questCategory === QuestCategory.RAID_EVENT ? PartyCategory.RAID
            : args.questCategory === QuestCategory.RUSH_EVENT ? partyCategoryForRushEvent(Math.floor(args.questId / 1000))
                : PartyCategory.NORMAL
    const row = getDb().prepare(`SELECT * FROM players_parties
        WHERE player_id=? AND category=? AND group_id=? AND slot=?`).get(
        args.playerId, category, selected.groupId, selected.slot,
    ) as Record<string, number | null> | undefined
    if (!row) return invalid()
    const objects = (key: string) => [1, 2, 3].map(slot => {
        const value = id(row[`${key}_${slot}`])
        return value === null ? null : { id: value }
    })
    const party = normalizeBattleParty({ characters: objects("character_id"), unison_characters: objects("unison_character"),
        equipments: objects("equipment"), ability_soul_ids: [1, 2, 3].map(slot => row[`ability_soul_${slot}`]) })
    assertOwned(args.playerId, party)
    return { version: 1, party }
}

export function resolveBattlePartySync(
    playerId: number, roster: BattleRoster | null | undefined, reportedParty: unknown, fixedParty: boolean,
): BattleParty {
    const reported = normalizeBattleParty(reportedParty, fixedParty)
    if (roster?.party) return normalizeBattleParty(JSON.parse(JSON.stringify(roster.party)))
    // Old in-flight plays and explicit client-only party sources remain local
    // compatibility paths. Never infer a historical party from today's SET.
    if (!fixedParty) assertOwned(playerId, reported)
    return reported
}

/** Raid sub_id follows the published party_list order, not its slot number. */
export function captureRaidBattleRosterSync(args: {
    playerId: number, questId: number, partyGroupId: number,
    parties: { partyId: number, party: BattleParty }[],
}): BattleRoster {
    if (args.parties.length !== 3) return invalid()
    const parties = args.parties.map((entry, subId) => ({ partyId: entry.partyId, subId,
        party: captureBattleRosterSync({ playerId: args.playerId, questCategory: QuestCategory.RAID_EVENT,
            questId: args.questId, partyId: entry.partyId, party: entry.party }).party! }))
    const characters = new Set<number>()
    for (const entry of parties) for (const character of [...entry.party.characters, ...entry.party.unison_characters]) {
        if (character) {
            if (characters.has(character.id)) throw new BattleRosterValidationError("Raid parties contain a repeated character.")
            characters.add(character.id)
        }
    }
    return { version: 1, party: JSON.parse(JSON.stringify(parties[0].party)),
        raid: { partyGroupId: args.partyGroupId, parties } }
}

/** Missing old telemetry remains missing; reported sub parties bind by sub_id. */
export function resolveRaidSubStatistics(
    roster: BattleRoster | null | undefined, primary: unknown, subStatistics: unknown,
): unknown {
    if (!roster?.raid) return subStatistics
    const primaryId = (primary as { sub_id?: unknown } | undefined)?.sub_id
    if (primaryId !== undefined && primaryId !== 0) throw new BattleRosterValidationError("Invalid Raid primary sub_id.")
    if (subStatistics === undefined) return undefined
    if (!Array.isArray(subStatistics) || subStatistics.length > 2) throw new BattleRosterValidationError("Invalid Raid sub_statistics.")
    const seen = new Set<number>()
    return subStatistics.map(value => {
        const subId = value?.sub_id
        if (!value || typeof value !== "object" || Array.isArray(value) || (subId !== 1 && subId !== 2)
            || seen.has(subId)) throw new BattleRosterValidationError("Invalid or repeated Raid sub_id.")
        seen.add(subId)
        normalizeBattleParty(value.party)
        return { ...value, party: JSON.parse(JSON.stringify(roster.raid!.parties[subId].party)) }
    })
}
