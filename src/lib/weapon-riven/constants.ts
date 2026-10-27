import rules from "../../../assets/weapon_riven_rules.json"

export const UNKNOWN_RIVEN_ITEM_ID = 16_000_000
export const FIRST_RIVEN_ITEM_ID = 16_000_001
export const LAST_RIVEN_ITEM_ID = 16_000_200
export const LAST_RESERVED_RIVEN_ITEM_ID = 16_000_999
export const MAX_WEAPON_RIVENS = rules.items.holding_limit
export const WEAPON_RIVEN_CURRENCY_ITEM_ID = 2_370_099
export const WEAPON_RIVEN_FRAGMENT_ITEM_ID = 16_000_900
/** Themed unknown rivens (16000901 spirit beast, 16000902 abyss, ...) share one reserved block. */
export const FIRST_THEMED_UNKNOWN_RIVEN_ITEM_ID = 16_000_901
export const LAST_THEMED_UNKNOWN_RIVEN_ITEM_ID = 16_000_919

/** The reserved block is never an instance, configured or not. */
export function isThemedUnknownRivenBlockId(itemId: unknown): itemId is number {
    return typeof itemId === "number" && Number.isSafeInteger(itemId)
        && itemId >= FIRST_THEMED_UNKNOWN_RIVEN_ITEM_ID && itemId <= LAST_THEMED_UNKNOWN_RIVEN_ITEM_ID
}

/** Configured themes only; an unconfigured reserved ID is an inert ordinary item. */
export const THEMED_UNKNOWN_RIVEN_ITEM_IDS: readonly number[] = Object.freeze(
    ((rules as { themes?: { item_id: number }[] }).themes ?? []).map(theme => theme.item_id)
        .filter(isThemedUnknownRivenBlockId))

/** Every stackable card that a five-boss clear reveals into an instance. */
export const UNKNOWN_RIVEN_ITEM_IDS: readonly number[] = Object.freeze([UNKNOWN_RIVEN_ITEM_ID, ...THEMED_UNKNOWN_RIVEN_ITEM_IDS])

export function isUnknownWeaponRivenItemId(itemId: unknown): itemId is number {
    return itemId === UNKNOWN_RIVEN_ITEM_ID || (typeof itemId === "number" && THEMED_UNKNOWN_RIVEN_ITEM_IDS.includes(itemId))
}

/** Reserved instance slots exclude the fragment material and the themed unknown block. */
export function isWeaponRivenItemId(itemId: unknown): itemId is number {
    return typeof itemId === "number" && Number.isSafeInteger(itemId)
        && itemId >= FIRST_RIVEN_ITEM_ID && itemId <= LAST_RESERVED_RIVEN_ITEM_ID
        && itemId !== WEAPON_RIVEN_FRAGMENT_ITEM_ID && !isThemedUnknownRivenBlockId(itemId)
}
