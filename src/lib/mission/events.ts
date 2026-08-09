export interface BattleStatisticsSummary {
    dashCount: number
    powerFlipCount: number
    powerFlipLv3Count: number
    skillCount: number
    maxComboCount: number
    maxSkillChainCount: number
    feverCount: number
    feverTimeMs: number
    weakenEnemyCount: number
    clearEnemyBuffCount: number
    clearSelfDebuffCount: number
    buffCompanionCount: number
    healCompanionCount: number
    emotionCount: number
    enemyKillCount: number
    weakPointDestroyCount: number
    coffinReduceCount: number
    clearPhase?: number
}

export interface BattleFinishMissionEvent {
    type: "battle_finish"
    playerId: number
    questCategory: number
    questId: number
    accomplished: boolean
    mode: "single" | "multi"
    role?: "host" | "guest"
    isRescue?: boolean
    isNewbieRescue?: boolean
    isMvp?: boolean
    clearRank?: number | null
    clearTimeMs: number
    partyCharacterIds: number[]
    leaderCharacterId?: number
    unisonCharacterIds: number[]
    statistics: BattleStatisticsSummary
}

export type MissionProgressEvent = BattleFinishMissionEvent

function parseNonNegativeStat(value: any): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function parseOptionalNonNegativeStat(value: any): number | undefined {
    if (value === undefined || value === null) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function parsePositiveId(value: any): number | undefined {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function firstPresentStat(records: readonly any[], names: readonly string[]): number | undefined {
    for (const record of records) {
        for (const name of names) {
            if (record?.[name] === undefined || record?.[name] === null) continue
            return parseNonNegativeStat(record[name])
        }
    }
    return undefined
}

function sumZoneStat(zones: readonly any[], names: readonly string[]): number {
    return zones.reduce((total, zone) => (
        total + (firstPresentStat([zone], names) ?? 0)
    ), 0)
}

function rootOrZoneStat(raw: any, zones: readonly any[], names: readonly string[]): number {
    return firstPresentStat([raw], names) ?? sumZoneStat(zones, names)
}

export function summarizeBattleStatistics(raw: any): BattleStatisticsSummary {
    const zones = Array.isArray(raw?.zones) ? raw.zones : []
    return {
        dashCount: rootOrZoneStat(raw, zones, ["use_dash_count"]),
        powerFlipCount: rootOrZoneStat(raw, zones, ["use_power_flip_count"]),
        powerFlipLv3Count: rootOrZoneStat(raw, zones, ["use_power_flip_lv3_count"]),
        skillCount: rootOrZoneStat(raw, zones, ["use_skill_count", "skill_count"]),
        maxComboCount: parseNonNegativeStat(raw?.max_combo_count),
        maxSkillChainCount: rootOrZoneStat(raw, zones, ["max_skill_chain_count"]),
        feverCount: rootOrZoneStat(raw, zones, ["fever_count"]),
        feverTimeMs: rootOrZoneStat(raw, zones, ["fever_ms"]),
        weakenEnemyCount: rootOrZoneStat(raw, zones, ["use_debuff_to_enemy_count"]),
        clearEnemyBuffCount: rootOrZoneStat(raw, zones, ["clear_buff_of_enemy_count"]),
        clearSelfDebuffCount: rootOrZoneStat(raw, zones, ["clear_debuff_of_self_count"]),
        buffCompanionCount: rootOrZoneStat(raw, zones, ["use_buff_to_all_party_members"]),
        healCompanionCount: rootOrZoneStat(raw, zones, ["use_heal_to_all_party_members"]),
        emotionCount: rootOrZoneStat(raw, zones, ["use_emotion_count", "send_emotion_count"]),
        enemyKillCount: rootOrZoneStat(raw, zones, ["enemy_kill_count"]),
        weakPointDestroyCount: rootOrZoneStat(raw, zones, ["weak_point_attack_count"]),
        coffinReduceCount: rootOrZoneStat(raw, zones, ["coffin_count_reduced_count"]),
        clearPhase: parseOptionalNonNegativeStat(raw?.clear_phase),
    }
}

export function collectPartyCharacterIds(party: any): { partyCharacterIds: number[]; leaderCharacterId?: number; unisonCharacterIds: number[] } {
    const characters = Array.isArray(party?.characters) ? party.characters : []
    const unisons = Array.isArray(party?.unison_characters) ? party.unison_characters : []
    const partyCharacterIds = characters.map((c: any) => parsePositiveId(c?.id)).filter((id: number | undefined): id is number => id !== undefined)
    const unisonCharacterIds = unisons.map((c: any) => parsePositiveId(c?.id)).filter((id: number | undefined): id is number => id !== undefined)
    const leaderCharacterId = parsePositiveId(characters[0]?.id)
    return { partyCharacterIds, leaderCharacterId, unisonCharacterIds }
}
