interface BattleBoostBalances {
    boostPoint: number
    bossBoostPoint: number
}

interface BattleBoostSelection {
    useBoostPoint?: boolean
    useBossBoostPoint?: boolean
}

/** Resolve spending from the fresh balances inside the settlement transaction. */
export function settleBattleBoostPoints(balances: BattleBoostBalances, selection: BattleBoostSelection) {
    if (!Number.isSafeInteger(balances.boostPoint) || !Number.isSafeInteger(balances.bossBoostPoint)) {
        throw new Error("Invalid battle boost balance.")
    }
    // Older settlements could leave debt even though boost points are optional.
    const normal = Math.max(0, balances.boostPoint)
    const boss = Math.max(0, balances.bossBoostPoint)
    const normalUsed = selection.useBoostPoint === true && normal > 0
    const bossUsed = selection.useBossBoostPoint === true && boss > 0
    return {
        boostPoint: normal - (normalUsed ? 1 : 0),
        bossBoostPoint: boss - (bossUsed ? 1 : 0),
        useBoostPoint: normalUsed || bossUsed,
    }
}
