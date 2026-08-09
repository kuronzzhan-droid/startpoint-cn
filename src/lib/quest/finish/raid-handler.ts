import { RushEventBattleType } from "../../../data/types"
import { QuestCategory } from "../../types"
import {
    getRaidEventGlobalBossSync,
    getRaidEventQuestKillCountSync,
    recordRaidEventClearSync,
} from "../../raidEventGlobal"

export interface RaidEventFinishData {
    auto_start_point: number
    is_out_of_period: boolean
    quest_boss: {
        kill_count: number
    }
    raid_boss: {
        hp_percentage: number
        total_kill_count: number
    }
}

export function handleRaidEventFinish(params: {
    questCategory: number
    questAccomplished: boolean
    activeEventId: number | undefined
    playId: string
    party: { characters: ({ id: number | null } | null)[], unison_characters: ({ id: number | null } | null)[], equipments: ({ id: number | null } | null)[], ability_soul_ids: (number | null)[] }
    playerId: number
    questId: number
    getEvoLevelsFn: (playerId: number, charIds: (number | null)[]) => (number | null)[]
    insertPartyFn: (playerId: number, eventId: number, partyData: {
        characterIds: (number | null)[]
        unisonCharacterIds: (number | null)[]
        equipmentIds: (number | null)[]
        abilitySoulIds: (number | null)[]
        evolutionImgLevels: (number | null)[]
        unisonEvolutionImgLevels: (number | null)[]
        battleType: RushEventBattleType
        round: number
    }) => void
}): RaidEventFinishData | null {
    const {
        questCategory,
        questAccomplished,
        activeEventId,
        playId,
        party,
        playerId,
        questId,
        getEvoLevelsFn,
        insertPartyFn,
    } = params

    if (questCategory !== QuestCategory.RAID_EVENT || !activeEventId) return null

    const characterIds = party.characters.map(val => val?.id ?? null)
    const unisonCharacterIds = party.unison_characters.map(val => val?.id ?? null)
    const evolutionImgLevels = getEvoLevelsFn(playerId, characterIds)
    const unisonEvolutionImgLevels = getEvoLevelsFn(playerId, unisonCharacterIds)

    insertPartyFn(playerId, activeEventId, {
        characterIds, unisonCharacterIds,
        equipmentIds: party.equipments.map(val => val?.id ?? null),
        abilitySoulIds: party.ability_soul_ids,
        evolutionImgLevels,
        unisonEvolutionImgLevels,
        battleType: RushEventBattleType.FOLDER,
        round: questId
    })

    let boss = getRaidEventGlobalBossSync(activeEventId)
    let questKillCount = getRaidEventQuestKillCountSync(activeEventId, questId)
    if (questAccomplished) {
        const result = recordRaidEventClearSync({
            eventId: activeEventId,
            playId,
            playerId,
            questId,
        })
        boss = result.boss
        questKillCount = result.questKillCount
        console.log(
            `[RAID] clear: eventId=${activeEventId} questId=${questId} ` +
            `playId=${playId} counted=${result.counted} weight=${result.questWeight} ` +
            `weighted=${boss.weightedKillCount}/${boss.requiredKillCount} ` +
            `hp=${boss.hpPercentage} total=${boss.totalKillCount}`,
        )
    }

    return {
        auto_start_point: 0,
        is_out_of_period: false,
        quest_boss: {
            kill_count: questKillCount,
        },
        raid_boss: {
            hp_percentage: boss.hpPercentage,
            total_kill_count: boss.totalKillCount,
        },
    }
}
