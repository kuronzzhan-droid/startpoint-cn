import { getContentSnapshot } from "../../content/runtime/content-snapshot"
import { getDb } from "../../data/db"
import { incrementActiveMissionBattleFactSync } from "../../data/domains/active_mission_battle_facts"
import type { FinishContext } from "../quest/finish/types"
import { matchesActiveMissionQuestRange } from "./active-reconciliation/quest-range"

export interface LoadoutBattleCharacterState {
    readonly element: number
}

export interface LoadoutBattleFact {
    readonly missionId: number
}

interface LoadoutBattleDefinition {
    readonly missionId: unknown
    readonly row: readonly unknown[]
}

interface LoadoutBattleContext {
    readonly questAccomplished: unknown
    readonly isMulti: unknown
    readonly questCategory: unknown
    readonly questId: unknown
    readonly partyCharacterIds: readonly unknown[]
    readonly equipmentElements?: readonly unknown[]
}

type LoadoutFinishContext = FinishContext & {
    readonly equipmentElements?: readonly number[]
}

function strictBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw new TypeError(`Invalid Active Mission ${field}.`)
    return value
}

function strictInteger(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(`Invalid Active Mission ${field}.`)
    }
    return value
}

function masterInteger(value: unknown, field: string): number {
    if (typeof value === "number") return strictInteger(value, field, 0)
    if (typeof value !== "string") throw new TypeError(`Invalid Active Mission ${field}.`)
    if (!/^(0|[1-9]\d*)$/.test(value)) throw new RangeError(`Invalid Active Mission ${field}.`)
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) throw new RangeError(`Invalid Active Mission ${field}.`)
    return parsed
}

function positiveMaster(value: unknown, field: string): number {
    const parsed = masterInteger(value, field)
    if (parsed === 0) throw new RangeError(`Invalid Active Mission ${field}.`)
    return parsed
}

function recordValue(value: unknown, field: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Invalid Active Mission ${field}.`)
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if (descriptor.get !== undefined || descriptor.set !== undefined) {
            throw new TypeError(`Invalid Active Mission ${field}.`)
        }
    }
    return value as Record<string, unknown>
}

function targetPattern(row: readonly unknown[]): boolean {
    return masterInteger(row[29], "loadout battle pattern") === 89
}

function densePositiveIds(value: readonly unknown[]): number[] {
    if (!Array.isArray(value)) throw new TypeError("Invalid Active Mission party character ids.")
    const result: number[] = []
    for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("Invalid Active Mission party character ids.")
        const id = strictInteger(value[index], "party character id", 1)
        if (!result.includes(id)) result.push(id)
    }
    return result
}

function equipmentElements(value: readonly unknown[] | undefined): number[] | undefined {
    if (value === undefined) return undefined
    if (!Array.isArray(value)) throw new TypeError("Invalid Active Mission equipment elements.")
    const result: number[] = []
    for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("Invalid Active Mission equipment elements.")
        const element = strictInteger(value[index], "equipment element", 0, 5)
        if (!result.includes(element)) result.push(element)
    }
    return result
}

function partyElements(
    partyCharacterIds: readonly unknown[],
    characters: Readonly<Record<string, LoadoutBattleCharacterState>>,
): number[] {
    const result: number[] = []
    for (const characterId of densePositiveIds(partyCharacterIds)) {
        const state = characters[String(characterId)]
        if (state === undefined) continue
        const row = recordValue(state, "loadout character state")
        const element = strictInteger(row.element, "loadout character element", 0, 5)
        if (!result.includes(element)) result.push(element)
    }
    return result
}

function requireRangeSentinels(row: readonly unknown[]): void {
    for (const index of [34, 35, 36, 37]) {
        if (row[index] === undefined || row[index] === null || row[index] === "") {
            throw new TypeError("Invalid Active Mission loadout quest range.")
        }
    }
}

export function collectActiveMissionLoadoutBattleFacts(
    definitions: readonly LoadoutBattleDefinition[],
    context: LoadoutBattleContext,
    characters: Readonly<Record<string, LoadoutBattleCharacterState>>,
): LoadoutBattleFact[] {
    const accomplished = strictBoolean(context.questAccomplished, "quest accomplished")
    const isMulti = strictBoolean(context.isMulti, "multi flag")
    if (!accomplished) return []
    const questCategory = strictInteger(context.questCategory, "quest category", 0)
    const questId = strictInteger(context.questId, "quest id", 1)
    const availableCharacters = partyElements(context.partyCharacterIds, characters)
    const availableEquipment = equipmentElements(context.equipmentElements)
    const facts = new Map<number, LoadoutBattleFact>()
    for (const definition of definitions) {
        if (definition === null || typeof definition !== "object" || !Array.isArray(definition.row)) {
            throw new TypeError("Invalid Active Mission loadout definition.")
        }
        if (!targetPattern(definition.row)) continue
        const missionId = positiveMaster(definition.missionId, "loadout mission id")
        if (definition.row.length !== 73) throw new TypeError("Invalid Active Mission loadout row.")
        const battleKind = masterInteger(definition.row[32], "battle kind")
        if (battleKind < 1 || battleKind > 3) throw new RangeError("Invalid Active Mission battle kind.")
        requireRangeSentinels(definition.row)
        const rangeMatches = matchesActiveMissionQuestRange(definition.row, questCategory, questId)
        const characterElement = masterInteger(definition.row[69], "loadout character element")
        if (characterElement < 1 || characterElement > 6) throw new RangeError("Invalid Active Mission character element.")
        const rawEquipmentElement = definition.row[70]
        const requiredEquipment = rawEquipmentElement === "(None)"
            ? undefined
            : masterInteger(rawEquipmentElement, "loadout equipment element")
        if (requiredEquipment !== undefined && (requiredEquipment < 1 || requiredEquipment > 6)) {
            throw new RangeError("Invalid Active Mission equipment element.")
        }
        const battleMatches = battleKind === 3 || (battleKind === 2) === isMulti
        const characterMatches = availableCharacters.includes(characterElement - 1)
        const equipmentMatches = requiredEquipment === undefined
            || (availableEquipment !== undefined && availableEquipment.includes(requiredEquipment - 1))
        if (battleMatches && rangeMatches && characterMatches && equipmentMatches) {
            facts.set(missionId, { missionId })
        }
    }
    return [...facts.values()].sort((left, right) => left.missionId - right.missionId)
}

function strictMissionDefinitions(repository: ReturnType<typeof getContentSnapshot>["repository"]): LoadoutBattleDefinition[] {
    const root = recordValue(repository.table("mission_active.json"), "mission active root")
    const result: LoadoutBattleDefinition[] = []
    for (const [rawId, nested] of Object.entries(root)) {
        const missionId = positiveMaster(rawId, "loadout mission id")
        if (String(missionId) !== rawId || !Array.isArray(nested) || nested.length !== 1 || !Array.isArray(nested[0])) {
            throw new TypeError("Invalid Active Mission mission active row.")
        }
        result.push({ missionId, row: nested[0] })
    }
    return result
}

function finishPartyIds(context: FinishContext): number[] {
    const party = recordValue(context.party, "finish party")
    if (!Array.isArray(party.characters) || !Array.isArray(party.unison_characters)) {
        throw new TypeError("Invalid Active Mission finish party.")
    }
    const result: number[] = []
    for (const members of [party.characters, party.unison_characters]) {
        for (let index = 0; index < members.length; index += 1) {
            if (!(index in members)) throw new TypeError("Invalid Active Mission finish party.")
            const member = members[index]
            if (member === undefined || member === null) continue
            const entry = recordValue(member, "finish party member")
            if (entry.id !== undefined && entry.id !== null) result.push(strictInteger(entry.id, "party character id", 1))
        }
    }
    return densePositiveIds(result)
}

function repositoryCharacters(
    partyCharacterIds: readonly number[],
    table: Record<string, unknown>,
): Record<string, LoadoutBattleCharacterState> {
    const result: Record<string, LoadoutBattleCharacterState> = {}
    for (const characterId of partyCharacterIds) {
        const raw = table[String(characterId)]
        if (raw === undefined) continue
        const character = recordValue(raw, "character master row")
        result[String(characterId)] = {
            element: strictInteger(character.element, "character master element", 0, 5),
        }
    }
    return result
}

export function recordActiveMissionLoadoutBattleFactsSync(context: FinishContext): void {
    const accomplished = strictBoolean(context.questAccomplished, "quest accomplished")
    if (!accomplished) return
    const playerId = strictInteger(context.playerId, "player id", 1)
    const isMulti = context.isMulti === undefined ? false : strictBoolean(context.isMulti, "multi flag")
    const questCategory = strictInteger(context.questCategory, "quest category", 0)
    const questId = strictInteger(context.questId, "quest id", 1)
    const partyCharacterIds = finishPartyIds(context)
    const extended = context as LoadoutFinishContext
    const validatedEquipment = equipmentElements(extended.equipmentElements)
    const repository = getContentSnapshot().repository
    const definitions = strictMissionDefinitions(repository)
    const characterTable = recordValue(repository.table("character.json"), "character root")
    const characters = repositoryCharacters(partyCharacterIds, characterTable)
    const facts = collectActiveMissionLoadoutBattleFacts(definitions, {
        questAccomplished: accomplished,
        isMulti,
        questCategory,
        questId,
        partyCharacterIds,
        equipmentElements: validatedEquipment,
    }, characters)
    getDb().transaction(() => {
        for (const fact of facts) incrementActiveMissionBattleFactSync(playerId, fact.missionId)
    })()
}
