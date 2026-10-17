import { getDb } from "../../data/db"
import { PartyCategory } from "../../data/types"
import { serverCharacters } from "../../lib/content-master"
import { parseGlobalPartyId } from "../../lib/special-event-parties"
import {
    cloneQuestNpcPartySnapshot,
    isQuestNpcPartyPoolEligibleCategory,
    QUEST_NPC_POOL_MIN_POWER,
    QuestNpcPartySnapshot,
} from "./quest-party-pool-shared"

function wireId(option: any, field?: string): number | null | undefined {
    if (!Array.isArray(option)) return undefined
    if (option[0] === 1 && option.length === 1) return null
    if (option[0] !== 0 || option.length !== 2) return undefined
    const id = field ? option[1]?.[field] : option[1]
    return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

/** Capture before BATTLE, never reconstruct a clear from the mutable saved SET. */
export function captureQuestNpcPartySnapshot(
    playerId: number,
    questCategory: number,
    questId: number,
    partySlot: number,
    party: any,
): QuestNpcPartySnapshot | null {
    const selected = parseGlobalPartyId(partySlot)
    if (!selected || !isQuestNpcPartyPoolEligibleCategory(questCategory) || !party) return null
    const fields = [
        ["characters", "character_id", "id"],
        ["unison_characters", "unison_character", "id"],
        ["equipments", "equipment", "equipmentId"],
        ["abilitySoulIds", "ability_soul", undefined],
    ] as const
    if (fields.some(([field]) => !Array.isArray(party[field]) || party[field].length !== 3)) return null
    const saved = getDb().prepare(`
        SELECT character_id_1, character_id_2, character_id_3,
            unison_character_1, unison_character_2, unison_character_3,
            equipment_1, equipment_2, equipment_3,
            ability_soul_1, ability_soul_2, ability_soul_3, current_battle_power
        FROM players_parties
        WHERE player_id = ? AND category = ? AND group_id = ? AND slot = ?
        LIMIT 1
    `).get(playerId, PartyCategory.NORMAL, selected.groupId, selected.slot) as Record<string, number | null> | undefined
    const battlePower = Number(saved?.current_battle_power)
    if (!saved || !Number.isFinite(battlePower) || battlePower < QUEST_NPC_POOL_MIN_POWER) return null
    const characterIds: number[] = []
    for (const [field, column, idField] of fields) {
        for (let slot = 0; slot < 3; slot++) {
            const id = wireId(party[field][slot], idField)
            const savedId = saved[`${column}_${slot + 1}`] || null
            if (id === undefined || id !== savedId || (field === "characters" && id === null)) return null
            if (id !== null && (field === "characters" || field === "unison_characters")) characterIds.push(id)
        }
    }
    const elements = characterIds.map(id =>
        (serverCharacters as Record<string, { element?: number }>)[String(id)]?.element)
    const partyElement = elements.every(element => Number.isInteger(element) && element === elements[0])
        ? Number(elements[0]) : null
    return cloneQuestNpcPartySnapshot({
        questCategory, questId, sourcePlayerId: playerId, partySlot, battlePower,
        partyElement, clearedAt: 0, party,
    })!
}
