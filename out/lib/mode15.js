"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settleMode15BattleSync = exports.resetMode15RunSync = exports.cleanupLegacyMode15RescueProgressSync = exports.canJoinMode15RescueSync = exports.canStartMode15QuestSync = exports.getExpectedMode15StageSync = exports.getMode15ExclusiveGlobalPartyItemsSync = exports.getMode15ExclusivePartyItemsSync = exports.isMode15EquipmentAllowedQuest = exports.isMode15Quest = exports.getMode15QuestRef = exports.MODE15_SOLO_FIXED_REWARDS = exports.MODE15_BOSS_TOKEN_REWARDS = exports.getMode15ExclusiveItemIds = exports.MODE15_EXCLUSIVE_EQUIPMENT_IDS = exports.MODE15_PRACTICE_QUEST_ID = exports.MODE15_SOLO_REWARD_GROUP_BASE_ID = exports.MODE15_FULL_CLEAR_REWARD_GROUP_ID = exports.MODE15_BOSS_TOKEN_REWARD_GROUP_ID = exports.MODE15_DREAM_EMBLEM_ID = exports.MODE15_FULL_CLEAR_TICKET_ID = exports.MODE15_FULL_CLEAR_TOKEN_ID = exports.MODE15_TOKEN_ID = exports.MODE15_LEGACY_HARD_MULTI_EVENT_ID = exports.MODE15_MULTI_EVENT_ID = exports.MODE15_RUSH_EVENT_ID = void 0;
const db_1 = require("../data/db");
const persistence_coordinator_1 = require("./persistence-coordinator");
const types_1 = require("../data/types");
const quest_1 = require("./quest");
const types_2 = require("./types");
const gauntlet_completion_classification_1 = require("./gauntlet-completion-classification");
exports.MODE15_RUSH_EVENT_ID = 700098;
exports.MODE15_MULTI_EVENT_ID = 300098;
exports.MODE15_LEGACY_HARD_MULTI_EVENT_ID = 100098;
exports.MODE15_TOKEN_ID = 2370098;
exports.MODE15_FULL_CLEAR_TOKEN_ID = 2370097;
exports.MODE15_FULL_CLEAR_TICKET_ID = 10000143;
exports.MODE15_DREAM_EMBLEM_ID = 99;
exports.MODE15_BOSS_TOKEN_REWARD_GROUP_ID = 237009800;
exports.MODE15_FULL_CLEAR_REWARD_GROUP_ID = 237009700;
exports.MODE15_SOLO_REWARD_GROUP_BASE_ID = 237098000;
exports.MODE15_PRACTICE_QUEST_ID = exports.MODE15_RUSH_EVENT_ID * 1000 + 16;
exports.MODE15_EXCLUSIVE_EQUIPMENT_IDS = Object.freeze(Array.from({ length: 11 }, (_, index) => 100013 + index));
function getMode15ExclusiveItemIds(itemIds) {
    const restricted = new Set(exports.MODE15_EXCLUSIVE_EQUIPMENT_IDS);
    return [...new Set(itemIds.map(Number).filter(id => restricted.has(id)))];
}
exports.getMode15ExclusiveItemIds = getMode15ExclusiveItemIds;
const SOLO_STAGE_NUMBERS = [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14];
const MULTI_STAGE_NUMBERS = [5, 10, 15];
// The CN AdventEvent multiplayer client posts category 7 even though the
// server enum names category 8 ADVENT_EVENT_MULTI.  Treat 7 as canonical and
// keep 8 as a compatibility alias for old callers/saves.
const MODE15_MULTI_CATEGORY = types_2.QuestCategory.ADVENT_EVENT_SINGLE;
const MODE15_MULTI_CATEGORY_ALIASES = [
    types_2.QuestCategory.ADVENT_EVENT_SINGLE,
    types_2.QuestCategory.ADVENT_EVENT_MULTI,
];
exports.MODE15_BOSS_TOKEN_REWARDS = {
    5: 5,
    10: 10,
    15: 20,
};
const ELEMENT_TIER_1 = [1, 5, 9, 13, 42, 46];
const ELEMENT_TIER_2 = [2, 6, 10, 14, 43, 47];
const ELEMENT_TIER_3 = [3, 7, 11, 15, 44, 48];
const ELEMENT_TIER_4 = [4, 8, 12, 16, 45, 49];
const ETHER_TIER_1 = [50, 53, 56, 59, 62, 65];
const ETHER_TIER_2 = [51, 54, 57, 60, 63, 66];
const ETHER_TIER_3 = [52, 55, 58, 61, 64, 67];
function itemSet(ids, count) {
    return ids.map(id => ({ id, count }));
}
/**
 * Repeatable fixed rewards for Fantasy Gauntlet solo rounds.  These are keyed
 * only by the displayed Rush round, so bosses/fields may be redesigned without
 * changing the reward schedule.  Boss rounds 5/10/15 remain on their separate
 * multiplayer token settlement.
 */
exports.MODE15_SOLO_FIXED_REWARDS = {
    1: itemSet(ELEMENT_TIER_1, 100),
    2: itemSet(ELEMENT_TIER_1, 150),
    3: itemSet(ELEMENT_TIER_2, 100),
    4: [...itemSet(ELEMENT_TIER_2, 150), { id: exports.MODE15_DREAM_EMBLEM_ID, count: 5 }],
    6: itemSet(ELEMENT_TIER_3, 75),
    7: itemSet(ETHER_TIER_1, 50),
    8: [...itemSet(ELEMENT_TIER_3, 125), ...itemSet(ETHER_TIER_1, 50)],
    9: [...itemSet(ETHER_TIER_2, 50), { id: exports.MODE15_DREAM_EMBLEM_ID, count: 10 }],
    11: [...itemSet(ELEMENT_TIER_4, 50), ...itemSet(ETHER_TIER_1, 100)],
    12: itemSet(ETHER_TIER_2, 75),
    13: [...itemSet(ELEMENT_TIER_4, 100), ...itemSet(ETHER_TIER_3, 50)],
    14: [
        ...itemSet(ETHER_TIER_1, 100),
        ...itemSet(ETHER_TIER_2, 75),
        ...itemSet(ETHER_TIER_3, 50),
        { id: exports.MODE15_DREAM_EMBLEM_ID, count: 15 },
    ],
};
const MODE15_QUESTS = [
    ...SOLO_STAGE_NUMBERS.map(stage => ({
        stage,
        category: types_2.QuestCategory.RUSH_EVENT,
        // Rush now owns the complete visible 1..15 sequence.  Solo quest IDs
        // therefore match their displayed stage numbers exactly.
        questId: exports.MODE15_RUSH_EVENT_ID * 1000 + stage,
    })),
    ...MULTI_STAGE_NUMBERS.map((stage, index) => ({
        stage,
        category: MODE15_MULTI_CATEGORY,
        questId: exports.MODE15_MULTI_EVENT_ID * 1000 + index + 1,
    })),
].sort((a, b) => a.stage - b.stage);
const MODE15_BY_QUEST = new Map();
for (const ref of MODE15_QUESTS) {
    MODE15_BY_QUEST.set(`${Number(ref.category)}:${ref.questId}`, ref);
    if (ref.category === MODE15_MULTI_CATEGORY) {
        for (const category of MODE15_MULTI_CATEGORY_ALIASES) {
            MODE15_BY_QUEST.set(`${Number(category)}:${ref.questId}`, ref);
        }
    }
}
function getMode15QuestRef(category, questId) {
    var _a;
    return (_a = MODE15_BY_QUEST.get(`${Number(category)}:${Number(questId)}`)) !== null && _a !== void 0 ? _a : null;
}
exports.getMode15QuestRef = getMode15QuestRef;
function isMode15Quest(category, questId) {
    return getMode15QuestRef(category, questId) !== null;
}
exports.isMode15Quest = isMode15Quest;
/** Quests where Fantasy weapons and their ability souls may be equipped. */
function isMode15EquipmentAllowedQuest(category, questId) {
    return isMode15Quest(category, questId)
        || (Number(category) === Number(types_2.QuestCategory.RUSH_EVENT)
            && Number(questId) >= exports.MODE15_RUSH_EVENT_ID * 1000 + 1
            && Number(questId) <= exports.MODE15_PRACTICE_QUEST_ID);
}
exports.isMode15EquipmentAllowedQuest = isMode15EquipmentAllowedQuest;
function getMode15ExclusivePartyItemsSync(playerId, category, groupId, slot = null) {
    const clauses = ["player_id = ?", "category = ?", "group_id = ?"];
    const args = [playerId, category, groupId];
    if (slot !== null) {
        clauses.push("slot = ?");
        args.push(slot);
    }
    const rows = (0, db_1.getDb)().prepare(`
        SELECT equipment_1, equipment_2, equipment_3,
               ability_soul_1, ability_soul_2, ability_soul_3
        FROM players_parties
        WHERE ${clauses.join(" AND ")}
    `).all(...args);
    return getMode15ExclusiveItemIds(rows.flatMap(row => Object.values(row)));
}
exports.getMode15ExclusivePartyItemsSync = getMode15ExclusivePartyItemsSync;
function getMode15ExclusiveGlobalPartyItemsSync(playerId, category, partyId) {
    if (!Number.isInteger(partyId) || partyId < 1 || partyId > 120)
        return [];
    const groupId = Math.floor((partyId - 1) / 10) + 1;
    const slot = ((partyId - 1) % 10) + 1;
    return getMode15ExclusivePartyItemsSync(playerId, category, groupId, slot);
}
exports.getMode15ExclusiveGlobalPartyItemsSync = getMode15ExclusiveGlobalPartyItemsSync;
function getExpectedMode15StageSync(playerId) {
    var _a;
    // Native Rush keeps permanent quest-clear history separate from the
    // current run.  The client advances the finite folder from the number of
    // played-party markers, so the server gate must use the same source.  This
    // lets EventFolderLogic continue to see a completed event after a reset
    // without making the next run stick on stage 1.
    const progress = (0, db_1.getDb)().prepare(`
        SELECT COUNT(*) AS cleared_stage_count
        FROM players_rush_events_played_parties
        WHERE player_id = ?
          AND event_id = ?
          AND battle_type = ?
          AND round BETWEEN ? AND ?
    `).get(playerId, exports.MODE15_RUSH_EVENT_ID, types_1.RushEventBattleType.FOLDER, exports.MODE15_RUSH_EVENT_ID * 1000 + 1, exports.MODE15_RUSH_EVENT_ID * 1000 + 15);
    const clearedStageCount = Math.max(0, Math.min(15, Number((_a = progress === null || progress === void 0 ? void 0 : progress.cleared_stage_count) !== null && _a !== void 0 ? _a : 0)));
    return clearedStageCount >= 15 ? 1 : clearedStageCount + 1;
}
exports.getExpectedMode15StageSync = getExpectedMode15StageSync;
function canStartMode15QuestSync(playerId, category, questId) {
    var _a;
    const ref = getMode15QuestRef(category, questId);
    const expectedStage = getExpectedMode15StageSync(playerId);
    return {
        allowed: ref !== null && ref.stage === expectedStage,
        stage: (_a = ref === null || ref === void 0 ? void 0 : ref.stage) !== null && _a !== void 0 ? _a : null,
        expectedStage,
    };
}
exports.canStartMode15QuestSync = canStartMode15QuestSync;
/**
 * Random-recruitment guests are helpers, not owners of the room's run.
 * They may join any mode15 boss repeatedly; the one-shot sequence gate is
 * enforced only for the room host. Rewards are still granted per settlement.
 */
function canJoinMode15RescueSync(playerId, category, questId) {
    const ref = getMode15QuestRef(category, questId);
    const expectedStage = getExpectedMode15StageSync(playerId);
    if (ref === null)
        return { allowed: false, stage: null, expectedStage };
    return { allowed: true, stage: ref.stage, expectedStage };
}
exports.canJoinMode15RescueSync = canJoinMode15RescueSync;
/** Remove progress rows written by the older rescue settlement path. */
function cleanupLegacyMode15RescueProgressSync(playerId) {
    const result = (0, db_1.getDb)().prepare(`
        DELETE FROM players_quest_progress
        WHERE player_id = ?
          AND section IN (?, ?)
          AND quest_id BETWEEN ? AND ?
          AND COALESCE(host_finished, 0) = 0
    `).run(playerId, Number(types_2.QuestCategory.ADVENT_EVENT_SINGLE), Number(types_2.QuestCategory.ADVENT_EVENT_MULTI), exports.MODE15_MULTI_EVENT_ID * 1000 + 1, exports.MODE15_MULTI_EVENT_ID * 1000 + MULTI_STAGE_NUMBERS.length);
    return result.changes;
}
exports.cleanupLegacyMode15RescueProgressSync = cleanupLegacyMode15RescueProgressSync;
/** Reset only run progress; token balances and shop purchase history persist. */
function resetMode15RunSync(playerId) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "event", playerId, operation: "reset_mode15_run",
    }, () => {
        // Keep the Rush quest rows as permanent clear history.  The native
        // EventFolder classifier reads those rows for its completed tab, while
        // current-run ordering is tracked by played-party markers above.
        // Advent boss progress remains run-scoped because its visibility chain
        // is used to reveal the current run's stage-10 and stage-15 rooms.
        (0, db_1.getDb)().prepare(`
            DELETE FROM players_quest_progress
            WHERE player_id = ?
              AND section IN (?, ?)
              AND quest_id BETWEEN ? AND ?
        `).run(playerId, Number(types_2.QuestCategory.ADVENT_EVENT_SINGLE), Number(types_2.QuestCategory.ADVENT_EVENT_MULTI), exports.MODE15_MULTI_EVENT_ID * 1000 + 1, exports.MODE15_MULTI_EVENT_ID * 1000 + MULTI_STAGE_NUMBERS.length);
        (0, db_1.getDb)().prepare(`
            DELETE FROM players_quest_progress
            WHERE player_id = ? AND section = ?
              AND quest_id BETWEEN ? AND ?
        `).run(playerId, Number(types_2.QuestCategory.HARD_MULTI_EVENT), exports.MODE15_LEGACY_HARD_MULTI_EVENT_ID * 1000 + 1, exports.MODE15_LEGACY_HARD_MULTI_EVENT_ID * 1000 + MULTI_STAGE_NUMBERS.length);
        (0, db_1.getDb)().prepare(`
            DELETE FROM players_rush_events_played_parties
            WHERE player_id = ? AND event_id = ?
        `).run(playerId, exports.MODE15_RUSH_EVENT_ID);
        (0, db_1.getDb)().prepare(`
            DELETE FROM players_rush_events_cleared_folders
            WHERE player_id = ? AND event_id = ?
        `).run(playerId, exports.MODE15_RUSH_EVENT_ID);
        // Keep the Fantasy folder selected after a run reset. The patched
        // client returns directly to RushEventQuestSelect and therefore does
        // not pass through /select_folder again. A null active folder leaves
        // the legacy client displaying the cleared first round even though
        // the server has already advanced to round two.
        (0, db_1.getDb)().prepare(`
            INSERT INTO players_rush_events (
                player_id,
                event_id,
                active_rush_battle_folder_id,
                endless_battle_max_round,
                endless_battle_max_round_time,
                endless_battle_max_round_character_id_1,
                endless_battle_max_round_character_id_2,
                endless_battle_max_round_character_id_3,
                endless_battle_max_round_character_evolution_img_lvl_1,
                endless_battle_max_round_character_evolution_img_lvl_2,
                endless_battle_max_round_character_evolution_img_lvl_3
            ) VALUES (?, ?, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
            ON CONFLICT(player_id, event_id) DO UPDATE SET
                active_rush_battle_folder_id = 1,
                endless_battle_max_round = NULL,
                endless_battle_max_round_time = NULL,
                endless_battle_max_round_character_id_1 = NULL,
                endless_battle_max_round_character_id_2 = NULL,
                endless_battle_max_round_character_id_3 = NULL,
                endless_battle_max_round_character_evolution_img_lvl_1 = NULL,
                endless_battle_max_round_character_evolution_img_lvl_2 = NULL,
                endless_battle_max_round_character_evolution_img_lvl_3 = NULL
        `).run(playerId, exports.MODE15_RUSH_EVENT_ID);
    });
}
exports.resetMode15RunSync = resetMode15RunSync;
/**
 * Folder Rush visibility is driven by played-party rows rather than ordinary
 * quest progress. Solo settlements create these rows naturally; a completed
 * multiplayer boss must add the equivalent folder marker.
 */
function recordMode15BossRushRoundSync(playerId, stage, playedParty) {
    (0, db_1.getDb)().prepare(`
        INSERT OR REPLACE INTO players_rush_events_played_parties (
            character_id_1, character_id_2, character_id_3,
            unison_character_id_1, unison_character_id_2, unison_character_id_3,
            equipment_id_1, equipment_id_2, equipment_id_3,
            ability_soul_id_1, ability_soul_id_2, ability_soul_id_3,
            evolution_img_level_1, evolution_img_level_2, evolution_img_level_3,
            unison_evolution_img_level_1, unison_evolution_img_level_2, unison_evolution_img_level_3,
            player_id, event_id, round, battle_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...playedParty.characterIds, ...playedParty.unisonCharacterIds, ...playedParty.equipmentIds, ...playedParty.abilitySoulIds, ...playedParty.evolutionImgLevels, ...playedParty.unisonEvolutionImgLevels, playerId, exports.MODE15_RUSH_EVENT_ID, exports.MODE15_RUSH_EVENT_ID * 1000 + stage, types_1.RushEventBattleType.FOLDER);
}
/**
 * Apply the cross-event run rules after the ordinary quest settlement wrote
 * its clear record. Successful solo stages grant their round-keyed fixed
 * material bundle; successful boss stages grant the custom token.
 */
function settleMode15BattleSync(playerId, category, questId, accomplished, options = {}) {
    var _a, _b, _c;
    const ref = getMode15QuestRef(category, questId);
    if (ref === null)
        return null;
    if (!accomplished) {
        const preserveBoundaryStage = ref.category === MODE15_MULTI_CATEGORY;
        if (!options.rescue && !preserveBoundaryStage)
            resetMode15RunSync(playerId);
        console.log(`[MODE15] failed: player=${playerId} stage=${ref.stage}`
            + ` rescue=${!!options.rescue} preserved=${preserveBoundaryStage}`);
        return null;
    }
    const tokenAmount = (_a = exports.MODE15_BOSS_TOKEN_REWARDS[ref.stage]) !== null && _a !== void 0 ? _a : 0;
    const fullClear = ref.stage === 15 && !options.rescue;
    const soloRewards = ref.category === types_2.QuestCategory.RUSH_EVENT && !options.rescue
        ? (_b = exports.MODE15_SOLO_FIXED_REWARDS[ref.stage]) !== null && _b !== void 0 ? _b : []
        : [];
    const rewards = [];
    rewards.push(...soloRewards.map(drop => ({
        type: types_2.RewardType.ITEM,
        id: drop.id,
        count: drop.count,
    })));
    if (tokenAmount > 0)
        rewards.push({
            type: types_2.RewardType.ITEM,
            id: exports.MODE15_TOKEN_ID,
            count: tokenAmount,
        });
    if (fullClear)
        rewards.push({ type: types_2.RewardType.ITEM, id: exports.MODE15_DREAM_EMBLEM_ID, count: 200 }, { type: types_2.RewardType.ITEM, id: exports.MODE15_FULL_CLEAR_TOKEN_ID, count: 1 }, { type: types_2.RewardType.ITEM, id: exports.MODE15_FULL_CLEAR_TICKET_ID, count: 1 });
    const reward = (0, quest_1.givePlayerRewardsSync)(playerId, rewards);
    reward.mode15_additional_reward_ids = [];
    if (soloRewards.length > 0) {
        const groupId = exports.MODE15_SOLO_REWARD_GROUP_BASE_ID + ref.stage;
        reward.mode15_additional_reward_ids.push(...soloRewards.map((drop, index) => ({
            group_id: groupId,
            index: index + 1,
            number: drop.count,
        })));
    }
    if (tokenAmount > 0)
        reward.mode15_additional_reward_ids.push({
            group_id: exports.MODE15_BOSS_TOKEN_REWARD_GROUP_ID,
            index: 1,
            number: tokenAmount,
        });
    if (fullClear)
        reward.mode15_additional_reward_ids.push({ group_id: exports.MODE15_FULL_CLEAR_REWARD_GROUP_ID, index: 1, number: 200 }, { group_id: exports.MODE15_FULL_CLEAR_REWARD_GROUP_ID, index: 2, number: 1 }, { group_id: exports.MODE15_FULL_CLEAR_REWARD_GROUP_ID, index: 3, number: 1 });
    reward.mode15_rush_event = fullClear ? {
        rush_battle_reward_list: [
            { kind: 1, kind_id: exports.MODE15_DREAM_EMBLEM_ID, number: 200 },
            { kind: 1, kind_id: exports.MODE15_FULL_CLEAR_TOKEN_ID, number: 1 },
            { kind: 1, kind_id: exports.MODE15_FULL_CLEAR_TICKET_ID, number: 1 },
        ],
        rush_battle_played_party_list: null,
        endless_battle_played_party_list: null,
        is_out_of_period: false,
        endless_battle_next_round: null,
        endless_battle_max_round: null,
        high_score: null,
        best_elapsed_time_ms: null,
        old_endless_battle_max_round: null,
        old_best_elapsed_time_ms: null,
    } : null;
    // The Rush rows at 5/10/15 are client-side placeholders.  A successful
    // host clear of the real AdventEvent boss must complete the corresponding
    // placeholder so the native Rush progression hides it and reveals the
    // next round. Rescue players intentionally do not advance their own run.
    if (ref.category === MODE15_MULTI_CATEGORY && !options.rescue) {
        (0, db_1.getDb)().prepare(`
            INSERT INTO players_quest_progress (
                section, quest_id, finished, host_finished, unlocked,
                high_score, clear_rank, best_elapsed_time_ms,
                leader_character_id, multi_clear_count,
                s_plus_reward_received, player_id
            ) VALUES (?, ?, 1, 1, 1, NULL, 5, NULL, NULL, 0, 0, ?)
            ON CONFLICT(section, quest_id, player_id) DO UPDATE SET
                finished = 1,
                host_finished = 1,
                unlocked = 1,
                clear_rank = MAX(COALESCE(players_quest_progress.clear_rank, 0), 5)
        `).run(Number(types_2.QuestCategory.RUSH_EVENT), exports.MODE15_RUSH_EVENT_ID * 1000 + ref.stage, playerId);
        // The client needs a real member thumbnail for every folder marker.
        // Only record the boss boundary when the finish payload contains an
        // actual party; silently writing an empty row is worse than leaving the
        // marker absent because it makes the Rush page crash with C8601.
        if ((_c = options.playedParty) === null || _c === void 0 ? void 0 : _c.characterIds.some(id => id !== null)) {
            recordMode15BossRushRoundSync(playerId, ref.stage, options.playedParty);
        }
        else {
            console.warn(`[MODE15] skipped empty boss party marker: player=${playerId} stage=${ref.stage}`);
        }
    }
    if (fullClear) {
        (0, gauntlet_completion_classification_1.repairGauntletCompletionClassificationSync)(playerId, exports.MODE15_RUSH_EVENT_ID);
        resetMode15RunSync(playerId);
        console.log(`[MODE15] completed: player=${playerId}; token=${tokenAmount}; reset to stage 1`);
    }
    else {
        console.log(`[MODE15] cleared: player=${playerId} stage=${ref.stage} token=${tokenAmount} rescue=${!!options.rescue}`);
    }
    return reward;
}
exports.settleMode15BattleSync = settleMode15BattleSync;
