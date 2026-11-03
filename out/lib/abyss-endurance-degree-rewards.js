"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAbyssEnduranceQuestSync = exports.finishAbyssEnduranceQuestSync = exports.startAbyssEnduranceQuestSync = exports.ABYSS_ENDURANCE_CONFIG_PATH = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../data/db");
const degree_1 = require("../data/domains/degree");
const player_1 = require("../data/domains/player");
const leaderboard_1 = require("../data/domains/leaderboard");
const version_1 = require("./version");
const types_1 = require("./types");
const persistence_coordinator_1 = require("./persistence-coordinator");
exports.ABYSS_ENDURANCE_CONFIG_PATH = node_path_1.default.resolve(__dirname, "..", "..", "assets", "abyss_endurance_degree_reward.json");
const REWARDS = Object.freeze([
    { degree_id: 9911101, battle_ms: 60 * 60000 },
    { degree_id: 9911102, battle_ms: 120 * 60000 },
    { degree_id: 9911103, battle_ms: 180 * 60000 },
]);
function configuredModes(options) {
    var _a;
    try {
        const config = JSON.parse((0, node_fs_1.readFileSync)((_a = options.configPath) !== null && _a !== void 0 ? _a : exports.ABYSS_ENDURANCE_CONFIG_PATH, "utf8"));
        if (config.schema_version !== 2 || config.enabled !== true || !Array.isArray(config.modes)
            || config.modes.length !== 2 || config.modes[0].mode !== "normal" || config.modes[1].mode !== "ex"
            || config.modes[0].event_id !== 700099 || config.modes[0].folder_id !== 1
            || config.modes.some(mode => !Number.isSafeInteger(mode.folder_id) || mode.folder_id < 1
                || (mode.event_id !== null && (!Number.isSafeInteger(mode.event_id) || mode.event_id <= 0)))
            || config.modes[1].event_id === 700099)
            return [];
        return config.modes;
    }
    catch (_b) {
        return [];
    }
}
function target(quest, options) {
    var _a;
    if (quest.category !== types_1.QuestCategory.RUSH_EVENT)
        return null;
    return (_a = configuredModes(options).find(mode => mode.event_id !== null
        && mode.event_id === quest.eventId && mode.folder_id === quest.folderId)) !== null && _a !== void 0 ? _a : null;
}
function key(mode) { return `achievement:abyss-endurance:${mode.event_id}:${mode.folder_id}`; }
function revision(mode) {
    var _a;
    let result = null, version = null;
    for (const patch of (0, version_1.getPatchManifest)().patches) {
        const candidate = (_a = patch.quest_time_revisions) === null || _a === void 0 ? void 0 : _a[`rush:${mode.event_id}`];
        if (!patch.enabled || patch.type !== "patch" || candidate === undefined)
            continue;
        if (!/^[a-f0-9]{64}$/.test(candidate))
            throw new Error("Invalid endurance tower revision");
        const order = version === null ? 1 : (0, version_1.compareVersion)(patch.version, version);
        if (order === 0 && result !== candidate)
            throw new Error("Conflicting endurance tower revisions");
        if (order > 0) {
            result = candidate;
            version = patch.version;
        }
    }
    return result;
}
function validQuest(quest) {
    return quest.totalRounds === 30 && Number.isSafeInteger(quest.round)
        && quest.round >= 1 && quest.round <= 30 && Number.isSafeInteger(quest.questId)
        && quest.questId > 0;
}
/** Separate run identity: closing a ranking season never disables achievement timing. */
function startAbyssEnduranceQuestSync(playerId, quest, startedAtMs = Date.now(), options = {}) {
    const mode = target(quest, options);
    if (!mode || !validQuest(quest) || !Number.isSafeInteger(startedAtMs) || startedAtMs < 0)
        return;
    const tower = revision(mode);
    if (tower === null)
        return;
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "event", playerId, operation: "start_abyss_endurance_quest",
    }, () => {
        const competitionKey = key(mode);
        const season = (0, leaderboard_1.getLeaderboardSeasonSync)(competitionKey, startedAtMs, tower);
        const active = (0, leaderboard_1.getActiveLeaderboardRunSync)(playerId, competitionKey);
        if (active && active.season === season && active.totalRounds === 30
            && quest.round > 1 && active.roundsCleared === quest.round - 1) {
            (0, leaderboard_1.markLeaderboardRoundStartedSync)(active.id, quest.round, quest.questId, startedAtMs);
            return;
        }
        (0, leaderboard_1.abandonLeaderboardRunsSync)({ competitionKey, playerId, endedAtMs: startedAtMs });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            return;
        (0, leaderboard_1.insertLeaderboardRunSync)({ competitionKey, playerId, playerName: player.name, season,
            startedAtMs, totalRounds: 30, trackedFromRound: quest.round,
            pendingRound: quest.round, pendingQuestId: quest.questId });
    });
}
exports.startAbyssEnduranceQuestSync = startAbyssEnduranceQuestSync;
function grantCompletedRun(playerId, run, acquiredAt) {
    if (run.playerId !== playerId || run.status !== "completed" || run.trackedFromRound !== 1
        || run.roundsCleared !== 30 || run.totalRounds !== 30)
        return [];
    const rows = (0, db_1.getDb)().prepare(`SELECT round_number AS round, client_battle_ms AS ms
        FROM leaderboard_run_rounds WHERE run_id = ? ORDER BY round_number`).all(run.id);
    if (rows.length !== 30 || rows.some((row, i) => row.round !== i + 1
        || !Number.isSafeInteger(row.ms) || row.ms <= 0))
        return [];
    const total = rows.reduce((sum, row) => sum + row.ms, 0);
    if (!Number.isSafeInteger(total) || total !== run.clientBattleMs)
        return [];
    return REWARDS.filter(reward => total > reward.battle_ms
        && (0, degree_1.grantPlayerDegreeSync)(playerId, reward.degree_id, acquiredAt)).map(reward => reward.degree_id);
}
function finishAbyssEnduranceQuestSync(input, options = {}) {
    var _a;
    const mode = target(input.quest, options);
    const finishedAtMs = (_a = input.finishedAtMs) !== null && _a !== void 0 ? _a : Date.now();
    if (!mode || !validQuest(input.quest) || !input.accomplished
        || !Number.isSafeInteger(finishedAtMs) || finishedAtMs < 0
        || !Number.isSafeInteger(input.clientBattleMs) || input.clientBattleMs <= 0
        || input.clientBattleMs > 2147483647)
        return [];
    const tower = revision(mode);
    if (tower === null)
        return [];
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "event", playerId: input.playerId, operation: "finish_abyss_endurance_quest",
    }, () => {
        const season = (0, leaderboard_1.getLeaderboardSeasonSync)(key(mode), finishedAtMs, tower);
        const run = (0, leaderboard_1.getActiveLeaderboardRunSync)(input.playerId, key(mode));
        if (!run || run.season !== season)
            return [];
        const completed = (0, leaderboard_1.finishLeaderboardRoundSync)({ run, round: input.quest.round,
            questId: input.quest.questId, clientBattleMs: input.clientBattleMs, finishedAtMs, party: input.party });
        return completed === null ? [] : grantCompletedRun(input.playerId, completed, finishedAtMs);
    });
}
exports.finishAbyssEnduranceQuestSync = finishAbyssEnduranceQuestSync;
function resetAbyssEnduranceQuestSync(playerId, quest, endedAtMs = Date.now(), options = {}) {
    const mode = target(quest, options);
    if (mode)
        (0, leaderboard_1.abandonLeaderboardRunsSync)({ competitionKey: key(mode), playerId, endedAtMs });
}
exports.resetAbyssEnduranceQuestSync = resetAbyssEnduranceQuestSync;
