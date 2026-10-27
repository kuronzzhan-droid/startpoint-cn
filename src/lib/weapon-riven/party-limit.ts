import rules from "../../../assets/weapon_riven_rules.json"
import { isWeaponRivenItemId } from "./constants"

/** One saved party has its own limit; unknown rivens and ordinary souls do not count. */
function maximumRivens(): number {
    const configured = (rules as { max_rivens_per_party?: number }).max_rivens_per_party ?? 1
    return Number.isSafeInteger(configured) && configured > 0 ? configured : 1
}

/**
 * Battle rule (author 2026-10-27 15:17): over the limit, ALL revealed cards in the party are ineffective.
 * Unknown and themed unknown cards never count and stay for conversion. Party edits keep using
 * limitWeaponRivenPartySouls (first card kept, client prompts).
 */
export function stripIneffectiveWeaponRivenSouls(ids: readonly (number | null)[]): (number | null)[] {
    const count = ids.filter(id => isWeaponRivenItemId(id)).length
    return count > maximumRivens() ? ids.map(id => isWeaponRivenItemId(id) ? null : id) : [...ids]
}

export function limitWeaponRivenPartySouls(ids: readonly (number | null)[]): (number | null)[] {
    const maximum = maximumRivens()
    let count = 0
    return ids.map(id => isWeaponRivenItemId(id) && ++count > maximum ? null : id)
}
