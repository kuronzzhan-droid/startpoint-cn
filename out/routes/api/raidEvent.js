"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const rushEvent_1 = require("../../data/domains/rushEvent");
const player_1 = require("../../data/domains/player");
const character_1 = require("../../data/domains/character");
const mail_1 = require("../../data/domains/mail");
const party_1 = require("../../data/domains/party");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const utils_1 = require("../../utils");
const types_1 = require("../../data/types");
const utils_2 = require("../../data/utils");
const rush_1 = require("../../lib/rush");
const singleBattleQuest_1 = require("./singleBattleQuest");
const raidEventGlobal_1 = require("../../lib/raidEventGlobal");
const special_event_parties_1 = require("../../lib/special-event-parties");
const game_logging_1 = require("../../lib/game-logging");
const mode15_optional_1 = require("../../lib/mode15-optional");
const raid_event_config_1 = require("../../lib/raid-event-config");
const assets_1 = require("../../lib/assets");
const types_2 = require("../../lib/types");
const activity_degree_rewards_1 = require("../../lib/activity-degree-rewards");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
var ResetQuestType;
(function (ResetQuestType) {
    ResetQuestType[ResetQuestType["EMPTY"] = 0] = "EMPTY";
    ResetQuestType[ResetQuestType["FOLDER"] = 1] = "FOLDER";
    ResetQuestType[ResetQuestType["ENDLESS"] = 2] = "ENDLESS";
})(ResetQuestType || (ResetQuestType = {}));
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    // ---- summary (entry point) ----
    fastify.post("/summary", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        if (!Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !(0, raid_event_config_1.isSupportedRaidEventId)(eventId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error", "message": "No player bound to account."
            });
        // Rush event data for played party tracking
        let rushEventData = (0, rushEvent_1.getPlayerRushEventSync)(playerId, eventId);
        if (rushEventData === null) {
            yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "event", playerId, operation: "raid_summary_initialize",
            }, () => {
                if ((0, rushEvent_1.getPlayerRushEventSync)(playerId, eventId) === null) {
                    (0, rushEvent_1.insertPlayerRushEventSync)(playerId, (0, rushEvent_1.getDefaultPlayerRushEventSync)(eventId));
                }
            });
            rushEventData = (0, rushEvent_1.getPlayerRushEventSync)(playerId, eventId);
        }
        if (rushEventData === null) {
            throw new Error(`Rush event ${eventId} could not be initialized for player ${playerId}.`);
        }
        const clearedFolderIdList = (0, rushEvent_1.getPlayerRushEventClearedFoldersSync)(playerId, eventId);
        const serializedPlayedParties = (0, rush_1.getSerializedPlayerRushEventPlayedPartiesSync)(playerId, eventId);
        const settlement = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId, operation: "raid_summary_rewards",
        }, () => {
            const raidBoss = (0, raidEventGlobal_1.getRaidEventGlobalBossSync)(eventId);
            return {
                raidBoss,
                rewardClaim: (0, raidEventGlobal_1.claimRaidEventOverallRewardsSync)(playerId, eventId, raidBoss.totalKillCount),
            };
        });
        const raidBoss = settlement.raidBoss;
        const rewardClaim = settlement.rewardClaim;
        const playerAfterClaim = rewardClaim.rewardResult ? (0, player_1.getPlayerSync)(playerId) : null;
        if (rewardClaim.rewardResult && playerAfterClaim === null) {
            throw new Error(`Player ${playerId} disappeared during Raid reward settlement.`);
        }
        const questKillCounts = (0, raidEventGlobal_1.getRaidEventQuestKillCountsSync)(eventId);
        (0, game_logging_1.gameVerboseLog)(() => { var _a, _b; return `[RAID] summary: folderParties=${Object.keys((_a = serializedPlayedParties.folderParties) !== null && _a !== void 0 ? _a : {}).length} endlessParties=${Object.keys((_b = serializedPlayedParties.endlessParties) !== null && _b !== void 0 ? _b : {}).length}`; });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": Object.assign(Object.assign({ "aggregated_time": (0, utils_2.clientSerializeDate)((0, utils_1.getServerDate)()), "auto_start_point": 0, "kill_count_reward_data": {
                    "received_up_to": rewardClaim.receivedUpTo,
                    "reward_list": rewardClaim.rewardList,
                }, "quest_list": questKillCounts, "raid_boss": {
                    "hp_percentage": raidBoss.hpPercentage,
                    "total_kill_count": raidBoss.totalKillCount,
                } }, (rewardClaim.rewardResult && playerAfterClaim ? {
                "user_info": {
                    "free_mana": playerAfterClaim.freeMana,
                    "free_vmoney": playerAfterClaim.freeVmoney,
                    "exp_pool": playerAfterClaim.expPool,
                },
                "character_list": rewardClaim.rewardResult.character_list,
                "joined_character_id_list": rewardClaim.rewardResult.joined_character_id_list,
                "equipment_list": rewardClaim.rewardResult.equipment_list,
                "item_list": rewardClaim.rewardResult.items,
            } : {})), { "mail_arrived": (0, mail_1.getPlayerMailCountSync)(playerId, true) > 0, "endless_battle_next_round": rushEventData.endlessBattleNextRound, "active_rush_battle_folder_id": rushEventData.activeRushBattleFolderId, "endless_battle_played_max_round": rushEventData.endlessBattleNextRound, "cleared_folder_id_list": clearedFolderIdList, "endless_battle_played_party_list": serializedPlayedParties.endlessParties, "rush_battle_played_party_list": serializedPlayedParties.folderParties, "endless_battle_my_ranking": (0, rush_1.getPlayerRushEventEndlessBattleRankingSync)(playerId, eventId, { rushEventData }) })
        });
    }));
    // ---- get_boss ----
    fastify.post("/get_boss", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        if (!Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !(0, raid_event_config_1.isSupportedRaidEventId)(eventId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error", "message": "No player bound to account."
            });
        const raidBoss = (0, raidEventGlobal_1.getRaidEventGlobalBossSync)(eventId);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "raid_boss": {
                    "hp_percentage": raidBoss.hpPercentage,
                    "total_kill_count": raidBoss.totalKillCount
                }
            }
        });
    }));
    // ---- ranking_reward ----
    fastify.post("/ranking_reward", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = Number(body.event_id);
        if (!viewerId || isNaN(viewerId) || !Number.isInteger(eventId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error", "message": "No player bound to account."
            });
        const degreeIds = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId, operation: "raid_ranking_reward",
        }, () => (0, activity_degree_rewards_1.grantEligibleRaidEventDegreesSync)(playerId, eventId));
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "reward_list": degreeIds.map(degreeId => ({
                    kind: 7,
                    kind_id: degreeId,
                    number: 1,
                })),
                "degree_list": degreeIds.map(degreeId => ({
                    viewer_id: viewerId,
                    degree_id: degreeId,
                })),
                "status": 1
            }
        });
    }));
    // ---- party (get event party groups) ----
    fastify.post("/party", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error", "message": "No player bound to account."
            });
        // Category 4 used to be shared by Raid and Rush. Copy it only as a
        // one-time fallback; existing category 3 Raid parties always win.
        const playerPartyGroups = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "raid_party_defaults",
        }, () => (0, special_event_parties_1.ensureSpecialEventPartyGroupsSync)(playerId, types_1.PartyCategory.RAID, types_1.PartyCategory.RUSH, {
            getGroups: party_1.getPlayerPartyGroupListSync,
            getDefaults: player_1.getDefaultPlayerPartyGroupsSync,
            ensureGroups: party_1.ensurePlayerPartyGroupListSync,
        }));
        const group1 = playerPartyGroups['1'];
        const partyList = [];
        if (group1 && group1.list) {
            let count = 0;
            for (const [pidStr, party] of Object.entries(group1.list)) {
                if (count >= 3)
                    break;
                count++;
                partyList.push({
                    ability_soul_ids: party.abilitySoulIds,
                    character_ids: party.characterIds,
                    equipment_ids: party.equipmentIds,
                    unison_character_ids: party.unisonCharacterIds,
                    options: { allow_other_players_to_heal_me: party.options.allowOtherPlayersToHealMe },
                    party_edited: party.edited,
                    party_id: Number(pidStr),
                    party_name: party.name
                });
            }
        }
        // Fallback: fill empty parties with leader characters if NORMAL is empty
        while (partyList.length < 3) {
            const pid = partyList.length + 1;
            const playerChars = (0, character_1.getPlayerCharactersSync)(playerId);
            const leaderIds = Object.keys(playerChars).map(Number).filter(id => id > 0).sort((a, b) => a - b);
            const usedIds = new Set(partyList.flatMap(p => p.character_ids.filter(c => c !== null)));
            const leaderId = (_a = leaderIds.find(id => !usedIds.has(id))) !== null && _a !== void 0 ? _a : null;
            partyList.push({
                ability_soul_ids: [null, null, null],
                character_ids: [leaderId, null, null],
                equipment_ids: [null, null, null],
                unison_character_ids: [null, null, null],
                options: { allow_other_players_to_heal_me: true },
                party_edited: false,
                party_id: pid,
                party_name: `Party ${pid}`
            });
        }
        const userPartyGroupList = [{
                "party_group_color_id": (0, special_event_parties_1.resolvePartyGroupColorId)(group1),
                "party_group_id": 1,
                "party_list": partyList
            }];
        const partyDump = userPartyGroupList.map(g => ({
            gid: g.party_group_id,
            parties: g.party_list.map(p => ({ pid: p.party_id, chars: p.character_ids, unisons: p.unison_character_ids }))
        }));
        (0, game_logging_1.gameVerboseLog)(() => `[RAID] party: response=${JSON.stringify(partyDump)}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "user_party_group_list": userPartyGroupList
            }
        });
    }));
    // ---- ranking ----
    fastify.post("/ranking", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "aggregated_time": "",
                "quest_list": {}
            }
        });
    }));
    // ---- ranking/party (view other player's party) ----
    fastify.post("/ranking/party", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "raid_ranking_party": []
            }
        });
    }));
    // ---- battle/start ----
    fastify.post("/battle/start", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        (0, game_logging_1.gameVerboseLog)(() => `[RAID] battle/start body: questId=${body.quest_id} eventId=${body.event_id} partyGroup=${body.party_group_id}`);
        if (!Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !Number.isSafeInteger(body.quest_id)
            || !Number.isSafeInteger(body.party_group_id)
            || body.party_group_id <= 0
            || typeof body.play_id !== "string"
            || body.play_id.trim().length === 0
            || typeof body.is_auto_start_mode !== "boolean")
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error", "message": "No player bound to account."
            });
        const questEventId = (0, raid_event_config_1.getRaidEventIdForQuest)(body.quest_id);
        if (questEventId === null
            || !(0, raid_event_config_1.isRaidEventQuestId)(questEventId, body.quest_id)
            || (body.event_id !== undefined && body.event_id !== questEventId)
            || (0, assets_1.getQuestFromCategorySync)(types_2.QuestCategory.RAID_EVENT, body.quest_id) === null)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Quest doesn't exist."
            });
        const restricted = (0, mode15_optional_1.getMode15ExclusivePartyItemsSync)(playerId, types_1.PartyCategory.RAID, body.party_group_id);
        if (restricted.length > 0) {
            console.log(`[MODE15] exclusive equipment denied in raid: player=${playerId} items=${restricted.join(",")}`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: 4050 }),
                data: {},
            });
        }
        // Register active quest for /single_battle_quest/finish
        let rivenParties = [];
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "single-quest", playerId, operation: "raid_start",
        }, () => {
            var _a;
            // Weapon riven battle rule (author 2026-10-27 15:17), per saved party of the raid group.
            if (((_a = (0, assets_1.getQuestFromCategorySync)(types_2.QuestCategory.RAID_EVENT, body.quest_id)) === null || _a === void 0 ? void 0 : _a.fixedParty) === undefined) {
                const rivenParty = require("../../data/domains/weapon-riven-party");
                rivenParties = rivenParty.enforceWeaponRivenStartPartiesSync(playerId, types_1.PartyCategory.RAID, rivenParty.getSavedPartyIdsInGroupSync(playerId, types_1.PartyCategory.RAID, body.party_group_id));
            }
            (0, singleBattleQuest_1.insertActiveQuest)(playerId, {
                questId: body.quest_id,
                category: types_2.QuestCategory.RAID_EVENT,
                useBossBoostPoint: false,
                useBoostPoint: false,
                isAutoStartMode: body.is_auto_start_mode,
                isMulti: false,
                eventId: questEventId,
                playId: body.play_id,
                continueCount: 0
            });
        });
        const rivenData = {};
        if (rivenParties.length > 0) {
            yield require("../../lib/weapon-riven/party-refresh").refreshWeaponRivenPartiesAfterCommit(playerId, rivenParties);
            rivenData.party_info_list = require("../../lib/weapon-riven/client").projectWeaponRivenClientResponse(rivenParties, require("../../lib/client-admission").hasWeaponRivenCapability(request));
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": rivenData
        });
    }));
    // ---- select_folder ----
    fastify.post("/select_folder", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !(0, raid_event_config_1.isSupportedRaidEventId)(body.event_id))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error", "message": "No player bound to account."
            });
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId, operation: "raid_select_folder",
        }, () => (0, rushEvent_1.updatePlayerRushEventSync)(playerId, {
            eventId: body.event_id, activeRushBattleFolderId: body.folder_id,
        }));
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({ "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }), "data": {} });
    }));
    // ---- reset ----
    fastify.post("/reset", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        const questType = body.quest_type;
        const resetTargetId = body.reset_target_id;
        const isResetAfterTargetRound = body.is_reset_after_target_round;
        (0, game_logging_1.gameVerboseLog)(() => `[RAID] reset: eventId=${eventId} questType=${questType}`);
        if (!Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !(0, raid_event_config_1.isSupportedRaidEventId)(eventId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error", "message": "No player bound to account."
            });
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId, operation: "raid_reset",
        }, () => {
            if (questType === ResetQuestType.FOLDER) {
                if (resetTargetId !== undefined) {
                    (0, rushEvent_1.deletePlayerRushEventPlayedPartiesUntilSync)(playerId, eventId, types_1.RushEventBattleType.FOLDER, resetTargetId);
                }
                else {
                    (0, rushEvent_1.updatePlayerRushEventSync)(playerId, { eventId: eventId, activeRushBattleFolderId: null });
                    (0, rushEvent_1.deletePlayerRushEventPlayedPartyListSync)(playerId, eventId, types_1.RushEventBattleType.FOLDER);
                }
            }
            else if (resetTargetId !== undefined) {
                if (isResetAfterTargetRound) {
                    (0, rushEvent_1.deletePlayerRushEventPlayedPartiesUntilSync)(playerId, eventId, types_1.RushEventBattleType.ENDLESS, resetTargetId);
                }
                else {
                    (0, rushEvent_1.deletePlayerRushEventPlayedPartySync)(playerId, eventId, resetTargetId, types_1.RushEventBattleType.ENDLESS);
                }
            }
        });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({ "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }), "data": {} });
    }));
});
exports.default = routes;
