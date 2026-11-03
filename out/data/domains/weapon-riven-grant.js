"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantWeaponRivenSync = void 0;
const weaponRiven_1 = require("./weaponRiven");
const item_1 = require("./item");
const player_operation_receipt_1 = require("./player-operation-receipt");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const rules_1 = require("../../lib/weapon-riven/rules");
const migrate_quality_1 = require("../../lib/weapon-riven/migrate-quality");
const display_1 = require("../../lib/weapon-riven/display");
const settlement_response_1 = require("../../lib/weapon-riven/settlement-response");
/** Common reward entrance: source identity makes both storage and overflow grants idempotent. */
function grantWeaponRivenSync(playerId, weaponId, affixes, sourceKey, random = Math.random, format = 1) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "weapon_riven_grant" }, () => {
        var _a;
        const prior = (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, "weapon_riven_grant", sourceKey);
        if (prior)
            return (0, settlement_response_1.refreshWeaponRivenSettlementDataSync)(playerId, prior.response);
        if (format === 1 && rules_1.weaponRivenRuleSet.rules.schema_version === 3) {
            affixes = (0, migrate_quality_1.migrateWeaponRivenAffixes)(weaponId, affixes, rules_1.weaponRivenRuleSet);
            format = 3;
        }
        const result = { weapon_riven_list: {}, weapon_riven_deleted: [],
            weapon_riven_granted: [], weapon_riven_auto_dismantled: [], item_list: {} };
        const itemId = (0, weaponRiven_1.insertWeaponRivenSync)(playerId, weaponId, affixes, sourceKey, random, format);
        if (itemId !== null) {
            result.weapon_riven_list[itemId] = (0, weaponRiven_1.getPlayerWeaponRivenSync)(playerId, itemId);
            result.weapon_riven_granted.push(itemId);
            result.item_list[itemId] = 1;
        }
        else {
            const reward = (0, rules_1.getWeaponRivenDismantleReward)(affixes.length, 0);
            if (reward && !Number.isSafeInteger(((_a = (0, item_1.getPlayerItemSync)(playerId, reward.itemId)) !== null && _a !== void 0 ? _a : 0) + reward.amount)) {
                throw new RangeError("Weapon riven dismantle inventory amount exceeds the safe integer range.");
            }
            result.weapon_riven_auto_dismantled.push({ weapon_id: weaponId,
                affixes: (0, display_1.displayWeaponRivenAffixes)(weaponId, affixes, format),
                rewards: reward ? [[reward.itemId, reward.amount]] : [] });
            if (reward)
                result.item_list[reward.itemId] = (0, item_1.givePlayerItemSync)(playerId, reward.itemId, reward.amount);
        }
        (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({ playerId, operation: "weapon_riven_grant", requestKey: sourceKey, response: result });
        return result;
    });
}
exports.grantWeaponRivenSync = grantWeaponRivenSync;
