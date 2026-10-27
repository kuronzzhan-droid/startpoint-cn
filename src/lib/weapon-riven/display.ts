import { WeaponRivenAffix, WeaponRivenDisplayAffix } from "./model"
import { getWeaponRivenAffixCapLevel, getWeaponRivenDisposition, weaponRivenRuleSet, weaponRivenValueToLevel, WeaponRivenRuleSet } from "./rules"
import { weaponRivenAffixBudget, validateWeaponRivenQualities } from "./quality"

/** Stored cards, pending choices and overflow rewards share the same display encoding. */
export function displayWeaponRivenAffixes(
    weaponId: number, affixes: WeaponRivenAffix[], format: 1 | 3 = 1,
    configuration: WeaponRivenRuleSet = weaponRivenRuleSet,
): WeaponRivenDisplayAffix[] {
    if (format === 3) validateWeaponRivenQualities(affixes)
    return affixes.map(([key, stored]) => {
        const definition = configuration.affixes.affixes.find(row => row.key === key)
        if (format === 3 && !definition) throw new Error(`Missing historical weapon riven affix key ${key}`)
        const level = format === 1 ? stored : weaponRivenValueToLevel(
            weaponRivenAffixBudget(definition!, affixes, getWeaponRivenDisposition(weaponId, configuration), configuration, stored),
        definition!.lo, definition!.hi)
        // Clients built before contract v1.2 only parse [key, level] pairs.
        const cap = process.env.WEAPON_RIVEN_LEGACY_AFFIX_PAIRS === "1" ? undefined : getWeaponRivenAffixCapLevel(weaponId, key, configuration, affixes)
        return cap === undefined ? [key, level] : [key, level, cap]
    })
}
