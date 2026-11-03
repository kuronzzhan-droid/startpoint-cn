"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyResetPlayerSync = exports.dailyResetPlayerDataSync = exports.collectPlayerPooledExpSync = exports.collectPlayerDataPooledExpSync = exports.deletePlayerSync = exports.replacePlayerDataSync = exports.adjustPlayerExpPoolSync = exports.updatePlayerPartySlotAsync = exports.updatePlayerSync = exports.insertDefaultPlayerSync = exports.getDefaultPlayerPartyGroupsSync = exports.insertMergedPlayerDataSync = exports.insertPlayerSync = exports.getAllPlayersSync = exports.getPlayerSync = exports.getAccountFromPlayerIdSync = exports.getPlayerFromAccountIdSync = exports.serializePlayerRushEventPlayedParty = exports.deserializePlayerRushEventPlayedParty = exports.updatePlayerDailyChallengePointSync = exports.insertPlayerDailyChallengePointListSync = exports.getPlayerDailyChallengePointListSync = void 0;
const cached_statement_1 = require("../../lib/cached-statement");
const degree_1 = require("./degree");
const types_1 = require("../types");
const utils_1 = require("../../utils");
const utils_2 = require("../utils");
const account_1 = require("./account");
const quest_1 = require("./quest");
const time_utils_1 = require("../../lib/time-utils");
const snapshot_1 = require("../../lib/mission/snapshot");
const master_data_1 = require("../../lib/mission/master-data");
const pass_card_1 = require("./pass-card");
const daily_challenge_point_lookup_json_1 = __importDefault(require("../../../assets/daily_challenge_point_lookup.json"));
const game_logging_1 = require("../../lib/game-logging");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const player_time_compat_1 = require("../../lib/player-time-compat");
const constants_1 = require("../../lib/weapon-riven/constants");
const weapon_riven_1 = require("../snapshots/weapon-riven");
function getDailyChallengePointDefaults() {
    const lookup = daily_challenge_point_lookup_json_1.default;
    const entries = [];
    for (const [idStr, data] of Object.entries(lookup)) {
        entries.push({
            id: Number(idStr),
            point: data.maxPoint,
            campaignList: []
        });
    }
    return entries;
}
function initializeCurrentPassWeekSnapshot(playerId, player, evaluationTime, questClears) {
    var _a;
    const eventId = (_a = (0, master_data_1.getMissionMasterDefinitions)(7).find(definition => definition.eventId !== undefined
        && (0, master_data_1.isMissionDefinitionEnabledAt)(definition, evaluationTime))) === null || _a === void 0 ? void 0 : _a.eventId;
    if (eventId === undefined)
        return;
    const snapshotType = (0, snapshot_1.getPassWeekSnapshotType)(eventId);
    if ((0, snapshot_1.getSnapshot)(playerId, snapshotType))
        return;
    (0, snapshot_1.takeSnapshot)(playerId, snapshotType, (0, snapshot_1.buildPeriodicSnapshotData)(playerId, player, questClears));
}
function recordCurrentPassLogin(playerId, totalLoginDays, evaluationTime) {
    const eventIds = new Set((0, master_data_1.getMissionMasterDefinitions)(8)
        .filter(definition => definition.patternType === 0
        && definition.eventId !== undefined
        && (0, master_data_1.isMissionDefinitionEnabledAt)(definition, evaluationTime))
        .map(definition => definition.eventId));
    for (const eventId of eventIds) {
        (0, pass_card_1.ensurePlayerPassCardLoginProgressSync)(playerId, eventId, totalLoginDays);
    }
}
const expPoolMax = 100000;
const tutorial_1 = require("./tutorial");
const option_1 = require("./option");
const item_1 = require("./item");
const equipment_1 = require("./equipment");
const party_1 = require("./party");
const character_1 = require("./character");
const quest_2 = require("./quest");
const gacha_1 = require("./gacha");
const boxGacha_1 = require("./boxGacha");
const assets_1 = require("../../lib/assets");
const rushEvent_1 = require("./rushEvent");
const mission_1 = require("./mission");
const campaign_1 = require("./campaign");
/**
 * Gets a player's daily challenge point list based on their id.
 *
 * @param playerId The ID of the player to get the daily challenge point list of.
 * @returns The player's daily challenge point list.
 */
function getPlayerDailyChallengePointListSync(playerId) {
    const rawEntries = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT id, point
    FROM daily_challenge_point_list_entries
    WHERE player_id = ?
    `).all(playerId);
    const rawCampaigns = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT campaign_id, additional_point, list_entry_id
    FROM daily_challenge_point_list_campaigns
    WHERE player_id = ?
    `).all(playerId);
    const campaignBuckets = {};
    for (const rawCampaign of rawCampaigns) {
        const listEntryId = rawCampaign.list_entry_id;
        let bucket = campaignBuckets[listEntryId];
        if (!bucket) {
            bucket = [];
            campaignBuckets[listEntryId] = bucket;
        }
        bucket.push({
            campaignId: rawCampaign.campaign_id,
            additionalPoint: rawCampaign.additional_point
        });
    }
    const entries = [];
    for (const rawEntry of rawEntries) {
        const id = rawEntry.id;
        entries.push({
            id: id,
            point: rawEntry.point,
            campaignList: campaignBuckets[id] || []
        });
    }
    return entries;
}
exports.getPlayerDailyChallengePointListSync = getPlayerDailyChallengePointListSync;
/**
 * Inserts a singular DailyChallengePointListEntry into the database.
 *
 * @param playerId The ID of the player.
 * @param entry The entry to insert.
 */
function insertPlayerDailyChallengePointListEntrySync(playerId, entry) {
    const id = entry.id;
    // insert into the list entry table
    (0, db_1.getDb)().prepare(`
    INSERT INTO daily_challenge_point_list_entries (id, point, player_id)
    VALUES (?, ?, ?)
    `).run(id, entry.point, playerId);
    // insert campaigns
    for (const campaign of entry.campaignList) {
        (0, db_1.getDb)().prepare(`
        INSERT INTO daily_challenge_point_list_campaigns (campaign_id, additional_point, list_entry_id, player_id)
        VALUES (?, ?, ?, ?)
        `).run(campaign.campaignId, campaign.additionalPoint, id, playerId);
    }
}
/**
 * Batch inserts a list of DailyChallengePointListEntries into the database.
 *
 * @param playerId The ID of the player.
 * @param entries The entries to insert.
 */
function insertPlayerDailyChallengePointListSync(playerId, entries) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "insert_daily_challenge_points" }, () => {
        for (const entry of entries) {
            insertPlayerDailyChallengePointListEntrySync(playerId, entry);
        }
    });
}
exports.insertPlayerDailyChallengePointListSync = insertPlayerDailyChallengePointListSync;
/**
 * Updates a player's daily challenge point for a specific entry.
 */
function updatePlayerDailyChallengePointSync(playerId, entryId, point) {
    (0, db_1.getDb)().prepare(`
    UPDATE daily_challenge_point_list_entries SET point = ?
    WHERE id = ? AND player_id = ?
    `).run(point, entryId, playerId);
}
exports.updatePlayerDailyChallengePointSync = updatePlayerDailyChallengePointSync;
/**
 * Inserts a singular item into the player's inventory.
 *
 * @param playerId The ID of the player.
 * @param itemId The ID of the item to insert.
 * @param amount The amount of the item to insert.
 */
function insertPlayerItemSync(playerId, itemId, amount) {
    (0, db_1.getDb)().prepare(`
    INSERT INTO players_items (id, amount, player_id)
    VALUES (?, ?, ?)
    `).run(Number(itemId), amount, playerId);
}
/**
 * Converts a PlayerRushEventPlayedParty object from database format.
 *
 * @param serialized The PlayerRushEventPlayedParty in database format.
 * @returns
 */
function deserializePlayerRushEventPlayedParty(serialized) {
    return {
        characterIds: [
            serialized.character_id_1,
            serialized.character_id_2,
            serialized.character_id_3
        ],
        unisonCharacterIds: [
            serialized.unison_character_id_1,
            serialized.unison_character_id_2,
            serialized.unison_character_id_3
        ],
        abilitySoulIds: [
            serialized.ability_soul_id_1,
            serialized.ability_soul_id_2,
            serialized.ability_soul_id_3
        ],
        equipmentIds: [
            serialized.equipment_id_1,
            serialized.equipment_id_2,
            serialized.equipment_id_3
        ],
        evolutionImgLevels: [
            serialized.evolution_img_level_1,
            serialized.evolution_img_level_2,
            serialized.evolution_img_level_3
        ],
        unisonEvolutionImgLevels: [
            serialized.unison_evolution_img_level_1,
            serialized.unison_evolution_img_level_2,
            serialized.unison_evolution_img_level_3
        ],
        battleType: serialized.battle_type,
        round: serialized.round
    };
}
exports.deserializePlayerRushEventPlayedParty = deserializePlayerRushEventPlayedParty;
/**
 * Converts a PlayerRushEventPlayedParty into database format.
 *
 * @param playerId The ID of the player.
 * @param eventId The ID of the rush event.
 * @param deserialized The deserialized rush party to convert.
 * @returns A RawPlayerRushEventPlayedParty
 */
function serializePlayerRushEventPlayedParty(deserialized) {
    return {
        character_id_1: deserialized.characterIds[0],
        character_id_2: deserialized.characterIds[1],
        character_id_3: deserialized.characterIds[2],
        unison_character_id_1: deserialized.unisonCharacterIds[0],
        unison_character_id_2: deserialized.unisonCharacterIds[1],
        unison_character_id_3: deserialized.unisonCharacterIds[2],
        equipment_id_1: deserialized.equipmentIds[0],
        equipment_id_2: deserialized.equipmentIds[1],
        equipment_id_3: deserialized.equipmentIds[2],
        ability_soul_id_1: deserialized.abilitySoulIds[0],
        ability_soul_id_2: deserialized.abilitySoulIds[1],
        ability_soul_id_3: deserialized.abilitySoulIds[2],
        evolution_img_level_1: deserialized.evolutionImgLevels[0],
        evolution_img_level_2: deserialized.evolutionImgLevels[1],
        evolution_img_level_3: deserialized.evolutionImgLevels[2],
        unison_evolution_img_level_1: deserialized.unisonEvolutionImgLevels[0],
        unison_evolution_img_level_2: deserialized.unisonEvolutionImgLevels[1],
        unison_evolution_img_level_3: deserialized.unisonEvolutionImgLevels[2],
    };
}
exports.serializePlayerRushEventPlayedParty = serializePlayerRushEventPlayedParty;
/**
 * Synchronously gets the first player bound to an account.
 */
function getPlayerFromAccountIdSync(accountId) {
    const response = (0, db_1.getDb)().prepare(`
    SELECT id
    FROM players
    WHERE account_id = ?
    `).get(accountId);
    if (response === undefined)
        return null;
    return getPlayerSync(response.id);
}
exports.getPlayerFromAccountIdSync = getPlayerFromAccountIdSync;
/**
 * Gets the account that is tied to an individual player.
 *
 * @param playerId The ID of the player.
 * @returns The account that is tied to the player.
 */
function getAccountFromPlayerIdSync(playerId) {
    const raw = (0, db_1.getDb)().prepare(`
    SELECT account_id
    FROM players
    WHERE id = ?
    `).get(playerId);
    return raw === undefined ? null : (0, account_1.getAccountSync)(raw.account_id);
}
exports.getAccountFromPlayerIdSync = getAccountFromPlayerIdSync;
/**
 * Converts a RawPlayer into a Player
 *
 * @param raw The raw player to convert into a player.
 * @returns The converted Player
 */
function buildPlayer(raw) {
    return {
        id: raw.id,
        stamina: raw.stamina,
        staminaHealTime: new Date(raw.stamina_heal_time),
        boostPoint: raw.boost_point,
        bossBoostPoint: raw.boss_boost_point,
        transitionState: raw.transition_state,
        role: raw.role,
        name: raw.name,
        lastLoginTime: new Date(raw.last_login_time),
        comment: raw.comment,
        vmoney: raw.vmoney,
        freeVmoney: raw.free_vmoney,
        rankPoint: raw.rank_point,
        starCrumb: raw.star_crumb,
        bondToken: raw.bond_token,
        expPool: raw.exp_pool,
        expPooledTime: new Date(raw.exp_pooled_time),
        leaderCharacterId: raw.leader_character_id,
        partySlot: raw.party_slot,
        degreeId: raw.degree_id,
        birth: raw.birth,
        freeMana: raw.free_mana,
        paidMana: raw.paid_mana,
        enableAuto3x: (0, utils_2.deserializeBoolean)(raw.enable_auto_3x),
        totalStaminaUsed: raw.total_stamina_used || 0,
        totalPowerflips: raw.total_powerflips || 0,
        totalDashes: raw.total_dashes || 0,
        totalManaObtained: raw.total_mana_obtained || 0,
        maxComboAchieved: raw.max_combo_achieved || 0,
        totalLoginDays: raw.total_login_days || 0,
        tutorialStep: raw.tutorial_step,
        tutorialSkipFlag: raw.tutorial_skip_flag === null ? null : (0, utils_2.deserializeBoolean)(raw.tutorial_skip_flag),
        tutorialGachaCharacterId: raw.tutorial_gacha_character_id,
        timeOffset: raw.time_offset,
    };
}
function getPlayerSync(playerId) {
    const raw = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT id, stamina, stamina_heal_time, boost_point, boss_boost_point,
        transition_state, role, name, last_login_time, comment,
        vmoney, free_vmoney, rank_point, star_crumb,
        bond_token, exp_pool, exp_pooled_time, leader_character_id, party_slot,
        degree_id, birth, free_mana, paid_mana, enable_auto_3x, total_stamina_used, total_powerflips, total_dashes, total_mana_obtained, max_combo_achieved, total_login_days, tutorial_step, tutorial_skip_flag, tutorial_gacha_character_id, time_offset
    FROM players
    WHERE id = ?
    `).get(playerId);
    if (raw === undefined)
        return null;
    return buildPlayer(raw);
}
exports.getPlayerSync = getPlayerSync;
function getAllPlayersSync(offset = 0, limit = 25) {
    const raw = (0, db_1.getDb)().prepare(`
    SELECT id, stamina, stamina_heal_time, boost_point, boss_boost_point,
        transition_state, role, name, last_login_time, comment,
        vmoney, free_vmoney, rank_point, star_crumb,
        bond_token, exp_pool, exp_pooled_time, leader_character_id, party_slot,
        degree_id, birth, free_mana, paid_mana, enable_auto_3x, total_stamina_used, total_powerflips, total_dashes, total_mana_obtained, max_combo_achieved, total_login_days, tutorial_step, tutorial_skip_flag, tutorial_gacha_character_id, time_offset
    FROM players
    LIMIT ?
    OFFSET ?
    `).all(limit, offset);
    return raw.map(rawPlayer => buildPlayer(rawPlayer));
}
exports.getAllPlayersSync = getAllPlayersSync;
/**
 * Inserts a player into the database.
 *
 * @param accountId The ID of the account that this player is linked to.
 * @param player The player data to insert.
 * @returns The ID of the player that was inserted.
 */
function insertPlayerSync(accountId, player) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const playerId = player.id;
    const playerIdGiven = playerId !== undefined;
    const params = {
        stamina: player.stamina,
        stamina_heal_time: player.staminaHealTime.toISOString(),
        boost_point: player.boostPoint,
        boss_boost_point: player.bossBoostPoint,
        transition_state: player.transitionState,
        role: player.role,
        name: player.name,
        last_login_time: player.lastLoginTime.toISOString(),
        comment: player.comment,
        vmoney: player.vmoney,
        free_vmoney: player.freeVmoney,
        rank_point: player.rankPoint,
        star_crumb: player.starCrumb,
        bond_token: player.bondToken,
        exp_pool: player.expPool,
        exp_pooled_time: player.expPooledTime.toISOString(),
        leader_character_id: player.leaderCharacterId,
        party_slot: player.partySlot,
        degree_id: player.degreeId,
        birth: player.birth,
        free_mana: player.freeMana,
        paid_mana: player.paidMana,
        enable_auto_3x: (0, utils_2.serializeBoolean)(player.enableAuto3x),
        total_stamina_used: (_a = player.totalStaminaUsed) !== null && _a !== void 0 ? _a : 0,
        total_powerflips: (_b = player.totalPowerflips) !== null && _b !== void 0 ? _b : 0,
        total_dashes: (_c = player.totalDashes) !== null && _c !== void 0 ? _c : 0,
        total_mana_obtained: (_d = player.totalManaObtained) !== null && _d !== void 0 ? _d : 0,
        max_combo_achieved: (_e = player.maxComboAchieved) !== null && _e !== void 0 ? _e : 0,
        total_login_days: (_f = player.totalLoginDays) !== null && _f !== void 0 ? _f : 0,
        account_id: accountId,
        tutorial_step: (_g = player.tutorialStep) !== null && _g !== void 0 ? _g : null,
        tutorial_skip_flag: player.tutorialSkipFlag !== null ? (0, utils_2.serializeBoolean)(player.tutorialSkipFlag) : null,
        tutorial_gacha_character_id: (_h = player.tutorialGachaCharacterId) !== null && _h !== void 0 ? _h : null,
        time_offset: (_j = player.timeOffset) !== null && _j !== void 0 ? _j : null,
    };
    if (playerIdGiven)
        params.id = playerId;
    const idCol = playerIdGiven ? ', id' : '';
    const idVal = playerIdGiven ? ', @id' : '';
    const insert = (0, db_1.getDb)().prepare(`
    INSERT INTO players (stamina, stamina_heal_time, boost_point, boss_boost_point,
        transition_state, role, name, last_login_time, comment, vmoney, free_vmoney,
        rank_point, star_crumb, bond_token, exp_pool, exp_pooled_time, leader_character_id,
        party_slot, degree_id, birth, free_mana, paid_mana, enable_auto_3x,
        total_stamina_used, total_powerflips, total_dashes, total_mana_obtained, max_combo_achieved, total_login_days, account_id,
        tutorial_step, tutorial_skip_flag, tutorial_gacha_character_id,
        time_offset${idCol})
    VALUES (@stamina, @stamina_heal_time, @boost_point, @boss_boost_point,
        @transition_state, @role, @name, @last_login_time, @comment,
        @vmoney, @free_vmoney, @rank_point, @star_crumb, @bond_token,
        @exp_pool, @exp_pooled_time, @leader_character_id, @party_slot,
        @degree_id, @birth, @free_mana, @paid_mana, @enable_auto_3x,
        @total_stamina_used, @total_powerflips, @total_dashes, @total_mana_obtained, @max_combo_achieved, @total_login_days, @account_id,
        @tutorial_step, @tutorial_skip_flag, @tutorial_gacha_character_id,
        @time_offset${idVal})
    `).run(params);
    // return
    return Number(insert.lastInsertRowid);
}
exports.insertPlayerSync = insertPlayerSync;
/**
 * Inserts the data from a MergedPlayerData object into the database.
 *
 * @param toInsert The data to insert into the database.
 * @returns The newly inserted player's id.
 */
function insertMergedPlayerDataSync(accountId, toInsert) {
    var _a, _b;
    const player = toInsert.player;
    const playerId = player.id;
    (0, degree_1.validatePortableDegreeList)(toInsert.degreeList);
    insertPlayerSync(accountId, player);
    for (const degree of (_a = toInsert.degreeList) !== null && _a !== void 0 ? _a : []) {
        (0, degree_1.grantPlayerDegreeSync)(playerId, degree.degreeId, degree.acquiredAt);
    }
    insertPlayerDailyChallengePointListSync(playerId, toInsert.dailyChallengePointList);
    (0, tutorial_1.insertPlayerTriggeredTutorialsSync)(playerId, toInsert.triggeredTutorial);
    (0, mission_1.insertPlayerClearedRegularMissionListSync)(playerId, toInsert.clearedRegularMissionList);
    (0, character_1.insertPlayerCharactersSync)(playerId, toInsert.characterList);
    (0, character_1.insertPlayerCharactersManaNodesSync)(playerId, toInsert.characterManaNodeList);
    for (const [characterId, levels] of Object.entries((_b = toInsert.characterManaNodeAwakeLevels) !== null && _b !== void 0 ? _b : {})) {
        for (const [nodeId, level] of Object.entries(levels)) {
            if (!Number.isSafeInteger(level) || level < 0) {
                throw new Error(`Invalid mana node awake level for character ${characterId}, node ${nodeId}.`);
            }
            (0, character_1.updatePlayerCharacterManaNodeAwakeLevelSync)(playerId, Number(characterId), Number(nodeId), level);
        }
    }
    (0, party_1.insertPlayerPartyGroupListSync)(playerId, toInsert.partyGroupList);
    (0, item_1.insertPlayerItemsSync)(playerId, Object.fromEntries(Object.entries(toInsert.itemList)
        .filter(([itemId]) => !(0, constants_1.isWeaponRivenItemId)(Number(itemId)))));
    (0, equipment_1.insertPlayerEquipmentListSync)(playerId, toInsert.equipmentList);
    (0, quest_2.insertPlayerQuestProgressListSync)(playerId, toInsert.questProgress);
    (0, gacha_1.insertPlayerGachaInfoListSync)(playerId, toInsert.gachaInfoList);
    (0, gacha_1.insertPlayerGachaCampaignListSync)(playerId, toInsert.gachaCampaignList);
    (0, quest_2.insertPlayerDrawnQuestsSync)(playerId, toInsert.drawnQuestList);
    (0, campaign_1.insertPlayerPeriodicRewardPointsListSync)(playerId, toInsert.periodicRewardPointList);
    (0, mission_1.insertPlayerActiveMissionsSync)(playerId, toInsert.allActiveMissionList);
    (0, boxGacha_1.insertPlayerBoxGachasSync)(playerId, toInsert.boxGachaList);
    (0, campaign_1.insertPlayerStartDashExchangeCampaignsSync)(playerId, toInsert.startDashExchangeCampaignList);
    (0, campaign_1.insertPlayerMultiSpecialExchangeCampaignsSync)(playerId, toInsert.multiSpecialExchangeCampaignList);
    (0, option_1.insertPlayerOptionsSync)(playerId, toInsert.userOption);
    // insert data that could be undefined.
    const rushEventList = toInsert.rushEventList;
    if (rushEventList !== undefined) {
        (0, rushEvent_1.insertPlayerRushEventListSync)(playerId, rushEventList);
    }
    const rushEventClearedFolderList = toInsert.rushEventClearedFolderList;
    if (rushEventClearedFolderList !== undefined) {
        (0, rushEvent_1.insertPlayerRushEventClearedFolderListSync)(playerId, rushEventClearedFolderList);
    }
    const rushEventPlayedPartyList = toInsert.rushEventPlayedPartyList;
    if (rushEventPlayedPartyList !== undefined) {
        (0, rushEvent_1.insertPlayerRushEventPlayedPartyListSync)(playerId, rushEventPlayedPartyList);
    }
    (0, snapshot_1.initializePeriodicMissionSnapshots)(playerId, player);
}
exports.insertMergedPlayerDataSync = insertMergedPlayerDataSync;
function getDefaultPlayerPartyGroupsSync(partyType = types_1.PartyCategory.NORMAL, characterIds = [1, null, null]) {
    const partyGroups = {};
    const partyNames = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const groupCount = 12; // CN version: 12 groups × 10 slots = 120 parties
    const character1 = characterIds[0];
    const character2 = characterIds[1];
    const character3 = characterIds[2];
    for (let i = 0; i < groupCount; i++) {
        const list = {};
        const group = {
            list: list,
            colorId: 15,
            category: partyType
        };
        for (let slot = 1; slot <= 10; slot++) {
            const name = partyNames[slot - 1];
            list[slot] = {
                name: `Party ${name}`,
                characterIds: [character1, character2, character3],
                unisonCharacterIds: [null, null, null],
                equipmentIds: [null, null, null],
                abilitySoulIds: [null, null, null],
                edited: false,
                options: {
                    allowOtherPlayersToHealMe: true
                },
                category: partyType
            };
        }
        partyGroups[(i + 1).toString()] = group;
    }
    return partyGroups;
}
exports.getDefaultPlayerPartyGroupsSync = getDefaultPlayerPartyGroupsSync;
/**
 * Inserts a default player data into the database, linked to a provided account id.
 *
 * @param accountId The account ID to link the new player to.
 * @returns The newly created player.
 */
function insertDefaultPlayerSync(accountId) {
    const player = (0, utils_2.getDefaultPlayerData)();
    const insertAll = () => (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "account", operation: "insert_default_player" }, () => {
        var _a;
        const playerId = insertPlayerSync(accountId, player);
        // daily challenge point list — initialize all 282 CDN entries
        insertPlayerDailyChallengePointListSync(playerId, getDailyChallengePointDefaults());
        // insert triggered tutorials — empty to trigger tutorial on new accounts
        (0, tutorial_1.insertPlayerTriggeredTutorialsSync)(playerId, []);
        // insert cleared regular missions
        (0, mission_1.insertPlayerClearedRegularMissionListSync)(playerId, {});
        // insert characterList
        (0, character_1.insertPlayerCharactersSync)(playerId, {
            "1": {
                entryCount: 1,
                evolutionLevel: 0,
                overLimitStep: 0,
                protection: false,
                joinTime: new Date(),
                updateTime: new Date(),
                exp: 10,
                stack: 0,
                bondTokenList: [
                    {
                        manaBoardIndex: 1,
                        status: 0
                    },
                    {
                        manaBoardIndex: 2,
                        status: 0
                    }
                ],
                manaBoardIndex: 1
            }
        });
        // insert characterManaNodeList
        (0, character_1.insertPlayerCharactersManaNodesSync)(playerId, {});
        // insert default parties
        (0, party_1.insertPlayerPartyGroupListSync)(playerId, getDefaultPlayerPartyGroupsSync());
        // insert items
        // 新号送 1 张乐享扭蛋券（原版新号福利，测试服 1102）
        (0, item_1.insertPlayerItemsSync)(playerId, { "999012": 1 });
        // insert equipment
        (0, equipment_1.insertPlayerEquipmentListSync)(playerId, {});
        // insert quest progress
        (0, quest_2.insertPlayerQuestProgressListSync)(playerId, {});
        // insert options
        (0, option_1.insertPlayerOptionsSync)(playerId, {
            "gacha_play_no_rarity_up_movie": false,
            "auto_play": false,
            "number_notation_symbol": true,
            "payment_alert": true,
            "room_number_hidden": false,
            "attention_sound_effect": true,
            "attention_vibration": false,
            "attention_enable_in_battle": true,
            "simple_ability_description": false
        });
        // insert gacha info
        (0, gacha_1.insertPlayerGachaInfoListSync)(playerId, []);
        // insert drawnQuestList
        (0, quest_2.insertPlayerDrawnQuestsSync)(playerId, [
            {
                categoryId: 6,
                questId: 5001,
                oddsId: 5
            },
            {
                categoryId: 6,
                questId: 5002,
                oddsId: 3
            },
            {
                categoryId: 6,
                questId: 5003,
                oddsId: 1
            },
            {
                categoryId: 6,
                questId: 5004,
                oddsId: 6
            },
            {
                categoryId: 6,
                questId: 5005,
                oddsId: 2
            },
            {
                categoryId: 6,
                questId: 13001,
                oddsId: 2
            },
            {
                categoryId: 6,
                questId: 13002,
                oddsId: 4
            },
            {
                categoryId: 6,
                questId: 13003,
                oddsId: 3
            },
            {
                categoryId: 6,
                questId: 13004,
                oddsId: 2
            },
            {
                categoryId: 6,
                questId: 13005,
                oddsId: 9
            },
            {
                categoryId: 6,
                questId: 13006,
                oddsId: 2
            },
            {
                categoryId: 6,
                questId: 14001,
                oddsId: 4
            },
            {
                categoryId: 6,
                questId: 14002,
                oddsId: 3
            },
            {
                categoryId: 6,
                questId: 14003,
                oddsId: 6
            },
            {
                categoryId: 6,
                questId: 14004,
                oddsId: 5
            },
            {
                categoryId: 6,
                questId: 14005,
                oddsId: 8
            },
            {
                categoryId: 6,
                questId: 14006,
                oddsId: 6
            },
            {
                categoryId: 6,
                questId: 15001,
                oddsId: 6
            },
            {
                categoryId: 6,
                questId: 15002,
                oddsId: 3
            },
            {
                categoryId: 6,
                questId: 15003,
                oddsId: 5
            },
            {
                categoryId: 6,
                questId: 15004,
                oddsId: 4
            },
            {
                categoryId: 6,
                questId: 15005,
                oddsId: 7
            },
            {
                categoryId: 6,
                oddsId: 5,
                questId: 15006
            },
            {
                categoryId: 6,
                questId: 16001,
                oddsId: 1
            },
            {
                categoryId: 6,
                questId: 16002,
                oddsId: 8
            },
            {
                categoryId: 6,
                questId: 16003,
                oddsId: 3
            },
            {
                categoryId: 6,
                questId: 16004,
                oddsId: 6
            },
            {
                categoryId: 6,
                questId: 16005,
                oddsId: 1
            },
            {
                categoryId: 6,
                questId: 16006,
                oddsId: 9
            },
            {
                categoryId: 6,
                questId: 17001,
                oddsId: 6
            },
            {
                categoryId: 6,
                questId: 17002,
                oddsId: 8
            },
            {
                categoryId: 6,
                questId: 17003,
                oddsId: 2
            },
            {
                categoryId: 6,
                questId: 17004,
                oddsId: 3
            },
            {
                categoryId: 6,
                questId: 17005,
                oddsId: 7
            },
            {
                categoryId: 6,
                questId: 17006,
                oddsId: 6
            },
            {
                categoryId: 6,
                questId: 18001,
                oddsId: 8
            },
            {
                categoryId: 6,
                questId: 18002,
                oddsId: 3
            },
            {
                categoryId: 6,
                questId: 18003,
                oddsId: 4
            },
            {
                categoryId: 6,
                questId: 18004,
                oddsId: 3
            },
            {
                categoryId: 6,
                questId: 18005,
                oddsId: 4
            },
            {
                categoryId: 6,
                questId: 18006,
                oddsId: 6
            },
            {
                categoryId: 6,
                questId: 19001,
                oddsId: 6
            },
            {
                categoryId: 6,
                questId: 19002,
                oddsId: 7
            },
            {
                categoryId: 6,
                questId: 19003,
                oddsId: 3
            },
            {
                categoryId: 6,
                questId: 19004,
                oddsId: 3
            },
            {
                categoryId: 6,
                questId: 19005,
                oddsId: 2
            },
            {
                categoryId: 6,
                questId: 19006,
                oddsId: 1
            },
            {
                categoryId: 6,
                questId: 19007,
                oddsId: 7
            },
            {
                categoryId: 6,
                questId: 19008,
                oddsId: 7
            },
            {
                categoryId: 6,
                questId: 19009,
                oddsId: 5
            },
            {
                categoryId: 6,
                questId: 19010,
                oddsId: 2
            },
            {
                categoryId: 6,
                questId: 19011,
                oddsId: 2
            },
            {
                categoryId: 6,
                questId: 19012,
                oddsId: 9
            },
            {
                categoryId: 6,
                questId: 19013,
                oddsId: 4
            },
            {
                categoryId: 6,
                questId: 19014,
                oddsId: 8
            },
            {
                categoryId: 6,
                questId: 19015,
                oddsId: 1
            },
            {
                categoryId: 6,
                questId: 19016,
                oddsId: 1
            },
            {
                categoryId: 6,
                questId: 19017,
                oddsId: 6
            },
            {
                categoryId: 6,
                questId: 19018,
                oddsId: 4
            },
            {
                categoryId: 14,
                questId: 1001,
                oddsId: 21
            },
            {
                categoryId: 14,
                questId: 1002,
                oddsId: 30
            },
            {
                categoryId: 14,
                questId: 1003,
                oddsId: 20
            },
            {
                categoryId: 14,
                questId: 1004,
                oddsId: 27
            },
            {
                categoryId: 14,
                questId: 1005,
                oddsId: 9
            },
            {
                categoryId: 14,
                questId: 1006,
                oddsId: 35
            },
        ]);
        // insert periodicReward
        (0, campaign_1.insertPlayerPeriodicRewardPointsListSync)(playerId, [
            {
                id: 1,
                point: 22,
            },
            {
                id: 2,
                point: 2,
            },
            {
                id: 3,
                point: 2,
            },
            {
                id: 10000000,
                point: 2,
            },
        ]);
        // insert active missions
        (0, mission_1.insertPlayerActiveMissionsSync)(playerId, {});
        // Seed only a new player's default gacha; imported and existing rows retain their progress.
        const defaultBoxGacha = (0, assets_1.getBoxGachaSync)(1001);
        if (defaultBoxGacha !== null) {
            (0, boxGacha_1.insertPlayerBoxGachasSync)(playerId, {
                "1001": Object.entries(defaultBoxGacha.boxes).map(([boxId, rewards]) => ({
                    boxId: Number(boxId), resetTimes: 0, isClosed: false,
                    remainingNumber: Object.values(rewards).reduce((total, reward) => total + reward.available, 0),
                })),
            });
        }
        // insert start dash campaign list
        (0, campaign_1.insertPlayerStartDashExchangeCampaignsSync)(playerId, []);
        // insert the multi special exchange campaign list
        (0, campaign_1.insertPlayerMultiSpecialExchangeCampaignsSync)(playerId, [
            {
                campaignId: 3,
                status: 1
            }
        ]);
        (0, snapshot_1.initializePeriodicMissionSnapshots)(playerId, player, {
            countCurrentLoginDay: true,
        });
        initializeCurrentPassWeekSnapshot(playerId, player, (0, utils_1.getServerDate)(), 0);
        recordCurrentPassLogin(playerId, (_a = player.totalLoginDays) !== null && _a !== void 0 ? _a : 0, (0, utils_1.getServerDate)());
        return playerId;
    });
    const finalPlayerId = insertAll();
    const finalPlayer = player;
    finalPlayer.id = finalPlayerId;
    return finalPlayer;
}
exports.insertDefaultPlayerSync = insertDefaultPlayerSync;
/**
 * Updates a player within the database.
 *
 * @param player The properties of the player to change. Id must always be present.
 */
function updatePlayerSync(player) {
    const id = player.id;
    const fieldMap = {
        'stamina': 'stamina',
        'staminaHealTime': 'stamina_heal_time',
        'boostPoint': 'boost_point',
        'bossBoostPoint': 'boss_boost_point',
        'transitionState': 'transition_state',
        'role': 'role',
        'name': 'name',
        'lastLoginTime': 'last_login_time',
        'comment': 'comment',
        'vmoney': 'vmoney',
        'freeVmoney': 'free_vmoney',
        'rankPoint': 'rank_point',
        'starCrumb': 'star_crumb',
        'bondToken': 'bond_token',
        'expPool': 'exp_pool',
        'expPooledTime': 'exp_pooled_time',
        'leaderCharacterId': 'leader_character_id',
        'partySlot': 'party_slot',
        'degreeId': 'degree_id',
        'birth': 'birth',
        'freeMana': 'free_mana',
        'paidMana': 'paid_mana',
        'enableAuto3x': 'enable_auto_3x',
        'totalStaminaUsed': 'total_stamina_used',
        'totalPowerflips': 'total_powerflips',
        'totalDashes': 'total_dashes',
        'totalManaObtained': 'total_mana_obtained',
        'maxComboAchieved': 'max_combo_achieved',
        'totalLoginDays': 'total_login_days',
        'tutorialStep': 'tutorial_step',
        'tutorialSkipFlag': 'tutorial_skip_flag',
        'tutorialGachaCharacterId': 'tutorial_gacha_character_id',
        'timeOffset': 'time_offset'
    };
    const sets = [];
    const values = [];
    for (const key in player) {
        const value = player[key];
        const mapped = fieldMap[key];
        if (mapped && value !== undefined) {
            sets.push(`${mapped} = ?`);
            if (value instanceof Date) {
                values.push(value.toISOString());
            }
            else if (typeof (value) === 'boolean') {
                values.push((0, utils_2.serializeBoolean)(value));
            }
            else if (key === 'expPool') {
                if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
                    throw new Error(`Invalid exp pool value for player ${id}: ${String(value)}`);
                }
                values.push(Math.max(0, value));
            }
            else {
                values.push(value);
            }
        }
    }
    if (sets.length > 0)
        (0, db_1.getDb)().prepare(`
        UPDATE players
        SET ${sets.join(', ')}
        WHERE id = ?
        `).run([...values, id]);
}
exports.updatePlayerSync = updatePlayerSync;
/**
 * Low-priority party selection update used by the realtime lobby. It is
 * deliberately a serializable command so an optional SQLite persistence
 * worker can execute it without importing the whole player domain.
 */
function updatePlayerPartySlotAsync(playerId, partySlot) {
    const sql = "UPDATE players SET party_slot = ? WHERE id = ?";
    return (0, persistence_coordinator_1.runPersistenceSqlCommand)({
        domain: "player", playerId, operation: "multi_change_party",
    }, [{ sql, params: [partySlot, playerId] }], () => {
        (0, db_1.getDb)().prepare(sql).run(partySlot, playerId);
    });
}
exports.updatePlayerPartySlotAsync = updatePlayerPartySlotAsync;
/**
 * Atomically changes a player's pooled experience.
 *
 * Returns the new balance, or null when the player does not exist or the
 * requested deduction would make the balance negative.
 */
function adjustPlayerExpPoolSync(playerId, delta, reason = 'unspecified') {
    if (!Number.isSafeInteger(delta)) {
        throw new Error(`Invalid exp pool delta for player ${playerId}: ${String(delta)}`);
    }
    const before = (0, db_1.getDb)().prepare(`
        SELECT exp_pool
        FROM players
        WHERE id = ?
    `).get(playerId);
    if (before === undefined)
        return null;
    const updated = (0, db_1.getDb)().prepare(`
        UPDATE players
        SET exp_pool = exp_pool + ?
        WHERE id = ?
          AND exp_pool + ? >= 0
        RETURNING exp_pool
    `).get(delta, playerId, delta);
    if (updated === undefined) {
        console.warn(`[EXP_POOL] rejected player=${playerId} reason=${reason} before=${before.exp_pool} delta=${delta}`);
        return null;
    }
    (0, game_logging_1.gameVerboseLog)(() => `[EXP_POOL] player=${playerId} reason=${reason} before=${before.exp_pool} delta=${delta} after=${updated.exp_pool}`);
    return updated.exp_pool;
}
exports.adjustPlayerExpPoolSync = adjustPlayerExpPoolSync;
const LEGACY_REPLACE_PRESERVED_RELATIONS = [
    {
        table: "player_weapon_riven_sequences",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        // V1 has no card payload. SELECT * below preserves every target column,
        // including v1.2 locked/seen, pending selection and exact affix pairs.
        table: "player_weapon_rivens",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "player_time_state",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "player_time_migration_ledger",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "players_mails",
        where: "player_id = ? AND id IN (SELECT mail_id FROM daily_vmoney_mail_grants WHERE player_id = ?)",
        parameters: (playerId) => [playerId, playerId],
    },
    {
        table: "daily_vmoney_mail_grants",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "players_follows",
        where: "follower_player_id = ? OR followed_player_id = ?",
        parameters: (playerId) => [playerId, playerId],
    },
    {
        table: "published_parties",
        where: "owner_player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "quest_npc_party_pool",
        where: "source_player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "leaderboard_runs",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "leaderboard_run_rounds",
        where: "run_id IN (SELECT id FROM leaderboard_runs WHERE player_id = ?)",
        parameters: (playerId) => [playerId],
    },
    {
        table: "five_boss_continue_receipts",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "five_boss_solo_runs",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    // These are server-owned retry ledgers. V1 replacement deletes the player
    // row and would otherwise cascade them, allowing a replayed payment or
    // mail/gacha request to apply twice after import.
    {
        table: "player_payment_receipts",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "player_operation_receipts",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "battle_settlement_ledger",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "battle_receipt_payload_queue",
        where: "player_id = ?",
        parameters: (playerId) => [playerId],
    },
    // Deleting a host cascades through the entire shared run. Preserve every
    // affected member and receipt, then restore parent rows before children.
    {
        table: "five_boss_gauntlet_runs",
        where: "host_player_id = ?",
        parameters: (playerId) => [playerId],
    },
    {
        table: "five_boss_gauntlet_members",
        where: "player_id = ? OR run_id IN (SELECT run_id FROM five_boss_gauntlet_runs WHERE host_player_id = ?)",
        parameters: (playerId) => [playerId, playerId],
    },
    {
        table: "five_boss_gauntlet_receipts",
        where: "player_id = ? OR run_id IN (SELECT run_id FROM five_boss_gauntlet_runs WHERE host_player_id = ?)",
        parameters: (playerId) => [playerId, playerId],
    },
];
// raid_event_global_kill_ledger is intentionally absent: it is global state
// without a player foreign key, so deletePlayerSync already leaves it intact.
// Replaying the same (event_id, play_id) rows would violate its primary key.
// leaderboard_settlement_results is preserved for the same reason. Its run_id
// remains valid because the target player's run rows are restored with their IDs.
function quotePlayerDataIdentifier(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
/**
 * Replaces a player's data with the provided MergedPlayerData object.
 *
 * @param replaceWith The MergedPlayerData to replace.
 */
function replacePlayerDataSync(replaceWith) {
    var _a, _b, _c, _d;
    const playerId = (_a = replaceWith === null || replaceWith === void 0 ? void 0 : replaceWith.player) === null || _a === void 0 ? void 0 : _a.id;
    if (typeof playerId !== "number" || !Number.isSafeInteger(playerId) || playerId < 1) {
        throw new Error("data.player.id: must be a safe integer >= 1");
    }
    const account = getAccountFromPlayerIdSync(playerId);
    if (account === null)
        throw new Error("No account tied to player id.");
    // Old V1 exports had no title collection. They cannot express a deliberate
    // reset of that collection; retain destination ownership in that case.
    if (replaceWith.degreeList === undefined) {
        replaceWith.degreeList = (0, degree_1.getPlayerPortableDegreesSync)(playerId);
    }
    (0, degree_1.validatePortableDegreeList)(replaceWith.degreeList);
    // Import preserves the explicit EXP balance and starts regeneration in
    // the destination's existing clock mode. Source offsets and elapsed time
    // never create an implicit destination migration or additional EXP.
    const importTimeState = (0, player_time_compat_1.getExistingPlayerTimeStateSync)(playerId, (0, db_1.getDb)());
    const importDate = (0, player_time_compat_1.getPlayerBusinessDateSync)(playerId, undefined, (0, db_1.getDb)());
    replaceWith.player.expPooledTime = importDate;
    replaceWith.player.timeOffset = (0, player_time_compat_1.getPlayerBusinessOffsetSync)(playerId, (0, db_1.getDb)());
    replaceWith.player.lastLoginTime = importDate;
    // Older exports did not contain per-node awake levels. Preserve the current
    // values for every imported learned node instead of silently resetting them.
    if (replaceWith.characterManaNodeAwakeLevels === undefined) {
        const currentLevels = (0, character_1.getPlayerCharactersManaNodeAwakeLevelsSync)(playerId);
        const restoredLevels = {};
        for (const [characterId, nodes] of Object.entries((_b = replaceWith.characterManaNodeList) !== null && _b !== void 0 ? _b : {})) {
            if (!Array.isArray(nodes) || nodes.length === 0)
                continue;
            const nodeLevels = {};
            for (const nodeId of nodes) {
                nodeLevels[nodeId] = (_d = (_c = currentLevels[characterId]) === null || _c === void 0 ? void 0 : _c[nodeId]) !== null && _d !== void 0 ? _d : 0;
            }
            restoredLevels[characterId] = nodeLevels;
        }
        replaceWith.characterManaNodeAwakeLevels = restoredLevels;
    }
    const replace = () => (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "replace_player_data" }, () => {
        const preservedRelations = LEGACY_REPLACE_PRESERVED_RELATIONS
            .filter(specification => !["player_time_state", "player_time_migration_ledger"].includes(specification.table)
            || (0, db_1.getDb)().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(specification.table))
            .map(specification => ({
            table: specification.table,
            rows: (0, db_1.getDb)().prepare(`
                SELECT * FROM ${quotePlayerDataIdentifier(specification.table)}
                WHERE ${specification.where}
            `).all(...specification.parameters(playerId)),
        }));
        deletePlayerSync(playerId);
        insertMergedPlayerDataSync(account.id, replaceWith);
        for (const relation of preservedRelations) {
            if (relation.rows.length === 0)
                continue;
            const columns = Object.keys(relation.rows[0]);
            const insert = (0, db_1.getDb)().prepare(`
                INSERT INTO ${quotePlayerDataIdentifier(relation.table)}
                    (${columns.map(quotePlayerDataIdentifier).join(", ")})
                VALUES (${columns.map(() => "?").join(", ")})
            `);
            for (const row of relation.rows)
                insert.run(...columns.map(column => row[column]));
        }
        (0, weapon_riven_1.clearInvalidWeaponRivenPartyReferences)((0, db_1.getDb)(), playerId);
        if (importTimeState) {
            // Imported periodic progress is protected until the destination's
            // next real boundary. Only advance its pre-existing local anchors.
            (0, db_1.getDb)().prepare("UPDATE player_time_state SET day_anchor_ms=?,week_anchor_ms=? WHERE player_id=?")
                .run(Math.max(importTimeState.dayAnchorMs, importDate.getTime()), Math.max(importTimeState.weekAnchorMs, importDate.getTime()), playerId);
        }
        const readbackPlayer = getPlayerSync(playerId);
        if (readbackPlayer === null)
            throw new Error("Replacement readback is missing the player.");
        const readbackAccount = getAccountFromPlayerIdSync(playerId);
        if ((readbackAccount === null || readbackAccount === void 0 ? void 0 : readbackAccount.id) !== account.id) {
            throw new Error(`Replacement readback account mismatch: expected ${account.id}.`);
        }
    });
    try {
        replace();
    }
    catch (error) {
        console.error(error);
        throw error;
    }
}
exports.replacePlayerDataSync = replacePlayerDataSync;
/**
 * Deletes a player from the database completely.
 *
 * @param playerId The ID of the player to delete
 */
function deletePlayerSync(playerId) {
    (0, db_1.getDb)().prepare(`DELETE FROM players WHERE id = ?`).run(playerId);
}
exports.deletePlayerSync = deletePlayerSync;
function collectPlayerDataPooledExpSync(player, dateNow = (0, utils_1.getServerDate)()) {
    dateNow = (0, player_time_compat_1.getPlayerBusinessDateSync)(player.id, dateNow, (0, db_1.getDb)());
    // Re-read durable state: callers may hold the object from before another
    // maintenance step. Existing markers select real time; no marker is made.
    player = getPlayerSync(player.id);
    const currentOffset = (0, player_time_compat_1.getPlayerBusinessOffsetSync)(player.id, (0, db_1.getDb)());
    const savedOffset = player.timeOffset;
    const hasSavedOffset = typeof savedOffset === "number" && Number.isFinite(savedOffset);
    let normalizedPoolTime = hasSavedOffset
        ? new Date(player.expPooledTime.getTime() + currentOffset - savedOffset)
        : player.expPooledTime;
    let checkpointChanged = !hasSavedOffset || savedOffset !== currentOffset;
    if (!Number.isFinite(normalizedPoolTime.getTime())
        || normalizedPoolTime.getTime() > dateNow.getTime()) {
        normalizedPoolTime = dateNow;
        checkpointChanged = true;
    }
    const diff = Math.max(0, Math.floor((dateNow.getTime() - normalizedPoolTime.getTime()) / 1000));
    if (diff < 60) {
        if (checkpointChanged) {
            updatePlayerSync({
                id: player.id,
                expPooledTime: normalizedPoolTime,
                timeOffset: currentOffset,
            });
        }
        return;
    }
    const earnedExp = Math.floor(diff / 60);
    const nextExpPool = player.expPool >= expPoolMax
        ? player.expPool
        : Math.min(expPoolMax, player.expPool + earnedExp);
    updatePlayerSync({
        id: player.id,
        expPooledTime: dateNow,
        expPool: nextExpPool,
        timeOffset: currentOffset,
    });
}
exports.collectPlayerDataPooledExpSync = collectPlayerDataPooledExpSync;
/**
 * Collects any pooled exp that a player might have.
 * Exp regenerates at a rate of 1 per minute.
 *
 * @param playerId The ID of the player to collect the pooled EXP of.
 */
function collectPlayerPooledExpSync(playerId, dateNow = (0, utils_1.getServerDate)()) {
    // exp regenerates at a rate of 1/min
    const playerData = getPlayerSync(playerId);
    if (!playerData)
        return;
    collectPlayerDataPooledExpSync(playerData, dateNow);
}
exports.collectPlayerPooledExpSync = collectPlayerPooledExpSync;
/**
 * Performs a daily reset for a a player data object.
 *
 * @param player The player data to perform the daily reset for
 * @param loginDate
 * @returns A boolean; whether the daily reset was performed
 */
function dailyResetPlayerDataSync(player, loginDate = (0, utils_1.getServerDate)()) {
    var _a, _b;
    const playerId = player.id;
    // Content remains on the legacy server calendar for every player. Only
    // durable reset anchors/checkpoints retain a marked player's real basis.
    const contentDate = loginDate;
    loginDate = (0, player_time_compat_1.getPlayerBusinessDateSync)(playerId, loginDate, (0, db_1.getDb)());
    const timeState = (0, player_time_compat_1.getExistingPlayerTimeStateSync)(playerId, (0, db_1.getDb)());
    player = getPlayerSync(playerId);
    const crossedDay = (0, time_utils_1.isNewDay)(loginDate, new Date((_a = timeState === null || timeState === void 0 ? void 0 : timeState.dayAnchorMs) !== null && _a !== void 0 ? _a : player.lastLoginTime.getTime()));
    const crossedWeek = (0, time_utils_1.isNewWeek)(loginDate, new Date((_b = timeState === null || timeState === void 0 ? void 0 : timeState.weekAnchorMs) !== null && _b !== void 0 ? _b : player.lastLoginTime.getTime()));
    if (crossedDay || crossedWeek) {
        return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "daily_reset_player" }, () => {
            var _a, _b, _c, _d;
            if (crossedDay) {
                updatePlayerSync({
                    id: playerId,
                    lastLoginTime: loginDate,
                    bossBoostPoint: 3,
                    boostPoint: 3,
                    totalLoginDays: ((_a = player.totalLoginDays) !== null && _a !== void 0 ? _a : 0) + 1
                });
                recordCurrentPassLogin(playerId, ((_b = player.totalLoginDays) !== null && _b !== void 0 ? _b : 0) + 1, contentDate);
                // Reset daily challenge points — sync with CDN and rebuild if missing
                const dcEntries = getPlayerDailyChallengePointListSync(playerId);
                const defaults = getDailyChallengePointDefaults();
                if (dcEntries.length === 0) {
                    insertPlayerDailyChallengePointListSync(playerId, defaults);
                }
                else {
                    // Reset existing entries to CDN max
                    for (const entry of dcEntries) {
                        const cdn = daily_challenge_point_lookup_json_1.default[String(entry.id)];
                        const maxPoint = (_c = cdn === null || cdn === void 0 ? void 0 : cdn.maxPoint) !== null && _c !== void 0 ? _c : entry.point;
                        updatePlayerDailyChallengePointSync(playerId, entry.id, maxPoint + entry.campaignList.reduce((s, c) => s + c.additionalPoint, 0));
                    }
                    // Add any new CDN entries not yet in player's list
                    const existingIds = new Set(dcEntries.map(e => e.id));
                    const missing = defaults.filter(e => !existingIds.has(e.id));
                    if (missing.length > 0) {
                        insertPlayerDailyChallengePointListSync(playerId, missing);
                    }
                }
                // reset gacha "isDailyFirst" values.
                const gachaInfo = (0, gacha_1.getPlayerGachaInfoListSync)(playerId);
                for (const gacha of gachaInfo) {
                    (0, gacha_1.updatePlayerGachaInfoSync)(playerId, {
                        gachaId: gacha.gachaId,
                        isDailyFirst: true
                    });
                }
                // reset campaigns
                const gachaCampaigns = (0, gacha_1.getPlayerGachaCampaignListSync)(playerId);
                for (const campaign of gachaCampaigns) {
                    (0, gacha_1.updatePlayerGachaCampaignSync)(playerId, campaign.gachaId, campaign.campaignId, 1);
                }
            }
            // Daily mission reset: take snapshot + wipe cache
            const questProgress = (0, quest_1.getPlayerQuestProgressSync)(playerId);
            let totalClears = 0, ss = 0, s = 0, a = 0, b = 0;
            for (const [section, quests] of Object.entries(questProgress)) {
                for (const qp of quests) {
                    if (qp.finished) {
                        totalClears++;
                        if (qp.clearRank === 5)
                            ss++;
                        else if (qp.clearRank === 4)
                            s++;
                        else if (qp.clearRank === 3)
                            a++;
                        else if (qp.clearRank === 2)
                            b++;
                    }
                }
            }
            const periodicBaseline = (0, snapshot_1.buildPeriodicSnapshotData)(playerId, player, totalClears);
            if (crossedDay) {
                (0, snapshot_1.takeSnapshot)(playerId, 'daily', periodicBaseline);
                (0, mission_1.deletePlayerCategoryMissionsSync)(playerId, 2);
                (0, mission_1.deletePlayerCategoryMissionsSync)(playerId, 6);
            }
            const activePassWeekEventId = (_d = (0, master_data_1.getMissionMasterDefinitions)(7).find(definition => definition.eventId !== undefined
                && (0, master_data_1.isMissionDefinitionEnabledAt)(definition, contentDate))) === null || _d === void 0 ? void 0 : _d.eventId;
            if (activePassWeekEventId !== undefined) {
                const snapshotType = (0, snapshot_1.getPassWeekSnapshotType)(activePassWeekEventId);
                if (crossedWeek || !(0, snapshot_1.getSnapshot)(playerId, snapshotType)) {
                    (0, snapshot_1.takeSnapshot)(playerId, snapshotType, periodicBaseline);
                }
            }
            // weekly reset
            if (crossedWeek) {
                (0, snapshot_1.takeSnapshot)(playerId, 'weekly', periodicBaseline);
                (0, mission_1.deletePlayerCategoryMissionsSync)(playerId, 7);
                (0, mission_1.deletePlayerCategoryMissionsSync)(playerId, 10);
            }
            updatePlayerSync({ id: playerId, lastLoginTime: loginDate });
            if (timeState) {
                // Advance only a marker that already exists. Ordinary login
                // never opts another player into the unfinished cutover.
                (0, db_1.getDb)().prepare("UPDATE player_time_state SET day_anchor_ms=?,week_anchor_ms=? WHERE player_id=?")
                    .run(crossedDay ? Math.max(timeState.dayAnchorMs, loginDate.getTime()) : timeState.dayAnchorMs, crossedWeek ? Math.max(timeState.weekAnchorMs, loginDate.getTime()) : timeState.weekAnchorMs, playerId);
            }
            return true;
        });
    }
    else {
        updatePlayerSync({
            id: playerId,
            lastLoginTime: loginDate,
        });
        return false;
    }
}
exports.dailyResetPlayerDataSync = dailyResetPlayerDataSync;
/**
 * Performs a daily reset for a player
 *
 * @param playerId The ID of the player to perform the daily reset for.
 * @returns A boolean; whether the daily reset was performed
 */
function dailyResetPlayerSync(playerId, loginDate = (0, utils_1.getServerDate)()) {
    const playerData = getPlayerSync(playerId);
    if (!playerData)
        return false;
    return dailyResetPlayerDataSync(playerData, loginDate);
}
exports.dailyResetPlayerSync = dailyResetPlayerSync;
const db_1 = require("../db");
