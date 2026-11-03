"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantPracticeExclusiveDegreeRewardsSync = exports.grantEquipmentDegreeRewardsSync = exports.equipmentDegreeRewardsEnabled = exports.isEquipmentDegreeEnhancementComplete = exports.EQUIPMENT_DEGREE_CONFIG_PATH = exports.EQUIPMENT_DEGREE_CATALOG = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../data/db");
const degree_1 = require("../data/domains/degree");
const assets_1 = require("./assets");
const abyss_shop_degree_reward_1 = require("./abyss-shop-degree-reward");
const types_1 = require("./types");
const persistence_coordinator_1 = require("./persistence-coordinator");
exports.EQUIPMENT_DEGREE_CATALOG = Object.freeze([
    Object.freeze({
        degree_id: 9911002,
        equipment_ids: Object.freeze(Array.from({ length: 15 }, (_, index) => 8000101 + index)),
        min_enhancement_level: 120,
    }),
    Object.freeze({
        degree_id: 9911003,
        equipment_ids: Object.freeze([5900101]),
        min_enhancement_level: 120,
    }),
]);
exports.EQUIPMENT_DEGREE_CONFIG_PATH = node_path_1.default.resolve(__dirname, "..", "..", "assets", "equipment_degree_rewards.json");
/** Ordinary level, awakening state, and stack count do not qualify. */
function isEquipmentDegreeEnhancementComplete(value) {
    return typeof value === "number"
        && Number.isSafeInteger(value)
        && value >= 120;
}
exports.isEquipmentDegreeEnhancementComplete = isEquipmentDegreeEnhancementComplete;
function equipmentDegreeRewardsEnabled(configPath = exports.EQUIPMENT_DEGREE_CONFIG_PATH) {
    try {
        const raw = JSON.parse((0, node_fs_1.readFileSync)(configPath, "utf8"));
        if (raw === null || typeof raw !== "object" || Array.isArray(raw))
            return false;
        const config = raw;
        if (config.schema_version !== 1 || config.enabled !== true
            || !Array.isArray(config.rewards)
            || config.rewards.length !== exports.EQUIPMENT_DEGREE_CATALOG.length)
            return false;
        return config.rewards.every((value, index) => {
            if (value === null || typeof value !== "object" || Array.isArray(value))
                return false;
            const entry = value;
            const expected = exports.EQUIPMENT_DEGREE_CATALOG[index];
            return entry.degree_id === expected.degree_id
                && entry.min_enhancement_level === expected.min_enhancement_level
                && Array.isArray(entry.equipment_ids)
                && entry.equipment_ids.length === expected.equipment_ids.length
                && entry.equipment_ids.every((id, itemIndex) => id === expected.equipment_ids[itemIndex]);
        });
    }
    catch (_a) {
        return false;
    }
}
exports.equipmentDegreeRewardsEnabled = equipmentDegreeRewardsEnabled;
/** Updated IDs narrow the check; eligibility always reads every required row. */
function grantEquipmentDegreeRewardsSync(playerId, updatedEquipmentIds, options = {}) {
    if (!Number.isSafeInteger(playerId) || playerId <= 0
        || !equipmentDegreeRewardsEnabled(options.configPath))
        return [];
    const updated = updatedEquipmentIds === undefined ? null : new Set(updatedEquipmentIds);
    const targets = exports.EQUIPMENT_DEGREE_CATALOG.filter(entry => (updated === null || entry.equipment_ids.some(id => updated.has(id))));
    if (targets.length === 0)
        return [];
    const db = (0, db_1.getDb)();
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "player", playerId, operation: "grant_equipment_degree_rewards",
    }, () => {
        if (!db.prepare("SELECT id FROM players WHERE id = ?").get(playerId))
            return [];
        const lookup = db.prepare(`
            SELECT enhancement_level
            FROM players_equipment
            WHERE player_id = ? AND id = ?
        `);
        const eligible = targets.filter(entry => entry.equipment_ids.every(equipmentId => {
            const row = lookup.get(playerId, equipmentId);
            return row !== undefined && isEquipmentDegreeEnhancementComplete(row.enhancement_level);
        }));
        return eligible
            .filter(entry => (0, degree_1.grantPlayerDegreeSync)(playerId, entry.degree_id))
            .map(entry => entry.degree_id);
    });
}
exports.grantEquipmentDegreeRewardsSync = grantEquipmentDegreeRewardsSync;
/** A successful single-player practice is the retroactive backfill trigger. */
function grantPracticeExclusiveDegreeRewardsSync(event, options = {}) {
    if (event.type !== "battle_finish"
        || event.accomplished !== true
        || event.mode !== "single"
        || event.questCategory !== types_1.QuestCategory.PRACTICE
        || !Number.isSafeInteger(event.questId)
        || event.questId <= 0
        || (0, assets_1.getPracticeQuestSync)(event.questId) === null)
        return [];
    return [
        ...(0, abyss_shop_degree_reward_1.grantAbyssShopDegreeRewardSync)(event.playerId, { configPath: options.shopConfigPath }),
        ...grantEquipmentDegreeRewardsSync(event.playerId, undefined, options),
    ];
}
exports.grantPracticeExclusiveDegreeRewardsSync = grantPracticeExclusiveDegreeRewardsSync;
