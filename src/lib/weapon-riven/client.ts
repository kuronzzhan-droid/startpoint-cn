import { isWeaponRivenItemId } from "./constants"

/** Reserved instance IDs are player-local; unknown and fragment materials are not. */
export function isWeaponRivenInstanceId(value: unknown): value is number {
    return isWeaponRivenItemId(value)
}

export function stripWeaponRivenSoulSlots<T>(slots: readonly T[]): (T | null | number[])[] {
    return slots.map(slot => {
        if (isWeaponRivenInstanceId(slot)) return null
        if (Array.isArray(slot) && slot[0] === 0 && isWeaponRivenInstanceId(slot[1])) return [1]
        return slot
    })
}

const SOUL_ARRAY_FIELDS = new Set(["abilitySoulIds", "ability_soul_ids"])
const RIVEN_FIELDS = new Set(["user_weapon_riven_list", "weapon_riven_list", "weapon_riven_deleted", "weapon_riven_granted", "weapon_riven_auto_dismantled"])

/** Copy only changed branches; never change saved SETs or a frozen battle snapshot. */
function project(value: any, legacy: boolean): any {
    if (!value || typeof value !== "object") return value
    if (Array.isArray(value)) {
        const result = value.map(entry => project(entry, legacy))
        return result.some((entry, index) => entry !== value[index]) ? result : value
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value
    let result: Record<string, any> | undefined
    for (const [key, entry] of Object.entries(value)) {
        if (legacy && RIVEN_FIELDS.has(key)) {
            result ??= { ...value }
            delete result![key]
            continue
        }
        let next: any
        if (SOUL_ARRAY_FIELDS.has(key) && Array.isArray(entry)) {
            const slots = stripWeaponRivenSoulSlots(entry)
            next = slots.some((slot, index) => slot !== entry[index]) ? slots : entry
        } else if (/^ability_soul_id_[123]$/.test(key) && isWeaponRivenInstanceId(entry)) {
            next = null
        } else if (legacy && key === "item_list" && entry && typeof entry === "object") {
            next = Object.fromEntries(Object.entries(entry).filter(([id]) => !isWeaponRivenInstanceId(Number(id))))
        } else next = project(entry, legacy)
        if (next !== entry) {
            result ??= { ...value }
            result![key] = next
        }
    }
    return result ?? value
}

/** Public parties and all P1 room wire parties have no player-local instance souls. */
export function stripWeaponRivenPartySouls<T>(value: T): T {
    return project(value, false)
}

/** Apply before MessagePack/worker encoding, including responses other than /load. */
export function projectWeaponRivenClientResponse<T>(value: T, capable: boolean): T {
    return capable ? value : project(value, true)
}

export function projectWeaponRivenLoad<T extends { item_list?: unknown }>(
    data: T,
    rivens: Record<string, unknown>,
    capable: boolean,
): T {
    if (!capable) return projectWeaponRivenClientResponse(data, false)
    // Ignore stale or injected instance entries from players_items; instances exist only in their own table.
    const items = Object.fromEntries(Object.entries(data.item_list ?? {})
        .filter(([id]) => !isWeaponRivenInstanceId(Number(id))))
    for (const id of Object.keys(rivens)) if (isWeaponRivenInstanceId(Number(id))) items[id] = 1
    return { ...data, item_list: items, user_weapon_riven_list: rivens }
}

/** Preserve hidden instances only for empty legacy submissions; explicit replacements win. */
export function protectWeaponRivenPartySave(
    requested: readonly (number | null)[],
    previous: readonly (number | null)[],
    capable: boolean,
    ownsInstance: (itemId: number) => boolean,
): (number | null)[] {
    return [0, 1, 2].map(index => {
        const old = previous[index] ?? null
        const next = requested[index] ?? null
        if (!capable && next === null && isWeaponRivenInstanceId(old) && ownsInstance(old)) return old
        if (isWeaponRivenInstanceId(next) && (!capable || !ownsInstance(next))) return null
        return next
    })
}
