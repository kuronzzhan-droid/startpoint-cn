import { getContentSnapshot } from "../../content/runtime/content-snapshot"
import { getDb } from "../../data/db"
import { incrementActiveMissionConditionalBattleFactSync } from "../../data/domains/active_mission_battle_condition_facts"
import { getPlayerCharactersManaNodesSync, getPlayerCharactersSync } from "../../data/domains/character"
import { getCharacterManaNodesSync } from "../assets"
import { estimateActiveMissionCharacterLevel } from "./active-reconciliation/fact-progress"
import { matchesActiveMissionQuestRange } from "./active-reconciliation/quest-range"
import type { FinishContext } from "../quest/finish/types"

export interface ConditionalBattleCharacterState {
    readonly level: number
    readonly secondBoardAbilitiesComplete: boolean
}

export interface ConditionalBattleFact {
    readonly pattern: 71 | 72 | 73
    readonly characterId: number
}

interface ConditionalBattleDefinition {
    readonly missionId: unknown
    readonly row: readonly unknown[]
}

interface ConditionalBattleContext {
    readonly questAccomplished: unknown
    readonly isMulti: unknown
    readonly questCategory: unknown
    readonly questId: unknown
    readonly partyCharacterIds: readonly unknown[]
}

const TARGET_PATTERNS = new Set<number>([71, 72, 73])
const SECOND_BOARD_GROUPS = new Set<number>([4, 5, 6])

function canonicalNonNegativeInteger(value: unknown, field: string): number {
    if (typeof value === "number") return nonNegativeSafeNumber(value, field)
    if (typeof value !== "string") throw new TypeError(`Invalid Active Mission ${field}.`)
    if (!/^(0|[1-9]\d*)$/.test(value)) throw new RangeError(`Invalid Active Mission ${field}.`)
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) throw new RangeError(`Invalid Active Mission ${field}.`)
    return parsed
}

function positiveSafe(value: unknown, field: string): number {
    const parsed = canonicalNonNegativeInteger(value, field)
    if (parsed === 0) throw new RangeError(`Invalid Active Mission ${field}.`)
    return parsed
}

function positiveSafeNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`Invalid Active Mission ${field}.`)
    }
    return value
}

function nonNegativeSafeNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`Invalid Active Mission ${field}.`)
    }
    return value
}

function strictBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw new TypeError(`Invalid Active Mission ${field}.`)
    return value
}

function targetPattern(row: readonly unknown[]): 71 | 72 | 73 | null {
    const parsed = canonicalNonNegativeInteger(row[29], "conditional battle pattern")
    return TARGET_PATTERNS.has(parsed) ? parsed as 71 | 72 | 73 : null
}

function assertDenseParty(ids: readonly unknown[]): number[] {
    const result: number[] = []
    for (let index = 0; index < ids.length; index += 1) {
        if (!(index in ids)) throw new TypeError("Invalid Active Mission party character ids.")
        const id = positiveSafeNumber(ids[index], "party character id")
        if (!result.includes(id)) result.push(id)
    }
    return result
}

function characterState(
    states: Readonly<Record<string, ConditionalBattleCharacterState>>,
    characterId: number,
): ConditionalBattleCharacterState | null {
    const state = states[String(characterId)]
    if (state === undefined) return null
    if (state === null || typeof state !== "object") throw new TypeError("Invalid Active Mission character state.")
    nonNegativeSafeNumber(state.level, "conditional battle character level")
    strictBoolean(state.secondBoardAbilitiesComplete, "second board abilities complete")
    return state
}

function applies(pattern: 71 | 72 | 73, state: ConditionalBattleCharacterState): boolean {
    return pattern === 71
        ? state.secondBoardAbilitiesComplete
        : pattern === 72
            ? state.level >= 80
            : state.level >= 100
}

function requireQuestRangeSentinels(row: readonly unknown[]): void {
    for (const index of [34, 35, 36, 37]) {
        if (row[index] === undefined || row[index] === null || row[index] === "") {
            throw new TypeError("Invalid Active Mission conditional battle quest range.")
        }
    }
}

export function collectActiveMissionConditionalBattleFacts(
    definitions: readonly ConditionalBattleDefinition[],
    context: ConditionalBattleContext,
    characters: Readonly<Record<string, ConditionalBattleCharacterState>>,
): ConditionalBattleFact[] {
    const accomplished = strictBoolean(context.questAccomplished, "quest accomplished")
    const isMulti = strictBoolean(context.isMulti, "multi flag")
    if (!accomplished) return []
    const party = assertDenseParty(context.partyCharacterIds)
    const partyIds = new Set(party)
    const questCategory = nonNegativeSafeNumber(context.questCategory, "quest category")
    const questId = positiveSafeNumber(context.questId, "quest id")
    const facts = new Map<string, ConditionalBattleFact>()
    for (const definition of definitions) {
        if (definition === null || typeof definition !== "object" || !Array.isArray(definition.row)) {
            throw new TypeError("Invalid Active Mission conditional battle definition.")
        }
        const pattern = targetPattern(definition.row)
        if (pattern === null) continue
        const missionId = positiveSafe(definition.missionId, "conditional battle mission id")
        void missionId
        if (definition.row.length !== 73) throw new TypeError("Invalid Active Mission conditional battle row.")
        const battleKind = canonicalNonNegativeInteger(definition.row[32], "battle kind")
        if (battleKind < 1 || battleKind > 3) throw new RangeError(`Unsupported Active Mission battle kind ${battleKind}.`)
        requireQuestRangeSentinels(definition.row)
        const rangeMatches = matchesActiveMissionQuestRange(definition.row, questCategory, questId)
        const characterId = positiveSafe(definition.row[43], "conditional battle character id")
        if ((battleKind === 1 && isMulti) || (battleKind === 2 && !isMulti) || !rangeMatches) continue
        if (!partyIds.has(characterId)) continue
        const state = characterState(characters, characterId)
        if (state !== null && applies(pattern, state)) facts.set(`${pattern}:${characterId}`, { pattern, characterId })
    }
    return [...facts.values()].sort((left, right) => left.pattern - right.pattern || left.characterId - right.characterId)
}

function strictRecord(value: unknown, field: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if (descriptor.get !== undefined || descriptor.set !== undefined) {
            throw new TypeError(`Invalid Active Mission ${field}.`)
        }
    }
    return value as Record<string, unknown>
}

function snapshotDefinitions(repository: ReturnType<typeof getContentSnapshot>["repository"]): ConditionalBattleDefinition[] {
    const root = strictRecord(repository.table("mission_active.json"), "mission active root")
    const definitions: ConditionalBattleDefinition[] = []
    for (const [rawId, nested] of Object.entries(root)) {
        const missionId = positiveSafe(rawId, "conditional battle mission id")
        if (String(missionId) !== rawId || !Array.isArray(nested) || nested.length !== 1 || !Array.isArray(nested[0])) {
            throw new TypeError("Invalid Active Mission mission active row.")
        }
        definitions.push({ missionId, row: nested[0] })
    }
    return definitions
}

function secondBoardComplete(characterId: number, rawUnlocked: readonly unknown[]): boolean {
    const nodes = getCharacterManaNodesSync(characterId, 2)
    if (nodes === null || typeof nodes !== "object" || Array.isArray(nodes)) {
        throw new TypeError("Invalid Active Mission second mana board.")
    }
    const unlocked = new Set<number>()
    for (let index = 0; index < rawUnlocked.length; index += 1) {
        if (!(index in rawUnlocked)) throw new TypeError("Invalid Active Mission unlocked mana nodes.")
        unlocked.add(positiveSafeNumber(rawUnlocked[index], "unlocked mana node id"))
    }
    const groups = new Map<number, number[]>()
    for (const [rawId, rawNode] of Object.entries(nodes)) {
        const nodeId = positiveSafe(rawId, "mana node asset id")
        const node = strictRecord(rawNode, "mana node asset")
        const group = canonicalNonNegativeInteger(node.field6, "mana node asset group")
        if (!SECOND_BOARD_GROUPS.has(group)) continue
        const values = groups.get(group) ?? []
        values.push(nodeId)
        groups.set(group, values)
    }
    return [4, 5, 6].every(group => {
        const values = groups.get(group)
        return values !== undefined && values.length > 0 && values.every(nodeId => unlocked.has(nodeId))
    })
}

function recorderCharacters(
    playerId: number,
    partyCharacterIds: readonly unknown[],
    characterTable: Record<string, unknown>,
): Record<string, ConditionalBattleCharacterState> {
    const party = assertDenseParty(partyCharacterIds)
    const owned = getPlayerCharactersSync(playerId) as Readonly<Record<string, unknown>>
    const unlocked = getPlayerCharactersManaNodesSync(playerId) as Readonly<Record<string, unknown>>
    const result: Record<string, ConditionalBattleCharacterState> = {}
    for (const characterId of party) {
        const rawOwned = owned[String(characterId)]
        if (rawOwned === undefined) continue
        const storedCharacter = strictRecord(rawOwned, "player character row")
        const rawMaster = characterTable[String(characterId)]
        if (rawMaster === undefined) continue
        const master = strictRecord(rawMaster, "character master row")
        const rarity = positiveSafe(master.rarity, "character rarity")
        const rawUnlocked = unlocked[String(characterId)]
        if (rawUnlocked !== undefined && !Array.isArray(rawUnlocked)) {
            throw new TypeError("Invalid Active Mission unlocked mana nodes.")
        }
        result[String(characterId)] = {
            level: estimateActiveMissionCharacterLevel({
                exp: nonNegativeSafeNumber(storedCharacter.exp, "player character exp"),
                rarity,
                evolutionLevel: nonNegativeSafeNumber(storedCharacter.evolutionLevel, "player character evolution level"),
                overLimitStep: nonNegativeSafeNumber(storedCharacter.overLimitStep, "player character over limit step"),
                bondTokenList: Array.isArray(storedCharacter.bondTokenList) ? storedCharacter.bondTokenList : [],
            }),
            secondBoardAbilitiesComplete: secondBoardComplete(characterId, rawUnlocked ?? []),
        }
    }
    return result
}

function finishPartyIds(context: FinishContext): number[] {
    if (context.party === null || typeof context.party !== "object"
        || !Array.isArray(context.party.characters) || !Array.isArray(context.party.unison_characters)) {
        throw new TypeError("Invalid Active Mission finish party.")
    }
    const result: number[] = []
    for (const members of [context.party.characters, context.party.unison_characters]) {
        for (let index = 0; index < members.length; index += 1) {
            if (!(index in members)) throw new TypeError("Invalid Active Mission finish party.")
            const member = members[index]
            if (member === undefined || member === null) continue
            if (typeof member !== "object") throw new TypeError("Invalid Active Mission finish party member.")
            if (member.id === undefined || member.id === null) continue
            result.push(positiveSafeNumber(member.id, "party character id"))
        }
    }
    return assertDenseParty(result)
}

export function recordActiveMissionConditionalBattleFactsSync(context: FinishContext): void {
    const accomplished = strictBoolean(context.questAccomplished, "quest accomplished")
    if (!accomplished) return
    const playerId = positiveSafeNumber(context.playerId, "player id")
    const isMulti = context.isMulti === undefined ? false : strictBoolean(context.isMulti, "multi flag")
    const questCategory = nonNegativeSafeNumber(context.questCategory, "quest category")
    const questId = positiveSafeNumber(context.questId, "quest id")
    const partyCharacterIds = finishPartyIds(context)
    const snapshot = getContentSnapshot()
    const repository = snapshot.repository
    const definitions = snapshotDefinitions(repository)
    const characterTable = strictRecord(repository.table("character.json"), "character root")
    const characters = recorderCharacters(playerId, partyCharacterIds, characterTable)
    const facts = collectActiveMissionConditionalBattleFacts(definitions, {
        questAccomplished: context.questAccomplished,
        isMulti,
        questCategory,
        questId,
        partyCharacterIds,
    }, characters)
    getDb().transaction(() => {
        for (const fact of facts) incrementActiveMissionConditionalBattleFactSync(playerId, fact.pattern, fact.characterId)
    })()
}
