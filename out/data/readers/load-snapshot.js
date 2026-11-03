"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readLoadSnapshot = exports.readPlayerQuestProgressSync = exports.buildPlayerQuestProgress = exports.readPlayerPartyGroupListSync = exports.readPlayerCharactersManaNodesSync = exports.readPlayerCharactersSync = exports.buildPlayerCharacter = exports.buildPlayerCharacterExBoost = exports.buildCharacterBondToken = void 0;
const cached_statement_1 = require("../../lib/cached-statement");
const primitives_1 = require("../utils/primitives");
const game_logging_1 = require("../../lib/game-logging");
const types_1 = require("../types");
function buildCharacterBondToken(rawBondToken) {
    return {
        manaBoardIndex: rawBondToken.mana_board_index,
        status: rawBondToken.status
    };
}
exports.buildCharacterBondToken = buildCharacterBondToken;
function buildPlayerCharacterExBoost(exBoostStatusId, exBoostAbilityIdList) {
    if (exBoostStatusId === null || exBoostAbilityIdList === null)
        return undefined;
    return {
        statusId: exBoostStatusId,
        abilityIdList: (0, primitives_1.deserializeNumberList)(exBoostAbilityIdList)
    };
}
exports.buildPlayerCharacterExBoost = buildPlayerCharacterExBoost;
function buildPlayerCharacter(rawCharacter, bondTokens) {
    return {
        entryCount: rawCharacter.entry_count,
        evolutionLevel: rawCharacter.evolution_level,
        overLimitStep: rawCharacter.over_limit_step,
        protection: (0, primitives_1.deserializeBoolean)(rawCharacter.protection),
        joinTime: new Date(rawCharacter.join_time),
        updateTime: new Date(rawCharacter.update_time),
        exp: rawCharacter.exp,
        stack: rawCharacter.stack,
        manaBoardIndex: rawCharacter.mana_board_index,
        exBoost: buildPlayerCharacterExBoost(rawCharacter.ex_boost_status_id, rawCharacter.ex_boost_ability_id_list),
        illustrationSettings: rawCharacter.illustration_settings === null ? undefined : (0, primitives_1.deserializeNumberList)(rawCharacter.illustration_settings),
        bondTokenList: bondTokens
    };
}
exports.buildPlayerCharacter = buildPlayerCharacter;
function readPlayerCharactersSync(database, playerId) {
    const rawCharacters = (0, cached_statement_1.cachedStatement)(database, `
    SELECT id, entry_count, evolution_level, over_limit_step, protection,
        join_time, update_time, exp, stack, mana_board_index, ex_boost_status_id,
        ex_boost_ability_id_list, illustration_settings
    FROM players_characters
    WHERE player_id = ?
    `).all(playerId);
    // get bond tokens
    const rawBondTokens = (0, cached_statement_1.cachedStatement)(database, `
    SELECT mana_board_index, status, character_id
    FROM players_characters_bond_tokens
    WHERE player_id = ?
    ORDER BY character_id, mana_board_index
    `).all(playerId);
    const bondBuckets = {};
    for (const rawBondToken of rawBondTokens) {
        const characterId = rawBondToken.character_id.toString();
        let bucket = bondBuckets[characterId];
        if (!bucket) {
            bucket = [];
            bondBuckets[characterId] = bucket;
        }
        bucket.push(buildCharacterBondToken(rawBondToken));
    }
    const out = {};
    for (const rawCharacter of rawCharacters) {
        const id = rawCharacter.id.toString();
        out[id] = buildPlayerCharacter(rawCharacter, bondBuckets[id] || []);
    }
    return out;
}
exports.readPlayerCharactersSync = readPlayerCharactersSync;
function readPlayerCharactersManaNodesSync(database, playerId) {
    const rawNodes = (0, cached_statement_1.cachedStatement)(database, `
    SELECT value, character_id
    FROM players_characters_mana_nodes
    WHERE player_id = ?
    `).all(playerId);
    const buckets = {};
    for (const rawNode of rawNodes) {
        const characterId = rawNode.character_id.toString();
        let bucket = buckets[characterId];
        if (!bucket) {
            bucket = [];
            buckets[characterId] = bucket;
        }
        bucket.push(rawNode.value);
    }
    return buckets;
}
exports.readPlayerCharactersManaNodesSync = readPlayerCharactersManaNodesSync;
function readPlayerPartyGroupListSync(database, playerId, category = types_1.PartyCategory.NORMAL) {
    var _a, _b;
    const db = database;
    const rawPartyGroups = (0, cached_statement_1.cachedStatement)(db, `
    SELECT id, color_id, category
    FROM players_party_groups
    WHERE player_id = ? AND category = ?
    `).all(playerId, category);
    const rawParties = (0, cached_statement_1.cachedStatement)(db, `
    SELECT slot, name, character_id_1, character_id_2, character_id_3, unison_character_1,
        unison_character_2, unison_character_3, equipment_1, equipment_2, equipment_3,
        ability_soul_1, ability_soul_2, ability_soul_3, edited, group_id, category,
        current_battle_power, before_battle_power
    FROM players_parties
    WHERE player_id = ? AND category = ?
    `).all(playerId, category);
    const groupLists = {};
    for (const rawParty of rawParties) {
        const groupId = rawParty.group_id.toString();
        let bucket = groupLists[groupId];
        if (!bucket) {
            bucket = {};
            groupLists[groupId] = bucket;
        }
        bucket[rawParty.slot.toString()] = {
            name: rawParty.name,
            characterIds: [rawParty.character_id_1, rawParty.character_id_2, rawParty.character_id_3],
            unisonCharacterIds: [rawParty.unison_character_1, rawParty.unison_character_2, rawParty.unison_character_3],
            equipmentIds: [rawParty.equipment_1, rawParty.equipment_2, rawParty.equipment_3],
            abilitySoulIds: [rawParty.ability_soul_1, rawParty.ability_soul_2, rawParty.ability_soul_3],
            edited: (0, primitives_1.deserializeBoolean)(rawParty.edited),
            options: {
                allowOtherPlayersToHealMe: true
            },
            category: rawParty.category,
            currentBattlePower: (_a = rawParty.current_battle_power) !== null && _a !== void 0 ? _a : 0,
            beforeBattlePower: (_b = rawParty.before_battle_power) !== null && _b !== void 0 ? _b : 0
        };
    }
    const final = {};
    for (const rawPartyGroup of rawPartyGroups) {
        const id = rawPartyGroup.id.toString();
        final[id] = {
            list: groupLists[id] || [],
            colorId: rawPartyGroup.color_id,
            category: rawPartyGroup.category
        };
    }
    // Log group summary
    (0, game_logging_1.gameVerboseLog)(() => `[PARTY-READ] player=${playerId} groups=${Object.keys(final).length} totalParties=${rawParties.length}`);
    return final;
}
exports.readPlayerPartyGroupListSync = readPlayerPartyGroupListSync;
function buildPlayerQuestProgress(raw) {
    var _a, _b;
    return {
        questId: raw.quest_id,
        finished: (0, primitives_1.deserializeBoolean)(raw.finished),
        hostFinished: (0, primitives_1.deserializeBoolean)((_a = raw.host_finished) !== null && _a !== void 0 ? _a : 0),
        unlocked: (0, primitives_1.deserializeBoolean)(raw.unlocked),
        highScore: raw.high_score,
        clearRank: raw.clear_rank,
        bestElapsedTimeMs: raw.best_elapsed_time_ms,
        leaderCharacterId: raw.leader_character_id,
        multiClearCount: raw.multi_clear_count,
        sPlusRewardReceived: (0, primitives_1.deserializeBoolean)((_b = raw.s_plus_reward_received) !== null && _b !== void 0 ? _b : 0)
    };
}
exports.buildPlayerQuestProgress = buildPlayerQuestProgress;
function readPlayerQuestProgressSync(database, playerId) {
    const rawProgress = (0, cached_statement_1.cachedStatement)(database, `
    SELECT section, quest_id, finished, host_finished, unlocked, high_score, clear_rank, best_elapsed_time_ms, leader_character_id, multi_clear_count, s_plus_reward_received
    FROM players_quest_progress
    WHERE player_id = ?
    `).all(playerId);
    const mapped = {};
    for (const raw of rawProgress) {
        const section = raw.section.toString();
        let bucket = mapped[section];
        if (!bucket) {
            bucket = [];
            mapped[section] = bucket;
        }
        bucket.push(buildPlayerQuestProgress(raw));
    }
    return mapped;
}
exports.readPlayerQuestProgressSync = readPlayerQuestProgressSync;
function readLoadSnapshot(database, playerId) {
    return database.transaction(() => ({
        characterList: readPlayerCharactersSync(database, playerId),
        characterManaNodeList: readPlayerCharactersManaNodesSync(database, playerId),
        partyGroupList: readPlayerPartyGroupListSync(database, playerId),
        questProgress: readPlayerQuestProgressSync(database, playerId),
    }))();
}
exports.readLoadSnapshot = readLoadSnapshot;
