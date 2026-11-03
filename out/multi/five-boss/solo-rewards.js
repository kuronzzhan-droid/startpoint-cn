"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantFiveBossSoloRewardsSync = void 0;
const item_1 = require("../../data/domains/item");
const equipment_1 = require("../../lib/equipment");
const rewards_1 = require("./rewards");
/**
 * 单人打五重决战(2026-09-05 作者:"单人那还是有奖励")的结算发放。
 *
 * 单人 start/finish 走 singleBattleQuest 的普通领主战链路,不经过 five-boss runtime,
 * 按整轮 AUTO 记录决定模式倍率；单人数量型奖励按多人二分之一向上取整，
 * 图纸、心核和诅咒武器本体使用单人专用概率，首通凭证保持固定奖励口径。
 */
function grantFiveBossSoloRewardsSync(input) {
    var _a, _b, _c, _d;
    const give = (_a = input.givePlayerItemSync) !== null && _a !== void 0 ? _a : item_1.givePlayerItemSync;
    const giveEquipment = (_b = input.givePlayerEquipmentSync) !== null && _b !== void 0 ? _b : equipment_1.givePlayerEquipmentSync;
    const rewardMultiplier = (_c = input.rewardMultiplier) !== null && _c !== void 0 ? _c : 1;
    const plan = (0, rewards_1.buildFiveBossSoloGauntletRewardPlan)({
        firstClear: input.firstClear,
        rewardMultiplier,
        randomFloat: input.randomFloat,
    });
    const items = {};
    const granted = [];
    for (const item of plan.items) {
        if (item.amount <= 0)
            continue;
        items[item.itemId] = give(input.playerId, item.itemId, item.amount);
        granted.push({ itemId: item.itemId, amount: item.amount });
    }
    const weaponPlan = (0, rewards_1.buildFiveBossCursedWeaponDropPlan)({
        rewardMultiplier,
        dropRate: rewards_1.FIVE_BOSS_SOLO_CURSED_WEAPON_DROP_RATE,
        availableEquipmentIds: (_d = input.cursedWeaponPool) !== null && _d !== void 0 ? _d : (0, rewards_1.getFiveBossCursedWeaponPool)(),
        randomFloat: input.randomFloat,
    });
    const latestEquipmentStateById = new Map();
    for (const equipmentId of weaponPlan.equipmentIds) {
        latestEquipmentStateById.set(equipmentId, giveEquipment(input.playerId, equipmentId, 1));
    }
    return {
        items,
        dropAdditionalRewardIds: [
            ...(0, rewards_1.buildFiveBossAdditionalRewardDrops)(granted),
            ...(0, rewards_1.buildFiveBossWeaponAdditionalRewardDrops)(weaponPlan.equipmentIds),
        ],
        granted,
        equipment_list: Array.from(latestEquipmentStateById.values()),
        grantedEquipment: weaponPlan.equipmentIds,
    };
}
exports.grantFiveBossSoloRewardsSync = grantFiveBossSoloRewardsSync;
