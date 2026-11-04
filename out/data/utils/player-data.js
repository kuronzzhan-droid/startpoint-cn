"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMergedPlayerDataSync = exports.prepareClientSerializedData = exports.getClientSerializedData = exports.getDefaultPlayerData = void 0;
const serialize_player_1 = require("./serialize-player");
const client_player_snapshot_1 = require("./client-player-snapshot");
const utils_1 = require("../../utils");
const rushEvent_1 = require("../domains/rushEvent");
const mission_1 = require("../domains/mission");
const boxGacha_1 = require("../domains/boxGacha");
const character_1 = require("../domains/character");
const player_1 = require("../domains/player");
const quest_1 = require("../domains/quest");
const equipment_1 = require("../domains/equipment");
const gacha_1 = require("../domains/gacha");
const item_1 = require("../domains/item");
const campaign_1 = require("../domains/campaign");
const option_1 = require("../domains/option");
const party_1 = require("../domains/party");
const tutorial_1 = require("../domains/tutorial");
const index_1 = require("../../lib/mission/index");
const character_helpers_1 = require("../../lib/character-helpers");
const db_1 = require("../db");
const carnival_save_state_1 = require("../../lib/carnival-save-state");
const content_snapshot_1 = require("../../content/runtime/content-snapshot");
const character_awake_extension_1 = require("../../lib/character-awake-extension");
const degree_1 = require("../domains/degree");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
/**
 * Generates default player data.
 *
 * @returns The generated default player data.
 */
function getDefaultPlayerData() {
    var _a;
    const now = (0, utils_1.getServerDate)();
    // Default values aligned with CN client PlayerSaveDataTools.createDummy()
    return {
        stamina: 10,
        staminaHealTime: new Date(),
        boostPoint: 10,
        bossBoostPoint: 3,
        transitionState: 0,
        role: 1,
        name: "冒险者",
        lastLoginTime: now,
        comment: "よろしくお願いします",
        vmoney: 100,
        freeVmoney: 10000,
        rankPoint: 0,
        starCrumb: 20000,
        bondToken: 10,
        expPool: 0,
        expPooledTime: now,
        leaderCharacterId: 1,
        partySlot: 1,
        degreeId: 1,
        birth: 19900101,
        freeMana: 20000,
        paidMana: 2000,
        enableAuto3x: false,
        totalStaminaUsed: 0,
        totalPowerflips: 0,
        totalDashes: 0,
        totalManaObtained: 0,
        maxComboAchieved: 0,
        totalLoginDays: 1,
        tutorialStep: 0,
        tutorialSkipFlag: null,
        tutorialGachaCharacterId: null,
        // Records the virtual-time offset under which timestamped save fields
        // were written. EXP-pool settlement uses it to preserve real elapsed
        // time when the global virtual clock is moved.
        timeOffset: (_a = (0, utils_1.getTimeOffset)()) !== null && _a !== void 0 ? _a : 0
    };
}
exports.getDefaultPlayerData = getDefaultPlayerData;
/**
 * Takes a playerID and returns all of the necessary data for the game client.
 *
 * @param playerId
 * @param viewerId
 * @returns
 */
function getClientSerializedData(playerId, options) {
    const prepared = prepareClientSerializedData(playerId, options);
    return prepared ? (0, client_player_snapshot_1.serializePlayerSnapshot)(prepared.data, prepared.context, prepared.options) : null;
}
exports.getClientSerializedData = getClientSerializedData;
function prepareClientSerializedData(playerId, options) {
    var _a, _b, _c, _d;
    const { preloadedPlayer, preloadedCharacterList, preloadedCharacterManaNodeList, preloadedEquipmentList, preloadedPartyGroupList, preloadedQuestProgress } = options, serializeOptions = __rest(options, ["preloadedPlayer", "preloadedCharacterList", "preloadedCharacterManaNodeList", "preloadedEquipmentList", "preloadedPartyGroupList", "preloadedQuestProgress"]);
    if (preloadedPlayer && preloadedPlayer.id !== playerId) {
        throw new Error(`Player snapshot ${preloadedPlayer.id} does not match ${playerId}.`);
    }
    // Old/imported saves can lack the bond-token row that marks a completed
    // base board as receivable. Repair it before loading the response snapshot.
    (0, character_helpers_1.reconcilePlayerManaBoardCompletionSync)(playerId, undefined, preloadedCharacterList && preloadedCharacterManaNodeList
        ? {
            characters: preloadedCharacterList,
            learnedNodes: preloadedCharacterManaNodeList,
        }
        : undefined);
    const playerData = preloadedPlayer !== null && preloadedPlayer !== void 0 ? preloadedPlayer : (0, player_1.getPlayerSync)(playerId);
    if (playerData === null)
        return null;
    const characterList = preloadedCharacterList !== null && preloadedCharacterList !== void 0 ? preloadedCharacterList : (0, character_1.getPlayerCharactersSync)(playerId);
    const learnedManaNodes = preloadedCharacterManaNodeList !== null && preloadedCharacterManaNodeList !== void 0 ? preloadedCharacterManaNodeList : (0, character_1.getPlayerCharactersManaNodesSync)(playerId);
    const playerQuestProgress = preloadedQuestProgress !== null && preloadedQuestProgress !== void 0 ? preloadedQuestProgress : (0, quest_1.getPlayerQuestProgressSync)(playerId);
    const doSerializeRushEventData = (_a = serializeOptions.serializeRushEventData) !== null && _a !== void 0 ? _a : false;
    // Compute awake mission summary for /load injection
    const awakeSummary = (0, index_1.computeAwakeSummary)(playerId, {
        player: playerData,
        characterList,
        questProgress: playerQuestProgress,
    });
    awakeSummary.manaBoardAwakeMap = (0, index_1.reconcileAwakeUnlocksFromProgress)(playerId, awakeSummary.activeMissionList.map(mission => ({
        missionId: mission.mission_id,
        progress: mission.progress_value,
    })), awakeSummary.manaBoardAwakeMap).all;
    // The client uses mana_board_awake both to unlock the Awake tab and as the
    // target node-awake level. Keep mission unlocks and persisted node state.
    const nodeAwakeLevels = (0, character_1.getPlayerCharactersManaNodeAwakeLevelsSync)(playerId);
    const linkedBoardUpdates = [];
    for (const [characterIdText, character] of Object.entries(characterList)) {
        if (character.evolutionLevel < 2)
            continue;
        const characterId = Number(characterIdText);
        const characterNodeLevels = (_b = nodeAwakeLevels[characterIdText]) !== null && _b !== void 0 ? _b : {};
        const updates = (0, character_awake_extension_1.collectLinkedManaNodeAwakeUpdates)(characterId, new Set((_c = learnedManaNodes[characterIdText]) !== null && _c !== void 0 ? _c : []), new Map(Object.entries(characterNodeLevels).map(([nodeId, level]) => [Number(nodeId), level])), character.evolutionLevel - 1);
        for (const update of updates) {
            linkedBoardUpdates.push(Object.assign({ characterId }, update));
            characterNodeLevels[update.nodeId] = update.awakeLevel;
        }
        if (updates.length > 0)
            nodeAwakeLevels[characterIdText] = characterNodeLevels;
    }
    if (linkedBoardUpdates.length > 0) {
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "load_linked_board_repair" }, () => {
            for (const update of linkedBoardUpdates) {
                (0, character_1.updatePlayerCharacterManaNodeAwakeLevelSync)(playerId, update.characterId, update.nodeId, update.awakeLevel);
            }
        });
    }
    const missionAwakeMap = new Map();
    for (const [characterId, levels] of awakeSummary.manaBoardAwakeMap) {
        const visible = (0, character_helpers_1.filterCharacterManaBoardAwakeLevels)(Number(characterId), levels, (_d = learnedManaNodes[characterId]) !== null && _d !== void 0 ? _d : []);
        if (Object.keys(visible).length > 0)
            missionAwakeMap.set(characterId, visible);
    }
    const manaBoardAwakeMap = (0, character_helpers_1.mergeManaBoardAwakeMaps)(missionAwakeMap, (0, character_helpers_1.computeManaBoardAwakeFromNodes)(nodeAwakeLevels));
    return (0, serialize_player_1.preparePlayerSerialization)({
        player: playerData,
        dailyChallengePointList: (0, player_1.getPlayerDailyChallengePointListSync)(playerId),
        triggeredTutorial: (0, tutorial_1.getPlayerTriggeredTutorialsSync)(playerId),
        clearedRegularMissionList: (0, mission_1.getPlayerClearedRegularMissionListSync)(playerId),
        characterList,
        characterManaNodeList: learnedManaNodes,
        characterManaNodeAwakeLevels: nodeAwakeLevels,
        manaBoardAwakeMap,
        partyGroupList: preloadedPartyGroupList !== null && preloadedPartyGroupList !== void 0 ? preloadedPartyGroupList : (0, party_1.getPlayerPartyGroupListSync)(playerId),
        itemList: (0, item_1.getPlayerItemsSync)(playerId),
        equipmentList: preloadedEquipmentList !== null && preloadedEquipmentList !== void 0 ? preloadedEquipmentList : (0, equipment_1.getPlayerEquipmentListSync)(playerId),
        questProgress: playerQuestProgress,
        gachaInfoList: (0, gacha_1.getPlayerGachaInfoListSync)(playerId),
        gachaCampaignList: (0, gacha_1.getPlayerGachaCampaignListSync)(playerId),
        drawnQuestList: (0, quest_1.getPlayerDrawnQuestsSync)(playerId),
        periodicRewardPointList: (0, campaign_1.getPlayerPeriodicRewardPointsSync)(playerId),
        allActiveMissionList: (0, index_1.filterToActiveMissions)((0, mission_1.getPlayerActiveMissionsSync)(playerId), (0, content_snapshot_1.getContentSnapshot)().repository),
        boxGachaList: (0, boxGacha_1.getPlayerBoxGachasSync)(playerId),
        purchasedTimesList: {},
        startDashExchangeCampaignList: (0, campaign_1.getPlayerStartDashExchangeCampaignsSync)(playerId),
        multiSpecialExchangeCampaignList: (0, campaign_1.getPlayerMultiSpecialExchangeCampaignsSync)(playerId),
        userOption: (0, option_1.getPlayerOptionsSync)(playerId),
        rushEventList: doSerializeRushEventData ? (0, rushEvent_1.getPlayerRushEventListSync)(playerId) : undefined,
        rushEventClearedFolderList: doSerializeRushEventData ? (0, rushEvent_1.getPlayerRushEventListClearedFoldersSync)(playerId) : undefined,
        rushEventPlayedPartyList: doSerializeRushEventData ? (0, rushEvent_1.getPlayerRushEventListPlayedPartiesSync)(playerId) : undefined
    }, Object.assign(Object.assign({}, serializeOptions), { activeMissionList: awakeSummary.activeMissionList }));
}
exports.prepareClientSerializedData = prepareClientSerializedData;
/**
 * Assembles a player's full server-side MergedPlayerData (no client serialization).
 * Used by the admin save export/import (snapshot round-trip).
 */
function getMergedPlayerDataSync(playerId) {
    const playerData = (0, player_1.getPlayerSync)(playerId);
    if (playerData === null)
        return null;
    return Object.assign({ player: playerData, degreeList: (0, degree_1.getPlayerPortableDegreesSync)(playerId), dailyChallengePointList: (0, player_1.getPlayerDailyChallengePointListSync)(playerId), triggeredTutorial: (0, tutorial_1.getPlayerTriggeredTutorialsSync)(playerId), clearedRegularMissionList: (0, mission_1.getPlayerClearedRegularMissionListSync)(playerId), characterList: (0, character_1.getPlayerCharactersSync)(playerId), characterManaNodeList: (0, character_1.getPlayerCharactersManaNodesSync)(playerId), characterManaNodeAwakeLevels: (0, character_1.getPlayerCharactersManaNodeAwakeLevelsSync)(playerId), partyGroupList: (0, party_1.getPlayerPartyGroupListSync)(playerId), itemList: (0, item_1.getPlayerItemsSync)(playerId), equipmentList: (0, equipment_1.getPlayerEquipmentListSync)(playerId), questProgress: (0, quest_1.getPlayerQuestProgressSync)(playerId), gachaInfoList: (0, gacha_1.getPlayerGachaInfoListSync)(playerId), gachaCampaignList: (0, gacha_1.getPlayerGachaCampaignListSync)(playerId), drawnQuestList: (0, quest_1.getPlayerDrawnQuestsSync)(playerId), periodicRewardPointList: (0, campaign_1.getPlayerPeriodicRewardPointsSync)(playerId), allActiveMissionList: (0, mission_1.getPlayerActiveMissionsSync)(playerId), categoryMissionList: (0, mission_1.getPlayerCategoryMissionListSync)(playerId), boxGachaList: (0, boxGacha_1.getPlayerBoxGachasSync)(playerId), purchasedTimesList: {}, startDashExchangeCampaignList: (0, campaign_1.getPlayerStartDashExchangeCampaignsSync)(playerId), multiSpecialExchangeCampaignList: (0, campaign_1.getPlayerMultiSpecialExchangeCampaignsSync)(playerId), userOption: (0, option_1.getPlayerOptionsSync)(playerId), rushEventList: (0, rushEvent_1.getPlayerRushEventListSync)(playerId), rushEventClearedFolderList: (0, rushEvent_1.getPlayerRushEventListClearedFoldersSync)(playerId), rushEventPlayedPartyList: (0, rushEvent_1.getPlayerRushEventListPlayedPartiesSync)(playerId) }, (0, carnival_save_state_1.getCarnivalSaveStateSync)((0, db_1.getDb)(), playerId));
}
exports.getMergedPlayerDataSync = getMergedPlayerDataSync;
