"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canJoinMultiGuestQuestSync = void 0;
const multi_guest_entry_requirements_json_1 = __importDefault(require("../../assets/multi_guest_entry_requirements.json"));
const db_1 = require("../data/db");
const item_1 = require("../data/domains/item");
const player_1 = require("../data/domains/player");
const cached_statement_1 = require("../lib/cached-statement");
const assets_1 = require("../lib/assets");
const mode15_optional_1 = require("../lib/mode15-optional");
const stamina_1 = require("../lib/stamina");
const contract_1 = require("./five-boss/contract");
function loadRules(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("multi guest entry requirements must be an object");
    }
    const loaded = new Map();
    for (const [key, raw] of Object.entries(value)) {
        const match = key.match(/^(\d+):(\d+)$/);
        const candidate = raw;
        const rule = {
            minimum_player_rank: Number(candidate === null || candidate === void 0 ? void 0 : candidate.minimum_player_rank),
            required_quest_categories: Array.isArray(candidate === null || candidate === void 0 ? void 0 : candidate.required_quest_categories)
                ? [...new Set(candidate.required_quest_categories.map(Number))]
                : [],
            required_quest_id: Number(candidate === null || candidate === void 0 ? void 0 : candidate.required_quest_id),
        };
        if (!match
            || !Number.isSafeInteger(rule.minimum_player_rank) || rule.minimum_player_rank <= 0
            || !Number.isSafeInteger(rule.required_quest_id) || rule.required_quest_id <= 0
            || rule.required_quest_categories.length === 0
            || !rule.required_quest_categories.every(number => Number.isSafeInteger(number) && number > 0)
            || (0, assets_1.getQuestFromCategorySync)(Number(match[1]), Number(match[2])) === null
            || !rule.required_quest_categories.some(category => (0, assets_1.getQuestFromCategorySync)(category, rule.required_quest_id) !== null)) {
            throw new Error(`invalid multi guest entry requirement: ${key}`);
        }
        loaded.set(key, Object.freeze(Object.assign(Object.assign({}, rule), { required_quest_categories: Object.freeze(rule.required_quest_categories) })));
    }
    return loaded;
}
const rules = loadRules(multi_guest_entry_requirements_json_1.default.rules);
function hasFinishedQuestSync(playerId, category, questId) {
    return (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT 1 AS finished
        FROM players_quest_progress
        WHERE player_id = ? AND section = ? AND quest_id = ? AND finished = 1
        LIMIT 1
    `).get(playerId, category, questId) !== undefined;
}
/**
 * Checks a new real guest before room admission. Hosts and returning room
 * members are handled by the callers and bypass this gate. Unknown quests
 * fail open because the server must not invent restrictions that are absent
 * from the audited client master table.
 */
function canJoinMultiGuestQuestSync(playerId, category, questId, player, dependencies = {}) {
    var _a, _b, _c, _d, _e;
    if ((0, contract_1.isFiveBossGauntletQuest)(category, questId)) {
        const resolvedPlayer = player !== null && player !== void 0 ? player : ((_a = dependencies.getPlayer) !== null && _a !== void 0 ? _a : player_1.getPlayerSync)(playerId);
        if (!resolvedPlayer)
            return { allowed: false, reason: "player_not_found" };
        const playerRank = (0, stamina_1.getRankDegree)(resolvedPlayer.rankPoint || 0);
        if (playerRank < contract_1.FIVE_BOSS_GAUNTLET.minimumGuestPlayerRank) {
            return {
                allowed: false,
                reason: "player_rank",
                minimumPlayerRank: contract_1.FIVE_BOSS_GAUNTLET.minimumGuestPlayerRank,
                playerRank,
            };
        }
        const getItemCount = (_b = dependencies.getItemCount) !== null && _b !== void 0 ? _b : item_1.getPlayerItemSync;
        const currentItemCount = Math.max(0, Number((_c = getItemCount(playerId, contract_1.FIVE_BOSS_GAUNTLET.ticketItemId)) !== null && _c !== void 0 ? _c : 0));
        if (currentItemCount < 1) {
            return {
                allowed: false,
                reason: "five_boss_ticket",
                minimumPlayerRank: contract_1.FIVE_BOSS_GAUNTLET.minimumGuestPlayerRank,
                playerRank,
                requiredItemId: contract_1.FIVE_BOSS_GAUNTLET.ticketItemId,
                currentItemCount,
            };
        }
    }
    if ((0, mode15_optional_1.isMode15Quest)(category, questId)) {
        const mode15 = (0, mode15_optional_1.canJoinMode15RescueSync)(playerId, category, questId);
        if (!mode15.allowed)
            return { allowed: false, reason: "mode15_progress" };
    }
    const rule = rules.get(`${category}:${questId}`);
    if (!rule)
        return { allowed: true, reason: "eligible" };
    const resolvedPlayer = player !== null && player !== void 0 ? player : ((_d = dependencies.getPlayer) !== null && _d !== void 0 ? _d : player_1.getPlayerSync)(playerId);
    if (!resolvedPlayer)
        return { allowed: false, reason: "player_not_found" };
    const playerRank = (0, stamina_1.getRankDegree)(resolvedPlayer.rankPoint || 0);
    if (playerRank < rule.minimum_player_rank) {
        return {
            allowed: false,
            reason: "player_rank",
            minimumPlayerRank: rule.minimum_player_rank,
            playerRank,
        };
    }
    const hasFinishedQuest = (_e = dependencies.hasFinishedQuest) !== null && _e !== void 0 ? _e : hasFinishedQuestSync;
    if (!rule.required_quest_categories.some(category => hasFinishedQuest(playerId, category, rule.required_quest_id))) {
        return {
            allowed: false,
            reason: "prerequisite_quest",
            minimumPlayerRank: rule.minimum_player_rank,
            playerRank,
            requiredQuestCategories: [...rule.required_quest_categories],
            requiredQuestId: rule.required_quest_id,
        };
    }
    return {
        allowed: true,
        reason: "eligible",
        minimumPlayerRank: rule.minimum_player_rank,
        playerRank,
        requiredQuestCategories: [...rule.required_quest_categories],
        requiredQuestId: rule.required_quest_id,
    };
}
exports.canJoinMultiGuestQuestSync = canJoinMultiGuestQuestSync;
