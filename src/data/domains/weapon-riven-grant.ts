import { getPlayerWeaponRivenSync, insertWeaponRivenSync } from "./weaponRiven"
import { getPlayerItemSync, givePlayerItemSync } from "./item"
import { getPlayerOperationReceiptSync, insertPlayerOperationReceiptSync } from "./player-operation-receipt"
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator"
import { getWeaponRivenDismantleReward, weaponRivenRuleSet } from "../../lib/weapon-riven/rules"
import { migrateWeaponRivenAffixes } from "../../lib/weapon-riven/migrate-quality"
import { displayWeaponRivenAffixes } from "../../lib/weapon-riven/display"
import { WeaponRivenAffix, WeaponRivenAutoDismantled, WeaponRivenChanges } from "../../lib/weapon-riven/model"
import { refreshWeaponRivenSettlementDataSync } from "../../lib/weapon-riven/settlement-response"

export interface WeaponRivenGrantResult extends WeaponRivenChanges {
    weapon_riven_granted: number[]
    weapon_riven_auto_dismantled: WeaponRivenAutoDismantled[]
}

/** Common reward entrance: source identity makes both storage and overflow grants idempotent. */
export function grantWeaponRivenSync(
    playerId: number, weaponId: number, affixes: WeaponRivenAffix[], sourceKey: string,
    random: () => number = Math.random,
    format: 1 | 3 = 1,
): WeaponRivenGrantResult {
    return runPersistenceTransactionSync({ domain: "player", playerId, operation: "weapon_riven_grant" }, () => {
        const prior = getPlayerOperationReceiptSync<WeaponRivenGrantResult>(playerId, "weapon_riven_grant", sourceKey)
        if (prior) return refreshWeaponRivenSettlementDataSync(playerId, prior.response)
        if (format === 1 && weaponRivenRuleSet.rules.schema_version === 3) {
            affixes = migrateWeaponRivenAffixes(weaponId, affixes, weaponRivenRuleSet)
            format = 3
        }
        const result: WeaponRivenGrantResult = { weapon_riven_list: {}, weapon_riven_deleted: [],
            weapon_riven_granted: [], weapon_riven_auto_dismantled: [], item_list: {} }
        const itemId = insertWeaponRivenSync(playerId, weaponId, affixes, sourceKey, random, format)
        if (itemId !== null) {
            result.weapon_riven_list[itemId] = getPlayerWeaponRivenSync(playerId, itemId)!
            result.weapon_riven_granted.push(itemId)
            result.item_list[itemId] = 1
        } else {
            const reward = getWeaponRivenDismantleReward(affixes.length, 0)
            if (reward && !Number.isSafeInteger((getPlayerItemSync(playerId, reward.itemId) ?? 0) + reward.amount)) {
                throw new RangeError("Weapon riven dismantle inventory amount exceeds the safe integer range.")
            }
            result.weapon_riven_auto_dismantled.push({ weapon_id: weaponId,
                affixes: displayWeaponRivenAffixes(weaponId, affixes, format),
                rewards: reward ? [[reward.itemId, reward.amount]] : [] })
            if (reward) result.item_list[reward.itemId] = givePlayerItemSync(playerId, reward.itemId, reward.amount)
        }
        insertPlayerOperationReceiptSync({ playerId, operation: "weapon_riven_grant", requestKey: sourceKey, response: result })
        return result
    })
}
