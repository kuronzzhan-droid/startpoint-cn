import { WeaponRivenAffix, WeaponRivenRuleSet } from "./rule-types"
import { getWeaponRivenDisposition } from "./rules"
import { weaponRivenAffixBudget } from "./quality"

/** Decode the endpoint table that actually shipped, before translating to v3 quality. */
export function legacyWeaponRivenMagnitude(key: number, level: number, configuration: WeaponRivenRuleSet): number {
    const definition = configuration.affixes.affixes.find(affix => affix.key === key)
    if (!definition) throw new Error(`Missing historical weapon riven affix key ${key}`)
    if (!Number.isInteger(level) || level < 1 || level > 100) throw new Error("Invalid historical weapon riven level")
    const encoding = definition.legacy_encoding ?? definition
    if (encoding.raw_lo !== undefined && encoding.raw_hi !== undefined && encoding.raw_per_unit) {
        const value = Math.round(encoding.raw_lo + (encoding.raw_hi - encoding.raw_lo) * (level - 1) / 99) / encoding.raw_per_unit
        return Math.abs(encoding.resolve_int ? Math.round(value) : value)
    }
    return encoding.lo + (encoding.hi - encoding.lo) * (level - 1) / 99
}

export interface WeaponRivenQualityMigration {
    affix_key: number; old_level: number; old_value: number; new_value: number
    q: number; capped: boolean
}

/** Preserve representable values; old test cards above the v3 budget become perfect quality. */
export function migrateWeaponRivenAffixes(
    weaponId: number, affixes: WeaponRivenAffix[], configuration: WeaponRivenRuleSet,
    onMigrate?: (change: WeaponRivenQualityMigration) => void,
): WeaponRivenAffix[] {
    const disposition = getWeaponRivenDisposition(weaponId, configuration)
    return affixes.map(([key, level]) => {
        const definition = configuration.affixes.affixes.find(affix => affix.key === key)
        if (!definition) throw new Error(`Missing historical weapon riven affix key ${key}`)
        const value = legacyWeaponRivenMagnitude(key, level, configuration)
        const budget = weaponRivenAffixBudget(definition, affixes, disposition, configuration)
        const capped = value > budget
        // Invert the curve only for representable magnitudes; historical penalties may exceed 100%.
        const quality = capped ? 1 : definition.curve === "reciprocal"
            ? (value / (100 - value)) / (budget / (100 - budget)) : value / budget
        if (!Number.isFinite(quality) || quality < 0) {
            throw new Error(`Invalid weapon riven migration budget: weapon=${weaponId}, key=${key}, L=${level}, q=${quality}`)
        }
        const q = Number(Math.min(1, quality).toFixed(6))
        const sign = definition.polarity === "-" ? -1 : 1
        onMigrate?.({affix_key: key, old_level: level, old_value: sign * value,
            new_value: sign * weaponRivenAffixBudget(definition, affixes, disposition, configuration, q), q, capped})
        return [key, q]
    })
}
