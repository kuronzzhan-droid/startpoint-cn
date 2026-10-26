import equipmentIds from "../../assets/equipment_ids.json"
import { getEquipmentAwakeningRulesSync } from "./assets"
import { resolveEquipmentRarity } from "./equipment-awakening-rules"

const knownEquipmentIds = new Set<number>(equipmentIds)

/** Use client rarity rules only for known master entries. Explicit overrides
 * also cover equipment added after the reward-eligibility catalog was generated.
 * The catalog and overrides are verified against equipment.orderedmap column 11;
 * accepting an arbitrary id's millions digit would invent missing master data. */
export function getEquipmentRaritySync(equipmentId: number): number | null {
    if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0) return null
    const rules = getEquipmentAwakeningRulesSync()
    if (!knownEquipmentIds.has(equipmentId) && !rules.rarityOverrides.has(equipmentId)) return null
    const rarity = resolveEquipmentRarity(rules, equipmentId)
    return Number.isInteger(rarity) && rarity >= 1 && rarity <= 5 ? rarity : null
}
