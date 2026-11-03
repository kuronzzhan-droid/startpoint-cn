"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantAbyssSphealDegreeSync = exports.sphealDegreeEnabled = exports.ABYSS_SPHEAL_CONFIG_PATH = exports.SPHEAL_CHARACTER = exports.ABYSS_SPHEAL_DEGREE = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../data/db");
const degree_1 = require("../data/domains/degree");
const persistence_coordinator_1 = require("./persistence-coordinator");
exports.ABYSS_SPHEAL_DEGREE = 9911301;
exports.SPHEAL_CHARACTER = 129990;
exports.ABYSS_SPHEAL_CONFIG_PATH = node_path_1.default.resolve(__dirname, "..", "..", "assets", "abyss_spheal_degree_reward.json");
function readConfig(configPath) {
    try {
        const config = JSON.parse((0, node_fs_1.readFileSync)(configPath, "utf8"));
        if (config.schema_version !== 1 || config.enabled !== true
            || config.event_id !== 700099 || config.folder_id !== 1
            || config.degree_id !== exports.ABYSS_SPHEAL_DEGREE || config.character_id !== exports.SPHEAL_CHARACTER
            || config.party_scope !== "final_clear_main_or_unison")
            return null;
        return config;
    }
    catch (_a) {
        return null;
    }
}
function sphealDegreeEnabled(configPath = exports.ABYSS_SPHEAL_CONFIG_PATH) {
    return readConfig(configPath) !== null;
}
exports.sphealDegreeEnabled = sphealDegreeEnabled;
/**
 * Grant the Spheal title only when every one of the 30 main-tower rounds in a
 * completed run included Spheal in either the main or unison party.
 */
function grantAbyssSphealDegreeSync(playerId, options = {}) {
    var _a;
    if (!Number.isSafeInteger(playerId) || playerId <= 0)
        return [];
    const config = readConfig((_a = options.configPath) !== null && _a !== void 0 ? _a : exports.ABYSS_SPHEAL_CONFIG_PATH);
    if (config === null)
        return [];
    const db = (0, db_1.getDb)();
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "event", playerId, operation: "grant_abyss_spheal_degree",
    }, () => {
        if (!db.prepare("SELECT id FROM players WHERE id = ?").get(playerId))
            return [];
        if (db.prepare("SELECT 1 FROM players_degrees WHERE player_id = ? AND degree_id = ?")
            .get(playerId, config.degree_id))
            return [];
        const runs = db.prepare(`
            SELECT id
            FROM leaderboard_runs
            WHERE player_id = ? AND competition_key = 'achievement:abyss-endurance:700099:1'
                AND status = 'completed' AND tracked_from_round = 1
                AND total_rounds = 30 AND rounds_cleared = 30
            ORDER BY id DESC
        `).all(playerId);
        const roundCheck = db.prepare(`
            SELECT COUNT(*) AS round_count,
                SUM(CASE WHEN character_id_1 = ? OR character_id_2 = ? OR character_id_3 = ?
                    OR unison_character_id_1 = ? OR unison_character_id_2 = ?
                    OR unison_character_id_3 = ? THEN 1 ELSE 0 END) AS spheal_rounds
            FROM leaderboard_run_rounds WHERE run_id = ?
        `);
        for (const run of runs) {
            const result = roundCheck.get(config.character_id, config.character_id, config.character_id, config.character_id, config.character_id, config.character_id, run.id);
            if (result.round_count !== 30 || result.spheal_rounds !== 30)
                continue;
            return (0, degree_1.grantPlayerDegreeSync)(playerId, config.degree_id, Date.now())
                ? [config.degree_id] : [];
        }
        return [];
    });
}
exports.grantAbyssSphealDegreeSync = grantAbyssSphealDegreeSync;
