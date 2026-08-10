export interface Mode15ActiveQuestOwnership {
    isMulti: boolean
    isMultiHost: boolean
}

/**
 * A stale multiplayer active quest is not proof that the player lost their
 * own Mode15 run. Rescue guests can disappear during loading and leave the
 * same stale record behind, so only the persisted room owner may be reset.
 */
export function shouldResetMode15RunForStaleActiveQuest(
    isMode15: boolean,
    quest: Mode15ActiveQuestOwnership,
): boolean {
    if (!isMode15) return false
    return !quest.isMulti || quest.isMultiHost
}
