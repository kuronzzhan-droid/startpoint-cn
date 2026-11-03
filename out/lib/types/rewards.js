"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopItemRewardType = exports.ScoreRewardType = exports.RewardType = void 0;
var RewardType;
(function (RewardType) {
    RewardType[RewardType["ITEM"] = 0] = "ITEM";
    RewardType[RewardType["EQUIPMENT"] = 1] = "EQUIPMENT";
    RewardType[RewardType["CHARACTER"] = 2] = "CHARACTER";
    RewardType[RewardType["BEADS"] = 3] = "BEADS";
    RewardType[RewardType["MANA"] = 4] = "MANA";
    RewardType[RewardType["EXP"] = 5] = "EXP";
    RewardType[RewardType["ELEMENT"] = 6] = "ELEMENT";
    RewardType[RewardType["AETHER"] = 7] = "AETHER";
})(RewardType || (exports.RewardType = RewardType = {}));
var ScoreRewardType;
(function (ScoreRewardType) {
    ScoreRewardType[ScoreRewardType["ITEM"] = 0] = "ITEM";
    ScoreRewardType[ScoreRewardType["RARE_POOL"] = 1] = "RARE_POOL";
})(ScoreRewardType || (exports.ScoreRewardType = ScoreRewardType = {}));
var ShopItemRewardType;
(function (ShopItemRewardType) {
    ShopItemRewardType[ShopItemRewardType["ITEM"] = 0] = "ITEM";
    ShopItemRewardType[ShopItemRewardType["EXP"] = 1] = "EXP";
    ShopItemRewardType[ShopItemRewardType["MANA"] = 2] = "MANA";
    ShopItemRewardType[ShopItemRewardType["CHARACTER"] = 3] = "CHARACTER";
    ShopItemRewardType[ShopItemRewardType["EQUIPMENT"] = 4] = "EQUIPMENT";
    ShopItemRewardType[ShopItemRewardType["DEGREE"] = 5] = "DEGREE";
})(ShopItemRewardType || (exports.ShopItemRewardType = ShopItemRewardType = {}));
