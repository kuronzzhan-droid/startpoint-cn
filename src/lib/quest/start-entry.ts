export interface StartEntryCost {
    readonly itemId: number
    readonly itemCount: number
    readonly stamina: number
}

export interface StartEntryPlayer {
    id: number
    stamina: number
    staminaHealTime: Date
    rankPoint: number
    totalStaminaUsed: number
    partySlot: number
}

export interface StartEntryInput<TActiveQuest> {
    readonly playerId: number
    readonly entryCost?: StartEntryCost
    readonly staminaCost: number
    readonly partyId: number
    readonly updatePartySlot: boolean
    readonly activeQuest: TActiveQuest
    readonly now: Date
}

export interface StartEntryDependencies<TActiveQuest> {
    transaction<T>(operation: () => T): T
    getActiveQuest(playerId: number): unknown | null
    getPlayer(playerId: number): StartEntryPlayer | null
    computeStamina(player: StartEntryPlayer): number
    getItemCount(playerId: number, itemId: number): number | null
    updateItemCount(playerId: number, itemId: number, amount: number): void
    updatePlayer(update: Partial<StartEntryPlayer> & Pick<StartEntryPlayer, "id">): void
    persistActiveQuest(playerId: number, activeQuest: TActiveQuest): void
    afterPersist?(playerId: number): void
    publishActiveQuest(playerId: number, activeQuest: TActiveQuest): void
}

export interface StartEntryResult {
    readonly afterStamina: number
    readonly entryItemId: number | null
    readonly entryItemCount: number | null
}

export class ActiveQuestAlreadyExistsError extends Error {}
export class PlayerNotFoundError extends Error {}

export class InsufficientEntryItemError extends Error {
    constructor(
        public readonly itemId: number,
        public readonly required: number,
        public readonly current: number,
    ) {
        super(`Not enough entry items (need ${required} of ${itemId}, have ${current}).`)
    }
}

export class InsufficientStaminaError extends Error {
    constructor(public readonly required: number, public readonly current: number) {
        super(`Insufficient stamina (need ${required}, have ${current}).`)
    }
}

export function buildStartEntryItemList(
    result: Pick<StartEntryResult, "entryItemId" | "entryItemCount">,
): Record<string, number> {
    return result.entryItemId === null || result.entryItemCount === null
        ? {}
        : { [result.entryItemId]: result.entryItemCount }
}

export function runStartEntryTransaction<TActiveQuest>(
    input: StartEntryInput<TActiveQuest>,
    dependencies: StartEntryDependencies<TActiveQuest>,
): StartEntryResult {
    const result = dependencies.transaction(() => {
        if (dependencies.getActiveQuest(input.playerId) !== null) {
            throw new ActiveQuestAlreadyExistsError(`Player ${input.playerId} already has an active quest.`)
        }
        const player = dependencies.getPlayer(input.playerId)
        if (!player) throw new PlayerNotFoundError(`Player ${input.playerId} does not exist.`)
        const entryCost = input.entryCost && input.entryCost.itemId > 0 && input.entryCost.itemCount > 0
            ? input.entryCost
            : undefined
        const entryItemId = entryCost?.itemId ?? null
        const currentItemCount = entryCost
            ? dependencies.getItemCount(input.playerId, entryCost.itemId) ?? 0
            : null
        const currentStamina = dependencies.computeStamina(player)
        if (entryCost && (currentItemCount ?? 0) < entryCost.itemCount) {
            throw new InsufficientEntryItemError(entryCost.itemId, entryCost.itemCount, currentItemCount ?? 0)
        }
        if (currentStamina < input.staminaCost) {
            throw new InsufficientStaminaError(input.staminaCost, currentStamina)
        }

        const entryItemCount = entryCost ? (currentItemCount ?? 0) - entryCost.itemCount : null
        if (entryItemId !== null) dependencies.updateItemCount(input.playerId, entryItemId, entryItemCount ?? 0)
        const afterStamina = currentStamina - input.staminaCost
        const update: Partial<StartEntryPlayer> & Pick<StartEntryPlayer, "id"> = { id: input.playerId }
        if (input.staminaCost > 0) {
            update.stamina = afterStamina
            update.staminaHealTime = input.now
            update.totalStaminaUsed = player.totalStaminaUsed + input.staminaCost
        }
        if (input.updatePartySlot) update.partySlot = input.partyId
        if (Object.keys(update).length > 1) dependencies.updatePlayer(update)
        dependencies.persistActiveQuest(input.playerId, input.activeQuest)
        dependencies.afterPersist?.(input.playerId)
        return { afterStamina, entryItemId, entryItemCount }
    })
    dependencies.publishActiveQuest(input.playerId, input.activeQuest)
    return result
}
