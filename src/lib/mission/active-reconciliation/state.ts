import type { ReadonlyContentRepository } from "../../../content/runtime/content-snapshot"
import { getActiveMissionBattleFactsSync } from "../../../data/domains/active_mission_battle_facts"
import { getActiveMissionConditionalBattleFactsSync } from "../../../data/domains/active_mission_battle_condition_facts"
import {
    getActiveMissionCountersSync,
    getActiveMissionPracticeQuestChallengeCountSync,
} from "../../../data/domains/active_mission_counters"
import { getPlayerCharactersManaNodesSync, getPlayerCharactersSync } from "../../../data/domains/character"
import { getPlayerCharacterClearsSync } from "../../../data/domains/character_clear"
import { getPlayerEquipmentListSync } from "../../../data/domains/equipment"
import { getMissionBattleCountersSync } from "../../../data/domains/mission_battle_facts"
import { getPlayerPartyGroupListSync } from "../../../data/domains/party"
import { getPlayerShopPurchasesMapSync } from "../../../data/domains/shopPurchase"
import { parseCanonicalNonNegativeInteger } from "./quest-range"
import type { ActiveMissionFactRequirements } from "./requirements"
import type { ActiveMissionFactQuestProgress, ActiveMissionFactState } from "./types"

const EMPTY_COUNTERS = Object.freeze({
    totalUsedManaCount: 0,
    totalGachaCharacterCount: 0,
    totalEquipmentEquipCount: 0,
    totalUnisonSetCount: 0,
    totalPartyCharacterSetCount: 0,
    totalInjectedExpCount: 0,
    totalGachaCampaignCount: 0,
})

const EMPTY_BATTLE_COUNTERS = Object.freeze({
    singleClearCount: 0,
    multiClearCount: 0,
    multiHostClearCount: 0,
    singleRankSsCount: 0,
    rankSsCount: 0,
})

const chapterQuestCache = new WeakMap<ReadonlyContentRepository, Readonly<Record<string, readonly number[]>>>()

function record(value: unknown, field: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    return value as Record<string, unknown>
}

function nonNegative(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Unsafe Active Mission ${field}.`)
    return value
}

function positive(value: unknown, field: string): number {
    const parsed = nonNegative(value, field)
    if (parsed === 0) throw new RangeError(`Invalid Active Mission ${field}.`)
    return parsed
}

function canonicalPositiveId(value: string, field: string): number {
    const parsed = parseCanonicalNonNegativeInteger(value, field)
    if (parsed === 0) throw new RangeError(`Invalid Active Mission ${field}.`)
    return parsed
}

function safeAdd(left: number, right: number, field: string): number {
    const result = left + right
    if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`Unsafe Active Mission ${field}.`)
    return result
}

export function readRequiredRepositoryRecord(
    repository: ReadonlyContentRepository,
    tableName: string,
): Record<string, unknown> {
    return record(repository.table<unknown>(tableName), `repository table ${tableName}`)
}

function validateCanonicalKeys(table: Record<string, unknown>, field: string): void {
    Object.keys(table).forEach(key => canonicalPositiveId(key, field))
}

function validateCharacterTable(table: Record<string, unknown>): void {
    validateCanonicalKeys(table, "repository character id")
    for (const [characterId, rawCharacter] of Object.entries(table)) {
        const character = record(rawCharacter, `character ${characterId}`)
        if (character.rarity !== undefined) positive(character.rarity, "character rarity")
    }
}

function validateEquipmentTable(table: Record<string, unknown>): void {
    validateCanonicalKeys(table, "equipment id")
    for (const [equipmentId, rawEquipment] of Object.entries(table)) {
        const equipment = record(rawEquipment, `equipment ${equipmentId}`)
        positive(equipment.max_level, "equipment max level")
    }
}

function chapterQuestIds(repository: ReadonlyContentRepository): Readonly<Record<string, readonly number[]>> {
    const cached = chapterQuestCache.get(repository)
    if (cached) return cached
    const read = (tableName: string, offset: number): readonly number[] => {
        const table = readRequiredRepositoryRecord(repository, tableName)
        validateCanonicalKeys(table, `${tableName} quest id`)
        return Object.entries(table).flatMap(([rawId, rawQuest]) => {
            const quest = record(rawQuest, `${tableName} quest ${rawId}`)
            if (!("rankPointReward" in quest)) return []
            const id = canonicalPositiveId(rawId, `${tableName} quest id`) + offset
            if (!Number.isSafeInteger(id)) throw new RangeError(`Unsafe Active Mission ${tableName} quest id.`)
            return [id]
        })
    }
    const result = Object.freeze({
        "1": Object.freeze([...read("main_quest.json", 0)]),
        "4": Object.freeze([...read("ex_quest.json", 10_000_000)]),
    })
    chapterQuestCache.set(repository, result)
    return result
}

function characterStoryIds(repository: ReadonlyContentRepository, characterIds: readonly string[]): Record<string, readonly number[]> {
    const table = readRequiredRepositoryRecord(repository, "character_quest_lookup.json")
    validateCanonicalKeys(table, "character story quest id")
    for (const [questId, rows] of Object.entries(table)) {
        if (!Array.isArray(rows)) throw new TypeError(`Invalid Active Mission character story quest ${questId}.`)
    }
    return Object.fromEntries(characterIds.map(characterId => {
        const lookupId = characterId === "1" ? "10" : characterId
        const ids = Object.keys(table).filter(id => id.startsWith(lookupId)).map(id => Number(id))
        return [characterId, Object.freeze(ids)]
    }))
}

function manaDefinitions(repository: ReadonlyContentRepository, characterIds: readonly string[]): {
    readonly boards: Record<string, Readonly<Record<string, readonly number[]>>>
    readonly slots: Record<string, Readonly<Record<string, number>>>
} {
    const table = readRequiredRepositoryRecord(repository, "mana_node.json")
    validateCanonicalKeys(table, "mana character id")
    for (const [characterId, rawCharacter] of Object.entries(table)) {
        const character = record(rawCharacter, `mana character ${characterId}`)
        for (const [rawBoard, rawNodes] of Object.entries(character)) {
            canonicalPositiveId(rawBoard, "mana board id")
            const nodes = record(rawNodes, `mana board ${rawBoard}`)
            validateCanonicalKeys(nodes, "mana node id")
            for (const [nodeId, rawNode] of Object.entries(nodes)) record(rawNode, `mana node ${nodeId}`)
        }
    }
    const boards: Record<string, Readonly<Record<string, readonly number[]>>> = {}
    const slots: Record<string, Readonly<Record<string, number>>> = {}
    for (const characterId of characterIds) {
        const rawCharacter = table[characterId]
        if (rawCharacter === undefined) throw new TypeError(`Missing Active Mission mana character ${characterId}.`)
        const character = record(rawCharacter, `mana character ${characterId}`)
        const characterBoards: Record<string, readonly number[]> = {}
        const characterSlots: Record<string, number> = {}
        for (const [rawBoard, rawNodes] of Object.entries(character)) {
            const boardId = canonicalPositiveId(rawBoard, "mana board id")
            const nodes = record(rawNodes, `mana board ${rawBoard}`)
            validateCanonicalKeys(nodes, "mana node id")
            characterBoards[String(boardId)] = Object.freeze(Object.keys(nodes).map(Number))
            for (const [nodeId, rawNode] of Object.entries(nodes)) {
                const node = record(rawNode, `mana node ${nodeId}`)
                characterSlots[nodeId] = node.field6 === "1" ? 1 : node.field6 === "2" ? 2 : node.field6 === "3" ? 3 : 4
            }
        }
        boards[characterId] = Object.freeze(characterBoards)
        slots[characterId] = Object.freeze(characterSlots)
    }
    return { boards, slots }
}

function purchaseItemIds(repository: ReadonlyContentRepository): {
    readonly treasure: ReadonlySet<string>
    readonly boss: ReadonlySet<string>
    readonly bossEquipment: ReadonlySet<string>
} {
    const treasure = readRequiredRepositoryRecord(repository, "treasure_shop.json")
    const categories = readRequiredRepositoryRecord(repository, "boss_coin_shop_item_category_map.json")
    const shops = readRequiredRepositoryRecord(repository, "boss_coin_shop.json")
    validateCanonicalKeys(treasure, "treasure shop item id")
    validateCanonicalKeys(categories, "boss coin shop item id")
    const bossEquipment = new Set<string>()
    for (const [categoryId, rawItems] of Object.entries(shops)) {
        canonicalPositiveId(categoryId, "boss coin shop category id")
        const items = record(rawItems, `boss coin shop category ${categoryId}`)
        validateCanonicalKeys(items, "boss coin shop item id")
        for (const [itemId, rawItem] of Object.entries(items)) {
            const item = record(rawItem, `boss coin shop item ${itemId}`)
            if (item.rewards === undefined) continue
            if (!Array.isArray(item.rewards)) throw new TypeError(`Invalid Active Mission boss coin rewards ${itemId}.`)
            if (item.rewards.some(rawReward => nonNegative(record(rawReward, "boss coin reward").type, "boss coin reward type") === 4)) {
                bossEquipment.add(itemId)
            }
        }
    }
    return { treasure: new Set(Object.keys(treasure)), boss: new Set(Object.keys(categories)), bossEquipment }
}

function countPurchases(purchases: Record<number, number>, ids: ReadonlySet<string>, field: string): number {
    return Object.entries(purchases).reduce((total, [rawId, rawCount]) => {
        canonicalPositiveId(rawId, "shop purchase item id")
        const count = nonNegative(rawCount, "shop purchase count")
        return ids.has(rawId) ? safeAdd(total, count, field) : total
    }, 0)
}

export function buildActiveMissionFactState(
    playerId: number,
    player: Readonly<{ readonly totalLoginDays: number, readonly totalStaminaUsed: number }>,
    finishedQuestIds: ReadonlySet<number>,
    questProgress: readonly ActiveMissionFactQuestProgress[],
    repository: ReadonlyContentRepository,
    requirements: ActiveMissionFactRequirements,
): ActiveMissionFactState {
    const validPlayerId = positive(playerId, "player id")
    const needsCharacterRows = requirements.characters || requirements.manaNodes
    const storedCharacters = needsCharacterRows ? getPlayerCharactersSync(validPlayerId) : {}
    const characterIds = Object.keys(storedCharacters)
    characterIds.forEach(id => canonicalPositiveId(id, "stored character id"))
    const characterTable = requirements.characters
        ? readRequiredRepositoryRecord(repository, "character.json")
        : {}
    if (requirements.characters) validateCharacterTable(characterTable)
    const characters = Object.fromEntries(Object.entries(storedCharacters).map(([id, character]) => {
        const rawMaster = requirements.characters ? characterTable[id] : undefined
        if (requirements.characters && rawMaster === undefined) throw new TypeError(`Missing Active Mission character ${id}.`)
        const master = rawMaster === undefined ? {} : record(rawMaster, `character ${id}`)
        const rarity = master.rarity === undefined ? undefined : positive(master.rarity, "character rarity")
        return [id, Object.freeze({
            exp: nonNegative(character.exp, "character exp"),
            evolutionLevel: nonNegative(character.evolutionLevel, "character evolution level"),
            overLimitStep: nonNegative(character.overLimitStep, "character over limit step"),
            bondTokenList: Object.freeze(character.bondTokenList.map(token => Object.freeze({ status: nonNegative(token.status, "bond token status") }))),
            ...(rarity === undefined ? {} : { rarity }),
        })]
    }))
    const rawUnlockedNodes = requirements.manaNodes ? getPlayerCharactersManaNodesSync(validPlayerId) : {}
    const unlockedNodes = Object.fromEntries(Object.entries(rawUnlockedNodes).map(([characterId, nodes]) => {
        canonicalPositiveId(characterId, "stored mana character id")
        if (!Array.isArray(nodes)) throw new TypeError(`Invalid Active Mission stored mana nodes ${characterId}.`)
        return [characterId, Object.freeze(nodes.map(nodeId => positive(nodeId, "stored mana node id")))]
    }))
    const mana = requirements.manaNodes ? manaDefinitions(repository, characterIds) : { boards: {}, slots: {} }
    const equipmentMaster = requirements.equipment ? readRequiredRepositoryRecord(repository, "equipment_dissolve.json") : {}
    if (requirements.equipment) validateEquipmentTable(equipmentMaster)
    const equipment = Object.entries(requirements.equipment ? getPlayerEquipmentListSync(validPlayerId) : {}).map(([id, item]) => {
        canonicalPositiveId(id, "stored equipment id")
        const master = record(equipmentMaster[id], `equipment ${id}`)
        return Object.freeze({ level: positive(item.level, "equipment level"), maxLevel: positive(master.max_level, "equipment max level"), enhancementLevel: nonNegative(item.enhancementLevel, "equipment enhancement level") })
    })
    const purchases = requirements.purchases ? getPlayerShopPurchasesMapSync(validPlayerId) : {}
    const purchaseIds = requirements.purchases ? purchaseItemIds(repository) : { treasure: new Set<string>(), boss: new Set<string>(), bossEquipment: new Set<string>() }
    const counters = requirements.counters ? getActiveMissionCountersSync(validPlayerId) : EMPTY_COUNTERS
    const clears = requirements.leaderClears ? getPlayerCharacterClearsSync(validPlayerId) : {}
    const leaderClearCounts = Object.fromEntries(Object.entries(clears).map(([id, value]) => [id, Object.freeze({ all: nonNegative(value.leader_clear_count, "leader clear count"), multi: nonNegative(value.leader_multi_count, "leader multi count") })]))
    const partyAbilitySoulCount = Object.values(requirements.party ? getPlayerPartyGroupListSync(validPlayerId) : {}).reduce((total, group) => Object.values(group.list).reduce((inner, party) => {
        if (!Array.isArray(party.abilitySoulIds)) throw new TypeError("Invalid Active Mission party ability souls.")
        const count = party.abilitySoulIds.filter(id => {
            if (id === null || id === undefined) return false
            positive(id, "party ability soul id")
            return true
        }).length
        return safeAdd(inner, count, "party ability soul count")
    }, total), 0)
    return Object.freeze({
        player: Object.freeze({ totalLoginDays: nonNegative(player.totalLoginDays, "total login days"), totalStaminaUsed: nonNegative(player.totalStaminaUsed, "total stamina used") }),
        battleCounters: requirements.battleCounters ? getMissionBattleCountersSync(validPlayerId) : EMPTY_BATTLE_COUNTERS,
        finishedQuestIds,
        questProgress,
        chapterQuestIds: requirements.chapterQuests ? chapterQuestIds(repository) : {},
        practiceQuestChallengeCount: requirements.practiceCounter ? getActiveMissionPracticeQuestChallengeCountSync(validPlayerId) : 0,
        leaderClearCounts,
        conditionalBattleFacts: requirements.conditionalBattleFacts ? getActiveMissionConditionalBattleFactsSync(validPlayerId) : {},
        loadoutBattleFacts: requirements.loadoutBattleFacts ? getActiveMissionBattleFactsSync(validPlayerId) : {},
        characterStoryQuestIds: requirements.characterStories ? characterStoryIds(repository, characterIds) : {},
        characters,
        equipment: Object.freeze(equipment),
        manaNodes: unlockedNodes,
        manaBoardNodes: mana.boards,
        manaNodeSlots: mana.slots,
        partyAbilitySoulCount,
        treasureShopPurchaseCount: countPurchases(purchases, purchaseIds.treasure, "treasure purchases"),
        bossCoinShopPurchaseCount: countPurchases(purchases, purchaseIds.boss, "boss coin purchases"),
        bossCoinEquipmentShopPurchaseCount: countPurchases(purchases, purchaseIds.bossEquipment, "boss coin equipment purchases"),
        ...counters,
    })
}
