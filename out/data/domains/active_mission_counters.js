"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.incrementActiveMissionPracticeQuestChallengeCountSync = exports.getActiveMissionPracticeQuestChallengeCountSync = exports.incrementActiveMissionGachaCampaignCountSync = exports.incrementActiveMissionInjectedExpCountSync = exports.incrementActiveMissionPartyActionCountsSync = exports.incrementActiveMissionGachaCharacterCountSync = exports.incrementActiveMissionUsedManaCountSync = exports.getActiveMissionCountersSync = void 0;
const cached_statement_1 = require("../../lib/cached-statement");
const db_1 = require("../db");
function getActiveMissionCountersSync(playerId) {
    var _a, _b, _c, _d, _e, _f, _g;
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT total_used_mana_count, total_gacha_character_count,
            total_equipment_equip_count, total_unison_set_count, total_party_character_set_count,
            total_injected_exp_count, total_gacha_campaign_count
        FROM players_active_mission_counters
        WHERE player_id = ?
    `).get(playerId);
    return {
        totalUsedManaCount: Math.max(0, (_a = row === null || row === void 0 ? void 0 : row.total_used_mana_count) !== null && _a !== void 0 ? _a : 0),
        totalGachaCharacterCount: Math.max(0, (_b = row === null || row === void 0 ? void 0 : row.total_gacha_character_count) !== null && _b !== void 0 ? _b : 0),
        totalEquipmentEquipCount: Math.max(0, (_c = row === null || row === void 0 ? void 0 : row.total_equipment_equip_count) !== null && _c !== void 0 ? _c : 0),
        totalUnisonSetCount: Math.max(0, (_d = row === null || row === void 0 ? void 0 : row.total_unison_set_count) !== null && _d !== void 0 ? _d : 0),
        totalPartyCharacterSetCount: Math.max(0, (_e = row === null || row === void 0 ? void 0 : row.total_party_character_set_count) !== null && _e !== void 0 ? _e : 0),
        totalInjectedExpCount: Math.max(0, (_f = row === null || row === void 0 ? void 0 : row.total_injected_exp_count) !== null && _f !== void 0 ? _f : 0),
        totalGachaCampaignCount: Math.max(0, (_g = row === null || row === void 0 ? void 0 : row.total_gacha_campaign_count) !== null && _g !== void 0 ? _g : 0),
    };
}
exports.getActiveMissionCountersSync = getActiveMissionCountersSync;
function incrementActiveMissionUsedManaCountSync(playerId, amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0)
        return;
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT INTO players_active_mission_counters (player_id, total_used_mana_count)
        VALUES (?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
            total_used_mana_count = total_used_mana_count + excluded.total_used_mana_count
    `).run(playerId, amount);
}
exports.incrementActiveMissionUsedManaCountSync = incrementActiveMissionUsedManaCountSync;
function incrementActiveMissionGachaCharacterCountSync(playerId, amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0)
        return;
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT INTO players_active_mission_counters (player_id, total_gacha_character_count)
        VALUES (?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
            total_gacha_character_count = total_gacha_character_count + excluded.total_gacha_character_count
    `).run(playerId, amount);
}
exports.incrementActiveMissionGachaCharacterCountSync = incrementActiveMissionGachaCharacterCountSync;
function incrementActiveMissionPartyActionCountsSync(playerId, counts) {
    const equipmentEquipCount = normalizeCounterAmount(counts.equipmentEquipCount);
    const unisonSetCount = normalizeCounterAmount(counts.unisonSetCount);
    const partyCharacterSetCount = normalizeCounterAmount(counts.partyCharacterSetCount);
    if (equipmentEquipCount === 0 && unisonSetCount === 0 && partyCharacterSetCount === 0)
        return;
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT INTO players_active_mission_counters (
            player_id,
            total_equipment_equip_count,
            total_unison_set_count,
            total_party_character_set_count
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
            total_equipment_equip_count = total_equipment_equip_count + excluded.total_equipment_equip_count,
            total_unison_set_count = total_unison_set_count + excluded.total_unison_set_count,
            total_party_character_set_count = total_party_character_set_count + excluded.total_party_character_set_count
    `).run(playerId, equipmentEquipCount, unisonSetCount, partyCharacterSetCount);
}
exports.incrementActiveMissionPartyActionCountsSync = incrementActiveMissionPartyActionCountsSync;
function normalizeCounterAmount(value) {
    return Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : 0;
}
function incrementActiveMissionInjectedExpCountSync(playerId) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT INTO players_active_mission_counters (player_id, total_injected_exp_count)
        VALUES (?, 1)
        ON CONFLICT(player_id) DO UPDATE SET
            total_injected_exp_count = total_injected_exp_count + 1
    `).run(playerId);
}
exports.incrementActiveMissionInjectedExpCountSync = incrementActiveMissionInjectedExpCountSync;
function incrementActiveMissionGachaCampaignCountSync(playerId) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT INTO players_active_mission_counters (player_id, total_gacha_campaign_count)
        VALUES (?, 1)
        ON CONFLICT(player_id) DO UPDATE SET
            total_gacha_campaign_count = total_gacha_campaign_count + 1
    `).run(playerId);
}
exports.incrementActiveMissionGachaCampaignCountSync = incrementActiveMissionGachaCampaignCountSync;
function getActiveMissionPracticeQuestChallengeCountSync(playerId) {
    var _a;
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT practice_quest_challenge_count
        FROM players_active_mission_counters
        WHERE player_id = ?
    `).get(playerId);
    return Math.max(0, (_a = row === null || row === void 0 ? void 0 : row.practice_quest_challenge_count) !== null && _a !== void 0 ? _a : 0);
}
exports.getActiveMissionPracticeQuestChallengeCountSync = getActiveMissionPracticeQuestChallengeCountSync;
function incrementActiveMissionPracticeQuestChallengeCountSync(playerId) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT INTO players_active_mission_counters (player_id, practice_quest_challenge_count)
        VALUES (?, 1)
        ON CONFLICT(player_id) DO UPDATE SET
            practice_quest_challenge_count = practice_quest_challenge_count + 1
    `).run(playerId);
}
exports.incrementActiveMissionPracticeQuestChallengeCountSync = incrementActiveMissionPracticeQuestChallengeCountSync;
