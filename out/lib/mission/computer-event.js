"use strict";
// Event mission computer (category 3)
// Uses pre-generated mission_event_quest_map.json for O(1) pattern→quest lookup
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventComputer = exports.getEventMissionCoverageReport = void 0;
const quest_1 = require("../../data/domains/quest");
const player_1 = require("../../data/domains/player");
const patterns_1 = require("./patterns");
const master_data_1 = require("./master-data");
const mission_event_quest_map_json_1 = __importDefault(require("../../../assets/mission_event_quest_map.json"));
const mission_event_reward_json_1 = __importDefault(require("../../../assets/mission_event_reward.json"));
const event_battle_facts_1 = require("./event-battle-facts");
function getTargetClearTimeMs(missionId) {
    const stages = mission_event_reward_json_1.default[String(missionId)];
    const firstStage = stages && Object.values(stages)[0];
    const row = Array.isArray(firstStage) && Array.isArray(firstStage[0]) ? firstStage[0] : undefined;
    const seconds = Number(row === null || row === void 0 ? void 0 : row[2]);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}
function getEventMissionCoverageReport(at) {
    const definitions = (0, master_data_1.getMissionMasterDefinitions)(3);
    const mappings = mission_event_quest_map_json_1.default;
    const exactCoverage = (0, event_battle_facts_1.getExactEventBattleRuleCoverage)();
    const unsupportedDefinitions = definitions.filter(definition => mappings[definition.pattern] === undefined);
    const countModes = { single: 0, multi: 0, finish: 0 };
    for (const definition of definitions) {
        const mapping = mappings[definition.pattern];
        if (mapping)
            countModes[mapping.countMode]++;
    }
    return {
        total: definitions.length,
        mapped: definitions.length - unsupportedDefinitions.length,
        exactMultiRules: exactCoverage.exactMultiRules,
        exactMultiRulesByRole: exactCoverage.roles,
        unsupported: unsupportedDefinitions.length,
        activeUnsupported: unsupportedDefinitions.filter(definition => (0, master_data_1.isMissionDefinitionEnabledAt)(definition, at)).length,
        countModes,
        unsupportedPatterns: unsupportedDefinitions.map(definition => definition.pattern),
    };
}
exports.getEventMissionCoverageReport = getEventMissionCoverageReport;
function buildContext(playerId, category) {
    const player = (0, player_1.getPlayerSync)(playerId);
    const questProgressRaw = (0, quest_1.getPlayerQuestProgressSync)(playerId);
    let totalQuestClears = 0, ssClears = 0, sClears = 0, aClears = 0, bClears = 0, totalStories = 0;
    const questProgress = {};
    for (const [section, quests] of Object.entries(questProgressRaw)) {
        const list = [];
        for (const qp of quests) {
            list.push({
                questId: qp.questId, finished: qp.finished,
                clearRank: qp.clearRank, bestElapsedTimeMs: qp.bestElapsedTimeMs,
                leaderCharacterId: qp.leaderCharacterId,
                multiClearCount: qp.multiClearCount,
            });
            if (qp.finished) {
                totalQuestClears++;
                if (section === '3')
                    totalStories++;
                if (qp.clearRank === 5)
                    ssClears++;
                else if (qp.clearRank === 4)
                    sClears++;
                else if (qp.clearRank === 3)
                    aClears++;
                else if (qp.clearRank === 2)
                    bClears++;
            }
        }
        questProgress[section] = list;
    }
    return {
        category,
        playerId, player, questProgress,
        totalQuestClears, totalStories,
        rankCounts: { rank_ss: ssClears, rank_s: sClears, rank_a: aClears, rank_b: bClears },
    };
}
exports.EventComputer = {
    name: "Event",
    buildContext(playerId, category) {
        return buildContext(playerId, category);
    },
    compute(missionId, ctx, dbProgress) {
        var _a;
        const pattern = (0, patterns_1.getMissionPattern)(3, missionId);
        if (!pattern)
            return dbProgress;
        const mapping = mission_event_quest_map_json_1.default[pattern];
        if (!mapping)
            return dbProgress;
        const targetClearTimeMs = mapping.countMode === "finish"
            ? getTargetClearTimeMs(missionId)
            : undefined;
        if (mapping.countMode === "finish" && targetClearTimeMs === undefined)
            return dbProgress;
        let count = 0;
        for (const cat of mapping.categories) {
            const progress = ctx.questProgress[String(cat)];
            if (!progress)
                continue;
            for (const q of progress) {
                if (!mapping.questIds.includes(q.questId))
                    continue;
                if (mapping.countMode === "multi") {
                    count += (_a = q.multiClearCount) !== null && _a !== void 0 ? _a : (q.finished ? 1 : 0);
                }
                else if (mapping.countMode === "finish") {
                    if (q.finished
                        && q.bestElapsedTimeMs !== undefined
                        && q.bestElapsedTimeMs <= targetClearTimeMs)
                        count++;
                }
                else if (q.finished) {
                    count++;
                }
            }
        }
        return count;
    },
};
