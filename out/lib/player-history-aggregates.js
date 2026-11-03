"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlayerHistoryTopicAggregatesSync = exports.formatPlayerHistoryJstDate = void 0;
const content_master_1 = require("./content-master");
const encyclopedia_json_1 = __importDefault(require("../../assets/encyclopedia.json"));
const main_quest_json_1 = __importDefault(require("../../assets/main_quest.json"));
const score_attack_border_reward_json_1 = __importDefault(require("../../assets/score_attack_border_reward.json"));
const score_attack_event_quest_json_1 = __importDefault(require("../../assets/score_attack_event_quest.json"));
const story_event_single_quest_json_1 = __importDefault(require("../../assets/story_event_single_quest.json"));
const world_story_event_quest_json_1 = __importDefault(require("../../assets/world_story_event_quest.json"));
const db_1 = require("../data/db");
const active_mission_counters_1 = require("../data/domains/active_mission_counters");
const character_1 = require("../data/domains/character");
const degree_1 = require("../data/domains/degree");
const equipment_1 = require("../data/domains/equipment");
const mission_battle_facts_1 = require("../data/domains/mission_battle_facts");
const assets_1 = require("./assets");
const character_2 = require("./character");
const counters_1 = require("./mission/counters");
const stamina_1 = require("./stamina");
const MAIN_QUEST_IDS_BY_CHAPTER = Array.from({ length: 12 }, () => new Set());
for (const questIdText of Object.keys(main_quest_json_1.default)) {
    const questId = Number(questIdText);
    const chapter = Math.floor(questId / 1000000);
    if (chapter >= 1 && chapter <= 12)
        MAIN_QUEST_IDS_BY_CHAPTER[chapter - 1].add(questId);
}
function buildSideStoryGroups(asset) {
    var _a;
    const groups = new Map();
    for (const questIdText of Object.keys(asset)) {
        const questId = Number(questIdText);
        const groupId = Math.floor(questId / 1000);
        const group = (_a = groups.get(groupId)) !== null && _a !== void 0 ? _a : [];
        group.push(questId);
        groups.set(groupId, group);
    }
    return [...groups.values()];
}
const SIDE_STORY_GROUPS = [
    { section: 10, groups: buildSideStoryGroups(story_event_single_quest_json_1.default) },
    { section: 18, groups: buildSideStoryGroups(world_story_event_quest_json_1.default) },
];
const SPECIAL_EQUIPMENT_IDS = [5010045, 5040020, 5100011, 5030028, 5010032, 5010056];
const SOLO_TIME_ATTACK_MASTERY_DEGREES = new Set([54500, 54520, 54540, 54560, 54580, 54600]);
const SOLO_TIME_ATTACK_VICTORY_DEGREES = new Set([54510, 54530, 54550, 54570, 54590, 54610]);
const EXPERT_BOSS_DEGREE_TO_BOSS_ID = new Map([
    [57020, 1],
    [57040, 2],
    [57060, 3],
    [57080, 4],
    [57100, 5],
    [57120, 6],
]);
const BASE_READ_ENCYCLOPEDIA_COUNT = Object.values(encyclopedia_json_1.default).filter(entry => entry.read).length;
const BASE_ENCYCLOPEDIA_IDS = new Set(Object.keys(encyclopedia_json_1.default).map(Number));
function pad(value) {
    return String(value).padStart(2, "0");
}
/** Convert a real database timestamp to the virtual server's JST display time. */
function formatPlayerHistoryJstDate(date, offsetMs) {
    const jst = new Date(date.getTime() + offsetMs + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`
        + ` ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}`;
}
exports.formatPlayerHistoryJstDate = formatPlayerHistoryJstDate;
function exactLevel100CharacterCount(characters) {
    var _a;
    const master = content_master_1.serverCharacters;
    let count = 0;
    for (const [characterId, character] of Object.entries(characters)) {
        const rarity = (_a = master[characterId]) === null || _a === void 0 ? void 0 : _a.rarity;
        const caps = character_2.characterExpCaps[rarity];
        const level100Exp = caps === null || caps === void 0 ? void 0 : caps[caps.length - 1];
        if (level100Exp !== undefined && character.exp >= level100Exp)
            count++;
    }
    return count;
}
function completedSideStoryCount(finishedBySection) {
    var _a;
    let count = 0;
    for (const { section, groups } of SIDE_STORY_GROUPS) {
        const finished = (_a = finishedBySection.get(section)) !== null && _a !== void 0 ? _a : new Set();
        count += groups.filter(group => group.every(questId => finished.has(questId))).length;
    }
    return count;
}
function scoreAttackBorderCounts(rows) {
    var _a;
    const quests = score_attack_event_quest_json_1.default;
    const tiers = score_attack_border_reward_json_1.default;
    let best = 0;
    let total = 0;
    for (const row of rows) {
        if (row.section !== 27 || row.high_score === null)
            continue;
        const quest = quests[String(row.quest_id)];
        if (!quest)
            continue;
        const questTiers = (_a = tiers[`${quest.eventId}_${quest.scoreAttackQuestId}`]) !== null && _a !== void 0 ? _a : [];
        const achieved = questTiers.filter(tier => tier.score <= row.high_score).length;
        best = Math.max(best, achieved);
        total += achieved;
    }
    return [best, total];
}
function formatAchievementDate(acquiredAt, fallbackDate, offsetMs) {
    if (!Number.isFinite(acquiredAt) || acquiredAt <= 0)
        return fallbackDate;
    const date = new Date(acquiredAt);
    return Number.isFinite(date.getTime())
        ? formatPlayerHistoryJstDate(date, offsetMs)
        : fallbackDate;
}
/**
 * Build the current player-history snapshot from already persisted gameplay data.
 * This endpoint is opened manually, so the aggregation stays read-only and does
 * not add work to battle settlement, gacha, or multiplayer room handling.
 */
function buildPlayerHistoryTopicAggregatesSync(playerId, player, startGameDate, fallbackAchievementDate, offsetMs) {
    var _a, _b, _c, _d, _e, _f, _g;
    const db = (0, db_1.getDb)();
    const questRows = db.prepare(`
        SELECT section, quest_id, high_score
        FROM players_quest_progress
        WHERE player_id = ? AND finished = 1
          AND section IN (1, 10, 18, 20, 21, 27)
    `).all(playerId);
    const finishedBySection = new Map();
    for (const row of questRows) {
        const finished = (_a = finishedBySection.get(row.section)) !== null && _a !== void 0 ? _a : new Set();
        finished.add(row.quest_id);
        finishedBySection.set(row.section, finished);
    }
    const finishedMainQuests = (_b = finishedBySection.get(1)) !== null && _b !== void 0 ? _b : new Set();
    const chapterDates = MAIN_QUEST_IDS_BY_CHAPTER.map(questIds => (questIds.size > 0 && [...questIds].every(questId => finishedMainQuests.has(questId))
        ? fallbackAchievementDate
        : null));
    const characters = (0, character_1.getPlayerCharactersSync)(playerId);
    const completedSecondBoards = Object.entries(characters)
        .filter(([, character]) => character.bondTokenList.some(token => (token.manaBoardIndex === 2 && token.status >= 2)))
        .sort(([, left], [, right]) => left.updateTime.getTime() - right.updateTime.getTime());
    const firstSecondBoard = completedSecondBoards[0];
    const firstSecondBoardDate = firstSecondBoard
        && Number.isFinite(firstSecondBoard[1].updateTime.getTime())
        ? formatPlayerHistoryJstDate(firstSecondBoard[1].updateTime, offsetMs)
        : null;
    const equipment = (0, equipment_1.getPlayerEquipmentListSync)(playerId);
    const equipmentEntries = Object.entries(equipment);
    const fullyAwakenedEquipmentCount = equipmentEntries.filter(([equipmentId, entry]) => {
        const dissolve = (0, assets_1.getEquipmentDissolveSync)(equipmentId);
        return dissolve !== null && entry.level >= dissolve.max_level;
    }).length;
    const fullyEnhancedEquipmentCount = equipmentEntries.filter(([equipmentId, entry]) => (entry.enhancementLevel >= (0, assets_1.getEquipmentMaxLevel)(Number(equipmentId)))).length;
    const specialEquipmentLevels = [];
    for (const equipmentId of SPECIAL_EQUIPMENT_IDS) {
        const entry = equipment[String(equipmentId)];
        specialEquipmentLevels.push((_c = entry === null || entry === void 0 ? void 0 : entry.level) !== null && _c !== void 0 ? _c : null, (_d = entry === null || entry === void 0 ? void 0 : entry.enhancementLevel) !== null && _d !== void 0 ? _d : null);
    }
    const battleCounters = (0, mission_battle_facts_1.getMissionBattleCountersSync)(playerId);
    const activeMissionCounters = (0, active_mission_counters_1.getActiveMissionCountersSync)(playerId);
    const degreeIds = (0, degree_1.getPlayerDegreeIdsSync)(playerId);
    const degreeSet = new Set(degreeIds);
    const regularMissionCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM players_cleared_regular_missions
        WHERE player_id = ?
    `).get(playerId).count;
    const eventMissionCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM players_category_mission_stages
        WHERE player_id = ? AND status = 1
    `).get(playerId).count;
    const mvpCount = (0, counters_1.getMissionCounterValueSync)(playerId, {
        dimension: "battle.multi_mvp",
        scopeType: "lifetime",
        scopeKey: "all",
    });
    const rushRecord = db.prepare(`
        SELECT event_id, endless_battle_max_round,
               endless_battle_max_round_character_id_1,
               endless_battle_max_round_character_id_2,
               endless_battle_max_round_character_id_3
        FROM players_rush_events
        WHERE player_id = ? AND endless_battle_max_round IS NOT NULL
        ORDER BY endless_battle_max_round DESC, event_id DESC
        LIMIT 1
    `).get(playerId);
    const rushCharacters = rushRecord
        ? [
            rushRecord.endless_battle_max_round_character_id_1,
            rushRecord.endless_battle_max_round_character_id_2,
            rushRecord.endless_battle_max_round_character_id_3,
            null, null, null, null,
        ]
        : [null, null, null, null, null, null, null];
    const carnivalRecord = db.prepare(`
        SELECT event_id, SUM(MAX(COALESCE(best_score, 0), 0)) AS total_score
        FROM players_carnival_event_records
        WHERE player_id = ?
        GROUP BY event_id
        ORDER BY total_score DESC, event_id DESC
        LIMIT 1
    `).get(playerId);
    const [scoreAttackBestBorder, scoreAttackTotalBorders] = scoreAttackBorderCounts(questRows);
    const playerReadEncyclopediaIds = db.prepare(`
        SELECT encyclopedia_id
        FROM players_encyclopedia_keywords
        WHERE player_id = ? AND read = 1
    `).all(playerId);
    const readEncyclopediaCount = BASE_READ_ENCYCLOPEDIA_COUNT
        + playerReadEncyclopediaIds.filter(row => !BASE_ENCYCLOPEDIA_IDS.has(row.encyclopedia_id)).length;
    const expertBossDegree = db.prepare(`
        SELECT degree_id, acquired_at
        FROM players_degrees
        WHERE player_id = ? AND degree_id IN (57020, 57040, 57060, 57080, 57100, 57120)
        ORDER BY CASE WHEN acquired_at > 0 THEN acquired_at ELSE 9223372036854775807 END,
                 degree_id
        LIMIT 1
    `).get(playerId);
    const expertBossId = expertBossDegree
        ? (_e = EXPERT_BOSS_DEGREE_TO_BOSS_ID.get(expertBossDegree.degree_id)) !== null && _e !== void 0 ? _e : null
        : null;
    return {
        0: { date_values: [startGameDate] },
        1: { int_values: [Math.max(0, player.totalLoginDays)] },
        2: { date_values: chapterDates.slice(0, 6) },
        3: { date_values: chapterDates.slice(6, 12) },
        4: {
            date_values: [firstSecondBoardDate],
            character_id_values: [firstSecondBoard ? Number(firstSecondBoard[0]) : null],
        },
        5: { int_values: [exactLevel100CharacterCount(characters)] },
        6: { int_values: [Math.max(0, player.bondToken)] },
        7: { date_values: [Object.keys(characters).length >= 100 ? fallbackAchievementDate : null] },
        8: { date_values: [(0, stamina_1.getRankDegree)(player.rankPoint) >= 100 ? fallbackAchievementDate : null] },
        9: { int_values: [regularMissionCount] },
        10: { int_values: [eventMissionCount] },
        11: { int_values: [mvpCount] },
        12: { int_values: [battleCounters.multiHostClearCount, battleCounters.multiGuestClearCount] },
        13: { int_values: [equipmentEntries.length] },
        14: { int_values: [fullyAwakenedEquipmentCount] },
        15: { int_values: [fullyEnhancedEquipmentCount] },
        16: { int_values: specialEquipmentLevels },
        17: {
            int_values: rushRecord
                ? [rushRecord.event_id, rushRecord.endless_battle_max_round]
                : [null, null],
            character_id_values: rushCharacters,
        },
        18: {
            int_values: carnivalRecord
                ? [carnivalRecord.event_id, carnivalRecord.total_score]
                : [null, null],
        },
        19: {
            int_values: [
                degreeIds.filter(id => SOLO_TIME_ATTACK_VICTORY_DEGREES.has(id)).length,
                degreeIds.filter(id => SOLO_TIME_ATTACK_MASTERY_DEGREES.has(id)).length,
            ],
        },
        20: { int_values: [scoreAttackBestBorder, scoreAttackTotalBorders] },
        21: { int_values: [((_f = finishedBySection.get(21)) !== null && _f !== void 0 ? _f : new Set()).size] },
        22: { int_values: [completedSideStoryCount(finishedBySection)] },
        23: { int_values: [((_g = finishedBySection.get(20)) !== null && _g !== void 0 ? _g : new Set()).size] },
        24: { int_values: [activeMissionCounters.totalUsedManaCount] },
        25: { int_values: [readEncyclopediaCount] },
        26: {
            date_values: [expertBossDegree
                    ? formatAchievementDate(expertBossDegree.acquired_at, fallbackAchievementDate, offsetMs)
                    : null],
            boss_id_values: [expertBossId],
        },
    };
}
exports.buildPlayerHistoryTopicAggregatesSync = buildPlayerHistoryTopicAggregatesSync;
