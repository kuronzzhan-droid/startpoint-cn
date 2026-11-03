"use strict";
// Character awakening mission computer (category 9)
Object.defineProperty(exports, "__esModule", { value: true });
exports.AwakeComputer = exports.buildAwakeContext = void 0;
const character_clear_1 = require("../../data/domains/character_clear");
const character_1 = require("../../data/domains/character");
const quest_1 = require("../../data/domains/quest");
const mission_1 = require("../../data/domains/mission");
const player_1 = require("../../data/domains/player");
const db_1 = require("../../data/db");
const character_queries_1 = require("./character-queries");
const stages_1 = require("./stages");
const awake_master_assets_1 = require("./awake-master-assets");
const assets_1 = require("../assets");
const character_overlimit_1 = require("../character-overlimit");
const awake_battle_rules_1 = require("./awake-battle-rules");
// Slot 1 missions that count story reading (not party clears)
const STORY_MISSION_IDS = new Set(Object.entries(awake_master_assets_1.characterAwakeDefinitions)
    .filter(([, rows]) => /阅读|剧情/.test(rows[0][3]))
    .map(([mid]) => Number(mid)));
const QUEST_CLEAR_MAP = new Map([
    [1110013, { category: 2, questIds: [1028004], leaderCharId: 111001 }],
    [1310052, { category: 15, questIds: [awake_battle_rules_1.BARAK_AWAKE_PRACTICE_QUEST_ID], leaderCharId: 131005 }],
    [1410032, { category: 2, questIds: [1020003] }],
    [2110013, { category: 2, questIds: [1028004], leaderCharId: 211001 }],
    [2310013, {
            category: 21,
            questIds: [1006],
            alternateTargets: [{ category: 2, questIds: [1010004] }],
            timeLimitMs: 90000,
            leaderCharId: 231001,
        }],
    [2510032, { category: 13, questIds: [1020, 1023, 1026, 1029, 1032, 1035, 1038], leaderCharId: 251003 }],
    [2510033, { category: 13, questIds: [1020, 1023, 1026, 1029, 1032, 1035, 1038], timeLimitMs: 180000, leaderCharId: 251003 }],
    [2630023, { category: 18, questIds: [400001104], leaderCharId: 151006 }],
]);
const BOND_TOKEN_MISSION_IDS = new Set([1410033, 2210043, 2510043, 2610073]);
const LEADER_REQUIRED_IDS = new Set([1510062, 1610022, 1610023, 2610072]);
const COOP_MISSION_IDS = new Set([1310053, 1510063]);
const COMBO_MISSION_IDS = new Set([1210013]);
const POWERFLIP_CHAR_IDS = new Set([1210012]);
// Multi-character party missions: mission_id → required character IDs (from col[24])
const MULTI_CHAR_MISSIONS = new Map([
    [2110012, [211001, 231001]],
    [2210042, [10, 221004]],
    [2410632, [241063, 243007]],
    [2410633, [241063, 243007, 361009]],
    [2510042, [251004, 1]],
]);
// ─── Computer ───
function coClearKey(a, b) {
    return (0, awake_battle_rules_1.getCharacterPairKey)(a, b);
}
function expandAwakeMissionIds(missionIds) {
    if (!missionIds)
        return undefined;
    const expanded = new Set();
    for (const missionId of missionIds) {
        expanded.add(missionId);
        if (missionId % 10 === AwakeType.ALL_COMPLETE) {
            expanded.add(missionId - 3);
            expanded.add(missionId - 2);
            expanded.add(missionId - 1);
        }
    }
    return [...expanded];
}
function buildAwakeContext(playerId, missionIds, snapshot = {}) {
    var _a, _b, _c, _d, _e;
    const player = (_a = snapshot.player) !== null && _a !== void 0 ? _a : (0, player_1.getPlayerSync)(playerId);
    const scopedMissionIds = expandAwakeMissionIds(missionIds);
    const targetCharacterIds = scopedMissionIds === undefined
        ? undefined
        : new Set(scopedMissionIds.map(character_queries_1.getCharacterIdFromMission).map(Number));
    let totalQuestClears = 0, ssClears = 0, sClears = 0, aClears = 0, bClears = 0, totalStories = 0;
    const questProgress = {};
    const finishedQuestIds = new Set();
    const seenQuests = new Set();
    const appendQuestProgress = (section, qp) => {
        var _a;
        const list = (_a = questProgress[section]) !== null && _a !== void 0 ? _a : [];
        const key = `${section}:${qp.questId}`;
        if (seenQuests.has(key))
            return;
        seenQuests.add(key);
        list.push({
            questId: qp.questId, finished: qp.finished, clearRank: qp.clearRank,
            bestElapsedTimeMs: qp.bestElapsedTimeMs, leaderCharacterId: qp.leaderCharacterId,
            multiClearCount: qp.multiClearCount,
        });
        questProgress[section] = list;
        if (!qp.finished)
            return;
        finishedQuestIds.add(qp.questId);
        totalQuestClears++;
        if (section === "3")
            totalStories++;
        if (qp.clearRank === 5)
            ssClears++;
        else if (qp.clearRank === 4)
            sClears++;
        else if (qp.clearRank === 3)
            aClears++;
        else if (qp.clearRank === 2)
            bClears++;
    };
    if (scopedMissionIds === undefined) {
        const questProgressRaw = (_b = snapshot.questProgress) !== null && _b !== void 0 ? _b : (0, quest_1.getPlayerQuestProgressSync)(playerId);
        for (const [section, quests] of Object.entries(questProgressRaw)) {
            for (const qp of quests)
                appendQuestProgress(section, qp);
        }
    }
    else {
        const requestedQuests = new Map();
        const addRequestedQuest = (section, questId) => {
            var _a;
            const key = String(section);
            const ids = (_a = requestedQuests.get(key)) !== null && _a !== void 0 ? _a : new Set();
            ids.add(questId);
            requestedQuests.set(key, ids);
        };
        for (const missionId of scopedMissionIds) {
            const target = QUEST_CLEAR_MAP.get(missionId);
            if (target) {
                for (const questId of target.questIds)
                    addRequestedQuest(target.category, questId);
                for (const alternate of (_c = target.alternateTargets) !== null && _c !== void 0 ? _c : []) {
                    for (const questId of alternate.questIds) {
                        addRequestedQuest(alternate.category, questId);
                    }
                }
            }
            if (STORY_MISSION_IDS.has(missionId)) {
                for (const questId of (0, character_queries_1.getCharacterStoryQuestIds)((0, character_queries_1.getCharacterIdFromMission)(missionId))) {
                    addRequestedQuest(3, questId);
                }
            }
        }
        for (const [section, questIds] of requestedQuests) {
            for (const qp of (0, quest_1.getPlayerQuestProgressBySectionAndIdsSync)(playerId, section, [...questIds])) {
                appendQuestProgress(section, qp);
            }
        }
        if (targetCharacterIds === null || targetCharacterIds === void 0 ? void 0 : targetCharacterIds.has(1)) {
            totalStories = (0, quest_1.countFinishedPlayerQuestsByCategorySync)(playerId, 3);
        }
    }
    const charClears = new Map();
    const leaderClears = new Map();
    const multiClears = new Map();
    const leaderMultiClears = new Map();
    const leaderPowerflips = new Map();
    const charData = new Map();
    const clearRows = (0, character_clear_1.getPlayerCharacterClearsSync)(playerId, targetCharacterIds && [...targetCharacterIds]);
    const chars = targetCharacterIds === undefined
        ? (_d = snapshot.characterList) !== null && _d !== void 0 ? _d : (0, character_1.getPlayerCharactersSync)(playerId)
        : (0, character_1.getPlayerCharactersByIdsSync)(playerId, [...targetCharacterIds]);
    for (const [cid, char] of Object.entries(chars)) {
        charData.set(cid, char);
    }
    for (const [cid, row] of Object.entries(clearRows)) {
        charClears.set(cid, row.clear_count);
        leaderClears.set(cid, row.leader_clear_count);
        multiClears.set(cid, row.multi_count);
        leaderMultiClears.set(cid, row.leader_multi_count);
        leaderPowerflips.set(cid, row.leader_power_flip_count);
    }
    const pairs = new Map();
    for (const missionId of scopedMissionIds !== null && scopedMissionIds !== void 0 ? scopedMissionIds : []) {
        const ids = (_e = MULTI_CHAR_MISSIONS.get(missionId)) !== null && _e !== void 0 ? _e : [];
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                // Both orientations remain readable for legacy, unnormalised rows.
                pairs.set(`${ids[i]}:${ids[j]}`, [ids[i], ids[j]]);
                pairs.set(`${ids[j]}:${ids[i]}`, [ids[j], ids[i]]);
            }
        }
    }
    const coClearSelect = "SELECT char_id_a, char_id_b, co_clear_count FROM players_party_member_co_clears WHERE player_id = ?";
    const rows = (scopedMissionIds === undefined
        ? (0, db_1.getDb)().prepare(coClearSelect).all(playerId)
        : pairs.size === 0 ? [] : (0, db_1.getDb)().prepare([...pairs].map(() => (`${coClearSelect} AND char_id_a = ? AND char_id_b = ?`)).join(" UNION ALL ")).all(...[...pairs.values()].flatMap(([a, b]) => [playerId, a, b])));
    const coClears = (0, awake_battle_rules_1.mergePartyCoClearRows)(rows);
    const categoryMissionProgress = new Map();
    const persistedMissions = scopedMissionIds === undefined && snapshot.persistedMissions
        ? snapshot.persistedMissions
        : (0, mission_1.getPlayerCategoryMissionsSync)(playerId, 9, scopedMissionIds);
    for (const [missionId, progress] of Object.entries(persistedMissions)) {
        categoryMissionProgress.set(Number(missionId), progress.progress);
    }
    return {
        category: 9,
        playerId, player, questProgress,
        totalQuestClears, totalStories,
        rankCounts: { rank_ss: ssClears, rank_s: sClears, rank_a: aClears, rank_b: bClears },
        charClears, leaderClears, multiClears, leaderMultiClears,
        leaderPowerflips, coClears, charData, categoryMissionProgress,
        finishedQuestIds, persistedMissions,
    };
}
exports.buildAwakeContext = buildAwakeContext;
exports.AwakeComputer = {
    name: "Awake",
    buildContext(playerId, _category, _evaluationTime, missionIds) {
        return buildAwakeContext(playerId, missionIds);
    },
    compute(missionId, ctx, dbProgress) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        const actx = ctx;
        const charId = (0, character_queries_1.getCharacterIdFromMission)(missionId);
        const lastDigit = missionId % 10;
        // Quest-clear missions (checked first, independent of lastDigit)
        const qc = QUEST_CLEAR_MAP.get(missionId);
        if (qc) {
            const targets = [
                { category: qc.category, questIds: qc.questIds },
                ...((_a = qc.alternateTargets) !== null && _a !== void 0 ? _a : []),
            ];
            const matches = targets.flatMap(target => {
                var _a;
                return ((_a = ctx.questProgress[String(target.category)]) !== null && _a !== void 0 ? _a : []).filter(q => target.questIds.includes(q.questId) && q.finished);
            });
            if (matches.length === 0)
                return dbProgress;
            if (qc.timeLimitMs) {
                const limit = qc.timeLimitMs;
                if (!matches.some(q => { var _a; return ((_a = q.bestElapsedTimeMs) !== null && _a !== void 0 ? _a : Infinity) <= limit; }))
                    return dbProgress;
            }
            if (qc.leaderCharId) {
                if (!matches.some(q => q.leaderCharacterId === qc.leaderCharId))
                    return dbProgress;
            }
            return Math.max(dbProgress, 1);
        }
        // Over-limit level missions: progress is the character's current level.
        if ((0, character_overlimit_1.getAwakeLevelMissionTarget)(missionId) !== undefined) {
            const char = actx.charData.get(charId);
            const rarity = (_b = (0, assets_1.getCharacterDataSync)(Number(charId))) === null || _b === void 0 ? void 0 : _b.rarity;
            const level = char && rarity !== undefined
                ? (0, character_overlimit_1.estimateExtendedCharacterLevel)(Number(charId), rarity, char.exp)
                : 0;
            return Math.max(dbProgress, level);
        }
        // Race-composition missions (e.g., 人+龙+魔)
        if (awake_battle_rules_1.AWAKE_DIRECT_BATTLE_MISSION_IDS.has(missionId)) {
            return Math.max(dbProgress, (_c = actx.categoryMissionProgress.get(missionId)) !== null && _c !== void 0 ? _c : 0);
        }
        // Multi-character party missions
        const reqChars = MULTI_CHAR_MISSIONS.get(missionId);
        if (reqChars) {
            // Check min co_clear_count across all pairs
            let minCo = Infinity;
            for (let i = 0; i < reqChars.length - 1; i++) {
                for (let j = i + 1; j < reqChars.length; j++) {
                    const count = (_d = actx.coClears.get(coClearKey(reqChars[i], reqChars[j]))) !== null && _d !== void 0 ? _d : 0;
                    if (count < minCo)
                        minCo = count;
                }
            }
            return Math.max(dbProgress, minCo === Infinity ? 0 : minCo);
        }
        const isLeaderRequired = LEADER_REQUIRED_IDS.has(missionId);
        switch (lastDigit) {
            case AwakeType.STORY_READ:
                return Math.max(dbProgress, computeStoryOrParty(missionId, actx, charId));
            case AwakeType.PARTY_OR_SPECIAL:
                if (charId === '1')
                    return Math.max(dbProgress, ctx.totalStories);
                if (charId === '263002')
                    return Math.max(dbProgress, (_e = ctx.player.totalManaObtained) !== null && _e !== void 0 ? _e : 0);
                if (POWERFLIP_CHAR_IDS.has(missionId)) {
                    return Math.max(dbProgress, (_f = actx.leaderPowerflips.get(charId)) !== null && _f !== void 0 ? _f : 0);
                }
                return Math.max(dbProgress, isLeaderRequired
                    ? (_g = actx.leaderClears.get(charId)) !== null && _g !== void 0 ? _g : 0
                    : (_h = actx.charClears.get(charId)) !== null && _h !== void 0 ? _h : 0);
            case AwakeType.SPECIAL:
                if (charId === '1')
                    return Math.max(dbProgress, (_j = ctx.player.totalPowerflips) !== null && _j !== void 0 ? _j : 0);
                if (BOND_TOKEN_MISSION_IDS.has(missionId)) {
                    const char = actx.charData.get(charId);
                    return Math.max(dbProgress, (0, awake_battle_rules_1.isBondTokenMissionComplete)(char === null || char === void 0 ? void 0 : char.bondTokenList) ? 1 : 0);
                }
                if (COOP_MISSION_IDS.has(missionId)) {
                    return Math.max(dbProgress, (_k = actx.leaderMultiClears.get(charId)) !== null && _k !== void 0 ? _k : 0);
                }
                if (COMBO_MISSION_IDS.has(missionId)) {
                    return Math.max(dbProgress, (_l = ctx.player.maxComboAchieved) !== null && _l !== void 0 ? _l : 0);
                }
                return Math.max(dbProgress, isLeaderRequired
                    ? (_m = actx.leaderClears.get(charId)) !== null && _m !== void 0 ? _m : 0
                    : (_o = actx.charClears.get(charId)) !== null && _o !== void 0 ? _o : 0);
            case AwakeType.ALL_COMPLETE: {
                let completedCount = 0;
                for (const childMissionId of [missionId - 3, missionId - 2, missionId - 1]) {
                    const childDbProgress = (_p = actx.categoryMissionProgress.get(childMissionId)) !== null && _p !== void 0 ? _p : 0;
                    const childProgress = exports.AwakeComputer.compute(childMissionId, ctx, childDbProgress);
                    if ((0, stages_1.isMissionProgressComplete)(9, childMissionId, childProgress))
                        completedCount++;
                }
                return completedCount;
            }
        }
        return dbProgress;
    },
};
var AwakeType;
(function (AwakeType) {
    AwakeType[AwakeType["STORY_READ"] = 1] = "STORY_READ";
    AwakeType[AwakeType["PARTY_OR_SPECIAL"] = 2] = "PARTY_OR_SPECIAL";
    AwakeType[AwakeType["SPECIAL"] = 3] = "SPECIAL";
    AwakeType[AwakeType["ALL_COMPLETE"] = 4] = "ALL_COMPLETE";
})(AwakeType || (AwakeType = {}));
function computeStoryOrParty(missionId, actx, charId) {
    var _a;
    if (STORY_MISSION_IDS.has(missionId)) {
        const storyIds = (0, character_queries_1.getCharacterStoryQuestIds)(charId);
        let count = 0;
        for (const qid of storyIds)
            if (actx.finishedQuestIds.has(qid))
                count++;
        return count;
    }
    return (_a = actx.charClears.get(charId)) !== null && _a !== void 0 ? _a : 0;
}
