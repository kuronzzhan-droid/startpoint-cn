"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMainStoryFirstClearRewards = void 0;
const main_quest_json_1 = __importDefault(require("../../assets/main_quest.json"));
const ex_quest_json_1 = __importDefault(require("../../assets/ex_quest.json"));
const assets_1 = require("./assets");
/** Single-slot client clear rewards show the ticket; retain the replaced stones
 * in the same first-clear settlement, so pre-update partial saves do not gain
 * a second payment via S+ or lose stones via another already-cleared quest. */
function getMainStoryFirstClearRewards(category, questId, quest) {
    var _a, _b, _c;
    const result = quest.clearReward ? [quest.clearReward] : [];
    const table = category === 1 ? main_quest_json_1.default : category === 4 ? ex_quest_json_1.default : undefined;
    const rewardId = (_b = (_a = table === null || table === void 0 ? void 0 : table[questId]) === null || _a === void 0 ? void 0 : _a.clearRewardId) !== null && _b !== void 0 ? _b : 0;
    if (rewardId >= 99035801 && rewardId <= 99035804 && ((_c = quest.clearReward) === null || _c === void 0 ? void 0 : _c.type) === 0 && quest.clearReward.id === 999001) {
        const original = (0, assets_1.getClearRewardSync)(category === 1 ? 1 : 25);
        if (!original)
            throw new Error("Missing original main-story stone reward");
        result.push(original);
    }
    return result;
}
exports.getMainStoryFirstClearRewards = getMainStoryFirstClearRewards;
