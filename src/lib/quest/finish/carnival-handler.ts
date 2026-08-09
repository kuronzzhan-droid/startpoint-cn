import { QuestCategory } from "../../types"

interface CarnivalEventData {
    is_record_valid: boolean
    leader_character_id: number
    new_degree_ids: number[]
    previous_total_best_score: number
    reward_ids: number[]
    score: { difficulty_bonus: number, time_bonus: number }
}

interface CarnivalEventRecord {
    folderId: number
    bestScore: number | null
}

export function handleCarnivalEventFinish(params: {
    questCategory: number
    questAccomplished: boolean
    questId: number
    battleScore: number
    clearTime: number
    party: { characters: ({ id: number | null } | null)[], unison_characters: ({ id: number | null } | null)[], leader?: { id: number | null } | null }
    playerId: number
    carnivalLookup: Record<string, { difficulty_score: number, time_limit_ms: number, folder_id: number, event_id: number }>
    getRecordsFn: (playerId: number, eventId: number) => CarnivalEventRecord[]
    upsertFn: (playerId: number, eventId: number, folderId: number, score: number, chars: (number | null)[], unisons: (number | null)[]) => void
}): CarnivalEventData | null {
    const { questCategory, questAccomplished, questId, battleScore, clearTime, party, playerId, carnivalLookup, getRecordsFn, upsertFn } = params

    if (questCategory !== QuestCategory.CARNIVAL_EVENT || !questAccomplished) return null

    const carnivalInfo = carnivalLookup[String(questId)]
    if (!carnivalInfo) return null

    const characterIds = party.characters.map(v => v?.id ?? null)
    const unisonCharacterIds = party.unison_characters.map(v => v?.id ?? null)
    // Some clients omit party.leader from the finish payload. The result
    // dialog still requires a valid character id, so fall back to the first
    // main character instead of returning the invalid master-data key 0.
    const leaderCharId = party.leader?.id ?? characterIds.find(id => id !== null) ?? 0

    const difficultyBonus = carnivalInfo.difficulty_score * 100
    const timeBonus = Math.max(0, carnivalInfo.time_limit_ms - clearTime)
    // body.score is the main battle score shown by the result screen.  The
    // server previously stored only the two bonuses, which is why a result
    // such as 3,537,913 appeared as 49,913 on the event graph.
    const totalScore = Math.max(0, battleScore) + difficultyBonus + timeBonus

    // Every Haniwa Carnival folder has three difficulty quests.  Older
    // extracted lookups exposed quest slots 1..9 as folder ids, while the
    // client graph expects those slots grouped into folders 1..3.  Derive the
    // stable folder id from the quest suffix so all six elemental events use
    // the same mapping, regardless of which lookup revision is installed.
    const questSlot = Math.abs(questId) % 1000
    const folderId = questSlot >= 1 && questSlot <= 9
        ? Math.floor((questSlot - 1) / 3) + 1
        : carnivalInfo.folder_id

    const existingRecords = getRecordsFn(playerId, carnivalInfo.event_id)
    const previousTotalBestScore = existingRecords.reduce((sum, record) => sum + (record.bestScore ?? 0), 0)
    const existingFolderRecord = existingRecords.find(record => record.folderId === folderId)
    const isNewBestScore = totalScore > (existingFolderRecord?.bestScore ?? 0)

    upsertFn(playerId, carnivalInfo.event_id, folderId, totalScore, characterIds, unisonCharacterIds)

    return {
        is_record_valid: true,
        leader_character_id: leaderCharId,
        new_degree_ids: [],
        previous_total_best_score: previousTotalBestScore,
        // The client uses a non-empty list as the signal to refresh the
        // carnival total-score presentation. The concrete ids are opaque to
        // that flow; the improved folder id is stable and unique per event.
        reward_ids: isNewBestScore && leaderCharId > 0 ? [folderId] : [],
        score: { difficulty_bonus: difficultyBonus, time_bonus: timeBonus }
    }
}
