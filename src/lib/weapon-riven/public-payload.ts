import { isUnknownWeaponRivenItemId, isWeaponRivenItemId } from "./constants"

const SOUL_ARRAY_FIELDS = new Set(["abilitySoulIds", "ability_soul_ids"])

/** Unknown cards are private too; the fragment material is never an instance. */
function isPrivateSoul(value: unknown): boolean {
    const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
    return isUnknownWeaponRivenItemId(id) || isWeaponRivenItemId(id)
}

function isPrivateField(key: string): boolean {
    return /^(?:user_)?weapon_riven(?:s|_.*)?$/.test(key)
        || /^(?:user)?WeaponRiven/.test(key) || /^weaponRiven/.test(key)
        || key === "conversionLoadout" || key === "riven_loadout_json"
}

function publicSoulSlot(slot: any): any {
    if (isPrivateSoul(slot)) return null
    if (Array.isArray(slot) && slot[0] === 0 && isPrivateSoul(slot[1])) return [1]
    return stripWeaponRivenPublicPayload(slot)
}

/**
 * Public JSON parties never contain private cards, inventory or battle context.
 * Always clone every branch: a COM cache, room mate and original SET must not
 * share mutable objects. Do not use this for real-player disabled battle DTOs
 * or five-boss conversion loadouts, which must retain unknown cards.
 */
export function stripWeaponRivenPublicPayload<T>(value: T): T {
    if (value === null || typeof value !== "object") return value
    if (Array.isArray(value)) return value.map(stripWeaponRivenPublicPayload) as T
    return Object.fromEntries(Object.entries(value).filter(([key]) => !isPrivateField(key)).map(([key, entry]) => {
        if (SOUL_ARRAY_FIELDS.has(key) && Array.isArray(entry)) return [key, entry.map(publicSoulSlot)]
        if (/^ability_soul_id_[123]$/.test(key) && isPrivateSoul(entry)) return [key, null]
        if (key === "item_list" && entry && typeof entry === "object" && !Array.isArray(entry)) {
            return [key, Object.fromEntries(Object.entries(entry).filter(([id]) => !isPrivateSoul(id))
                .map(([id, amount]) => [id, stripWeaponRivenPublicPayload(amount)]))]
        }
        return [key, stripWeaponRivenPublicPayload(entry)]
    })) as T
}
