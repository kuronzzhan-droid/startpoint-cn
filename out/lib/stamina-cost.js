"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStaminaCost = void 0;
const quest_entry_costs_json_1 = __importDefault(require("../../assets/quest_entry_costs.json"));
const stamina_campaign_1 = require("./stamina-campaign");
const utils_1 = require("../utils");
const entryCostMap = quest_entry_costs_json_1.default;
function getStaminaCost(questKey) {
    const entry = entryCostMap[questKey];
    if (!entry || !entry.stamina)
        return { baseCost: 0, cost: 0, rate: 1 };
    const parts = questKey.split("_");
    const category = parseInt(parts[0]);
    const questId = parseInt(parts.slice(1).join("_"));
    const rate = (0, stamina_campaign_1.getActiveCampaignRate)(category, questId, (0, utils_1.getServerDate)());
    const cost = Math.max(1, Math.floor(entry.stamina * rate));
    return { baseCost: entry.stamina, cost, rate };
}
exports.getStaminaCost = getStaminaCost;
