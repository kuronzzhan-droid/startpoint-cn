"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantPracticeCharacterDegreeRewardsSync = exports.grantCharacterDegreeRewardsSync = exports.characterDegreeRewardsEnabled = exports.CHARACTER_DEGREE_CONFIG_PATH = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../data/db");
const degree_1 = require("../data/domains/degree");
const assets_1 = require("./assets");
const types_1 = require("./types");
const persistence_coordinator_1 = require("./persistence-coordinator");
const character_degree_catalog_1 = require("./character-degree-catalog");
exports.CHARACTER_DEGREE_CONFIG_PATH = node_path_1.default.resolve(__dirname, "..", "..", "assets", "character_degree_rewards.json");
/** Deploy the matching .108 resources before enabling this configuration. */
function characterDegreeRewardsEnabled(configPath = exports.CHARACTER_DEGREE_CONFIG_PATH) {
    try {
        const value = JSON.parse((0, node_fs_1.readFileSync)(configPath, "utf8"));
        return (0, character_degree_catalog_1.isCharacterDegreeActivation)(value) && value.enabled;
    }
    catch (_a) {
        return false;
    }
}
exports.characterDegreeRewardsEnabled = characterDegreeRewardsEnabled;
/** Grant both cosmetic variants from persisted ownership, EXP and limit breaks. */
function grantCharacterDegreeRewardsSync(playerId, characterIds, options = {}) {
    if (!Number.isSafeInteger(playerId) || playerId <= 0)
        return [];
    const requested = characterIds === undefined ? null : new Set(characterIds);
    const targets = character_degree_catalog_1.CHARACTER_DEGREE_CATALOG.filter(entry => requested === null || requested.has(entry.character_id));
    if (targets.length === 0 || !characterDegreeRewardsEnabled(options.configPath))
        return [];
    const db = (0, db_1.getDb)();
    if (!db.prepare("SELECT id FROM players WHERE id = ?").get(playerId))
        return [];
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "player", playerId, operation: "grant_character_degree_rewards",
    }, () => {
        var _a;
        const newlyGranted = [];
        const owned = db.prepare(`SELECT exp, over_limit_step FROM players_characters
            WHERE player_id = ? AND id = ?`);
        const acquiredAt = Date.now();
        for (const entry of targets) {
            if (((_a = (0, assets_1.getCharacterDataSync)(entry.character_id)) === null || _a === void 0 ? void 0 : _a.rarity) !== 5)
                continue;
            const character = owned.get(playerId, entry.character_id);
            if (!character || !(0, character_degree_catalog_1.isCharacterDegreeEligible)(character))
                continue;
            for (const degreeId of entry.degree_ids) {
                // The shared writer supplies acquired_at and preserves duplicate ownership.
                if ((0, degree_1.grantPlayerDegreeSync)(playerId, degreeId, acquiredAt))
                    newlyGranted.push(degreeId);
            }
        }
        return newlyGranted;
    });
}
exports.grantCharacterDegreeRewardsSync = grantCharacterDegreeRewardsSync;
/** Backfill the entire owned roster after a successful native single-player practice. */
function grantPracticeCharacterDegreeRewardsSync(event, options = {}) {
    if (event.type !== "battle_finish" || event.accomplished !== true
        || event.mode !== "single" || event.questCategory !== types_1.QuestCategory.PRACTICE
        || !Number.isSafeInteger(event.questId) || event.questId <= 0
        || (0, assets_1.getPracticeQuestSync)(event.questId) === null)
        return [];
    return grantCharacterDegreeRewardsSync(event.playerId, undefined, options);
}
exports.grantPracticeCharacterDegreeRewardsSync = grantPracticeCharacterDegreeRewardsSync;
