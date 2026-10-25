import { getPlayerCharacterSync } from "../data/domains/character"
import { reconcilePendingExBoostDrawSync } from "../data/domains/ex-boost-pending"

export interface ClientExBoostDrawResult {
    character_id: number
    draw_result: { status_id: number; ability_id_list: number[] }
}

/** Called in load's maintenance transaction. A paid candidate does not require
 * remaining materials, but the native comparison dialog requires the old EX. */
export function prepareExBoostRecoverySync(playerId: number): ClientExBoostDrawResult | null {
    const pending = reconcilePendingExBoostDrawSync(playerId)
    if (!pending) return null
    const character = getPlayerCharacterSync(playerId, pending.characterId)
    if (!character || !character.exBoost) {
        const reason = character ? "previous_ex_missing" : "character_missing"
        console.warn(`[EX-BOOST-RECOVERY] pending retained player=${playerId} draw=${pending.drawId}`
            + ` character=${pending.characterId} reason=${reason}`)
        return null
    }
    return { character_id: pending.characterId,
        draw_result: { status_id: pending.statusId, ability_id_list: [...pending.abilityIdList] } }
}
