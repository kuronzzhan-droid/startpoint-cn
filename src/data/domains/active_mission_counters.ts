import { getDb } from "../db"

export interface ActiveMissionCounters {
    totalUsedManaCount: number
    totalGachaCharacterCount: number
    totalEquipmentEquipCount: number
    totalUnisonSetCount: number
    totalPartyCharacterSetCount: number
    totalInjectedExpCount: number
    totalGachaCampaignCount: number
}

export interface ActiveMissionPartyActionCounts {
    equipmentEquipCount?: number
    unisonSetCount?: number
    partyCharacterSetCount?: number
}

type CounterColumn =
    | "total_used_mana_count"
    | "total_gacha_character_count"
    | "total_injected_exp_count"
    | "total_gacha_campaign_count"
    | "practice_quest_challenge_count"

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

function optionalCounter(value: unknown, name: string): number {
    if (value === undefined) return 0
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`)
    }
    return value
}

function storedCounter(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} is not a finite number`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} is not a non-negative safe integer`)
    }
    return value
}

function incrementCounter(playerId: number, column: CounterColumn, amount: number): void {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validAmount = positiveSafeInteger(amount, "amount")
    const result = getDb().prepare(`
        INSERT INTO players_active_mission_counters (player_id, ${column})
        VALUES (?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
            ${column} = ${column} + excluded.${column}
        WHERE typeof(${column}) = 'integer'
          AND ${column} >= 0
          AND ${column} <= ?
    `).run(validPlayerId, validAmount, Number.MAX_SAFE_INTEGER - validAmount)
    if (result.changes !== 1) {
        throw new RangeError(`${column} cannot be incremented safely`)
    }
}

export function getActiveMissionCountersSync(playerId: number): ActiveMissionCounters {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const row = getDb().prepare(`
        SELECT total_used_mana_count, total_gacha_character_count,
               total_equipment_equip_count, total_unison_set_count,
               total_party_character_set_count, total_injected_exp_count,
               total_gacha_campaign_count
        FROM players_active_mission_counters
        WHERE player_id = ?
    `).get(validPlayerId) as Record<string, unknown> | undefined
    if (row === undefined) {
        return {
            totalUsedManaCount: 0,
            totalGachaCharacterCount: 0,
            totalEquipmentEquipCount: 0,
            totalUnisonSetCount: 0,
            totalPartyCharacterSetCount: 0,
            totalInjectedExpCount: 0,
            totalGachaCampaignCount: 0,
        }
    }
    return {
        totalUsedManaCount: storedCounter(row.total_used_mana_count, "totalUsedManaCount"),
        totalGachaCharacterCount: storedCounter(row.total_gacha_character_count, "totalGachaCharacterCount"),
        totalEquipmentEquipCount: storedCounter(row.total_equipment_equip_count, "totalEquipmentEquipCount"),
        totalUnisonSetCount: storedCounter(row.total_unison_set_count, "totalUnisonSetCount"),
        totalPartyCharacterSetCount: storedCounter(row.total_party_character_set_count, "totalPartyCharacterSetCount"),
        totalInjectedExpCount: storedCounter(row.total_injected_exp_count, "totalInjectedExpCount"),
        totalGachaCampaignCount: storedCounter(row.total_gacha_campaign_count, "totalGachaCampaignCount"),
    }
}

export function incrementActiveMissionUsedManaCountSync(playerId: number, amount: number): void {
    incrementCounter(playerId, "total_used_mana_count", amount)
}

export function incrementActiveMissionGachaCharacterCountSync(playerId: number, amount: number): void {
    incrementCounter(playerId, "total_gacha_character_count", amount)
}

export function incrementActiveMissionPartyActionCountsSync(
    playerId: number,
    counts: ActiveMissionPartyActionCounts,
): void {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    if (typeof counts !== "object" || counts === null || Array.isArray(counts)) {
        throw new TypeError("counts must be an object")
    }
    const equipment = optionalCounter(counts.equipmentEquipCount, "equipmentEquipCount")
    const unison = optionalCounter(counts.unisonSetCount, "unisonSetCount")
    const party = optionalCounter(counts.partyCharacterSetCount, "partyCharacterSetCount")
    if (equipment === 0 && unison === 0 && party === 0) return

    const result = getDb().prepare(`
        INSERT INTO players_active_mission_counters (
            player_id, total_equipment_equip_count,
            total_unison_set_count, total_party_character_set_count
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
            total_equipment_equip_count = total_equipment_equip_count + excluded.total_equipment_equip_count,
            total_unison_set_count = total_unison_set_count + excluded.total_unison_set_count,
            total_party_character_set_count = total_party_character_set_count + excluded.total_party_character_set_count
        WHERE typeof(total_equipment_equip_count) = 'integer'
          AND typeof(total_unison_set_count) = 'integer'
          AND typeof(total_party_character_set_count) = 'integer'
          AND total_equipment_equip_count BETWEEN 0 AND ?
          AND total_unison_set_count BETWEEN 0 AND ?
          AND total_party_character_set_count BETWEEN 0 AND ?
    `).run(
        validPlayerId,
        equipment,
        unison,
        party,
        Number.MAX_SAFE_INTEGER - equipment,
        Number.MAX_SAFE_INTEGER - unison,
        Number.MAX_SAFE_INTEGER - party,
    )
    if (result.changes !== 1) {
        throw new RangeError("party action counters cannot be incremented safely")
    }
}

export function incrementActiveMissionInjectedExpCountSync(playerId: number): void {
    incrementCounter(playerId, "total_injected_exp_count", 1)
}

export function incrementActiveMissionGachaCampaignCountSync(playerId: number): void {
    incrementCounter(playerId, "total_gacha_campaign_count", 1)
}

export function getActiveMissionPracticeQuestChallengeCountSync(playerId: number): number {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const row = getDb().prepare(`
        SELECT practice_quest_challenge_count
        FROM players_active_mission_counters
        WHERE player_id = ?
    `).get(validPlayerId) as { practice_quest_challenge_count: unknown } | undefined
    return row === undefined
        ? 0
        : storedCounter(row.practice_quest_challenge_count, "practiceQuestChallengeCount")
}

export function incrementActiveMissionPracticeQuestChallengeCountSync(playerId: number): void {
    incrementCounter(playerId, "practice_quest_challenge_count", 1)
}
