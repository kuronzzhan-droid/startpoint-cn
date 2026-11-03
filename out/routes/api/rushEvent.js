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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rushEventFolderMaxRounds = exports.getRushEventFolderMaxRounds = void 0;
const public_payload_1 = require("../../lib/weapon-riven/public-payload");
const routine_game_logging_1 = require("../../lib/routine-game-logging");
const types_1 = require("../../data/types");
const rushEvent_1 = require("../../data/domains/rushEvent");
const player_1 = require("../../data/domains/player");
const party_1 = require("../../data/domains/party");
const session_1 = require("../../data/domains/session");
const request_diagnostics_1 = require("../../lib/request-diagnostics");
const assets_1 = require("../../lib/assets");
const types_2 = require("../../lib/types");
const abyss_time_revision_1 = require("../../lib/abyss-time-revision");
const abyss_modes_1 = require("../../lib/abyss-modes");
const abyss_tower_progress_1 = require("../../data/domains/abyss-tower-progress");
const utils_1 = require("../../utils");
const singleBattleQuest_1 = require("./singleBattleQuest");
const rush_1 = require("../../lib/rush");
const utils_2 = require("../../data/utils");
const activeAccount_1 = require("../../data/activeAccount");
const rush_event_ranking_reward_json_1 = __importDefault(require("../../../assets/rush_event_ranking_reward.json"));
const special_event_parties_1 = require("../../lib/special-event-parties");
const rush_event_folder_lock_1 = require("../../lib/rush-event-folder-lock");
const mode15_optional_1 = require("../../lib/mode15-optional");
const stamina_1 = require("../../lib/stamina");
const rush_event_folder_rounds_1 = require("../../lib/rush-event-folder-rounds");
Object.defineProperty(exports, "getRushEventFolderMaxRounds", { enumerable: true, get: function () { return rush_event_folder_rounds_1.getRushEventFolderMaxRounds; } });
Object.defineProperty(exports, "rushEventFolderMaxRounds", { enumerable: true, get: function () { return rush_event_folder_rounds_1.rushEventFolderMaxRounds; } });
const gauntlet_entry_rank_1 = require("../../lib/gauntlet-entry-rank");
const activity_degree_rewards_1 = require("../../lib/activity-degree-rewards");
const service_1 = require("../../lib/leaderboard/service");
const competition_1 = require("../../lib/leaderboard/competition");
const presentation_1 = require("../../lib/leaderboard/presentation");
const availability_1 = require("../../lib/leaderboard/availability");
const rush_party_categories_1 = require("../../lib/rush-party-categories");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
var ResetQuestType;
(function (ResetQuestType) {
    ResetQuestType[ResetQuestType["EMPTY"] = 0] = "EMPTY";
    ResetQuestType[ResetQuestType["FOLDER"] = 1] = "FOLDER";
    ResetQuestType[ResetQuestType["ENDLESS"] = 2] = "ENDLESS";
})(ResetQuestType || (ResetQuestType = {}));
const rankingRewards = rush_event_ranking_reward_json_1.default;
const MODE15_VISIBLE_PARTY_SET_COUNT = 3;
function repairDeepAbyssEndlessFolderLockSync(playerId, rushEventData) {
    if (!(0, rush_event_folder_lock_1.isStaleDeepAbyssEndlessFolderLock)(rushEventData.eventId, rushEventData.activeRushBattleFolderId))
        return rushEventData;
    (0, rushEvent_1.updatePlayerRushEventSync)(playerId, {
        eventId: rushEventData.eventId,
        activeRushBattleFolderId: null,
    });
    console.warn(`[RUSH] repaired stale Deep Abyss endless folder lock: `
        + `player=${playerId} eventId=${rushEventData.eventId} folderId=2`);
    return Object.assign(Object.assign({}, rushEventData), { activeRushBattleFolderId: null });
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.addHook("preHandler", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        if (!body || !Number.isSafeInteger(body.viewer_id))
            return;
        const eventId = (_a = body.event_id) !== null && _a !== void 0 ? _a : Math.floor(Number(body.quest_id) / 1000);
        if (!(0, abyss_modes_1.isAbyssEvent)(eventId))
            return;
        const session = yield (0, session_1.getSession)(String(body.viewer_id));
        if (!session)
            return;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null)
            return;
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId, operation: "abyss_refresh",
        }, () => (0, abyss_tower_progress_1.refreshPlayerAbyssTowersSync)(playerId));
        if (eventId === abyss_modes_1.ABYSS_EX_EVENT_ID && !(0, abyss_tower_progress_1.hasAbyssExUnlockSync)(playerId)
            && /\/(select_folder|battle\/start|endless_battle)$/.test(request.url.split("?")[0])) {
            (0, request_diagnostics_1.setRequestOutcome)(request, "rush_ex_locked");
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id, result_code: 4050 }), data: {},
            });
        }
    }));
    fastify.post("/summary", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        (0, routine_game_logging_1.routineGameLog)("rush", () => `[RUSH] summary: viewer=${viewerId} eventId=${eventId}`);
        if (isNaN(viewerId) || isNaN(eventId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        // The client entry is hidden by a forward asset patch.  Keep this
        // server-side guard for clients that still have the old event table
        // cached or retain a stale navigation stack.
        // Initialize and repair event state in one player-owned transaction so
        // summary loading cannot race with a reset or a concurrent login.
        const rushEventData = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId, operation: "rush_summary_maintenance",
        }, () => {
            let current = (0, rushEvent_1.getPlayerRushEventSync)(playerId, eventId);
            if (current === null) {
                current = (0, rushEvent_1.getDefaultPlayerRushEventSync)(eventId);
                (0, rushEvent_1.insertPlayerRushEventSync)(playerId, current);
            }
            // Older or modified clients could persist the endless folder (2)
            // as the regular Deep Abyss difficulty lock. The client then
            // refuses to open folder 1 with "challenging another difficulty".
            current = repairDeepAbyssEndlessFolderLockSync(playerId, current);
            // Older reset builds left the active folder null, while the
            // Fantasy client now returns straight to folder 1 without calling
            // /select_folder. Repair those saves during summary loading.
            if (eventId === mode15_optional_1.MODE15_RUSH_EVENT_ID && current.activeRushBattleFolderId === null) {
                (0, rushEvent_1.updatePlayerRushEventSync)(playerId, { eventId, activeRushBattleFolderId: 1 });
                current = Object.assign(Object.assign({}, current), { activeRushBattleFolderId: 1 });
                console.log(`[MODE15] repaired active Rush folder: player=${playerId} folder=1`);
            }
            return current;
        });
        // get cleared folder id list
        const clearedFolderIdList = (0, rushEvent_1.getPlayerRushEventClearedFoldersSync)(playerId, eventId);
        // get serialized parties
        const serializedPlayedParties = (0, rush_1.getSerializedPlayerRushEventPlayedPartiesSync)(playerId, eventId);
        (0, routine_game_logging_1.routineGameLog)("rush", () => { var _a, _b; return `[RUSH] summary: folderParties=${Object.keys((_a = serializedPlayedParties.folderParties) !== null && _a !== void 0 ? _a : {}).length} endlessParties=${Object.keys((_b = serializedPlayedParties.endlessParties) !== null && _b !== void 0 ? _b : {}).length}`; });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "endless_battle_next_round": rushEventData.endlessBattleNextRound,
                "endless_battle_max_round": rushEventData.endlessBattleMaxRound,
                "active_rush_battle_folder_id": rushEventData.activeRushBattleFolderId,
                "endless_battle_played_max_round": rushEventData.endlessBattleMaxRound,
                "cleared_folder_id_list": clearedFolderIdList,
                "endless_battle_played_party_list": serializedPlayedParties.endlessParties,
                "rush_battle_played_party_list": serializedPlayedParties.folderParties,
                "endless_battle_my_ranking": (0, rush_1.getPlayerRushEventEndlessBattleRankingSync)(playerId, eventId, {
                    rushEventData: rushEventData
                }),
                "aggregated_time": (0, utils_2.clientSerializeDate)((0, utils_1.getServerDate)()),
            }
        });
    }));
    fastify.post("/select_folder", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _b;
        const body = ((_b = request.body) !== null && _b !== void 0 ? _b : {});
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        const folderId = body.folder_id;
        (0, routine_game_logging_1.routineGameLog)("rush", () => `[RUSH] select_folder: viewer=${viewerId} eventId=${eventId} folderId=${folderId}`);
        if (![viewerId, eventId, folderId].every(id => Number.isSafeInteger(id) && id > 0)) {
            (0, request_diagnostics_1.setRequestOutcome)(request, "rush_invalid_body");
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        }
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession) {
            (0, request_diagnostics_1.setRequestOutcome)(request, "rush_invalid_session");
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        }
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null) {
            (0, request_diagnostics_1.setRequestOutcome)(request, "rush_missing_player");
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        }
        // get existing rush event data
        const rushEventData = (0, rushEvent_1.getPlayerRushEventSync)(playerId, eventId);
        if (rushEventData === null) {
            (0, request_diagnostics_1.setRequestOutcome)(request, "rush_missing_event");
            return reply.status(400).send({
                "error": "Bad Request",
                "message": `No rush event data for rush event with id '${eventId}'`
            });
        }
        const deepAbyssSelection = (0, rush_event_folder_lock_1.classifyDeepAbyssFolderSelection)(eventId, folderId);
        if (deepAbyssSelection === "invalid") {
            (0, request_diagnostics_1.setRequestOutcome)(request, "rush_invalid_folder");
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid Deep Abyss rush battle folder."
            });
        }
        if (deepAbyssSelection === "endless_compat") {
            yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "event", playerId, operation: "rush_select_folder_maintenance",
            }, () => { repairDeepAbyssEndlessFolderLockSync(playerId, rushEventData); });
            (0, request_diagnostics_1.setRequestOutcome)(request, "rush_endless_compat");
            // The current client enters endless battle directly and never
            // calls /select_folder. Treat calls from older clients as a
            // successful no-op: endless remains playable, while folder 2 is
            // not persisted as a regular difficulty lock.
            console.warn(`[RUSH] ignored Deep Abyss endless folder selection lock: `
                + `player=${playerId} eventId=${eventId} folderId=${folderId}`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": {
                    "folder_id": folderId,
                    "event_id": eventId
                }
            });
        }
        // A lost response may replay the same selection. Re-read inside the
        // player queue so concurrent folder selections cannot overwrite each
        // other after both observed an empty active folder.
        const selection = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId, operation: "rush_select_folder",
        }, () => {
            var _a;
            const current = repairDeepAbyssEndlessFolderLockSync(playerId, (_a = (0, rushEvent_1.getPlayerRushEventSync)(playerId, eventId)) !== null && _a !== void 0 ? _a : rushEventData);
            if (current.activeRushBattleFolderId !== null
                && current.activeRushBattleFolderId !== folderId) {
                return "different";
            }
            if (current.activeRushBattleFolderId === null) {
                (0, rushEvent_1.updatePlayerRushEventSync)(playerId, {
                    eventId: eventId,
                    activeRushBattleFolderId: folderId
                });
                return "selected";
            }
            return "same";
        });
        if (selection === "different") {
            (0, request_diagnostics_1.setRequestOutcome)(request, "rush_different_folder");
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Already selected a folder for this rush event."
            });
        }
        if (selection === "selected") {
            (0, request_diagnostics_1.setRequestOutcome)(request, "rush_selected");
        }
        else {
            (0, request_diagnostics_1.setRequestOutcome)(request, "rush_same_folder");
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "folder_id": folderId,
                "event_id": eventId
            }
        });
    }));
    fastify.post("/ranking", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _c;
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        const page = (_c = body.page) !== null && _c !== void 0 ? _c : 0;
        (0, routine_game_logging_1.routineGameLog)("rush", () => `[RUSH] ranking: viewer=${viewerId} eventId=${eventId} page=${page}`);
        if (isNaN(viewerId) || isNaN(eventId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        const competition = (0, competition_1.getLeaderboardCompetitionForEvent)(types_2.QuestCategory.RUSH_EVENT, eventId);
        if (competition !== null) {
            const acceptingScores = (0, availability_1.isLeaderboardEnabledSync)(competition.key);
            const ranking = (0, presentation_1.getOfficialLeaderboardPageSync)({
                competition,
                playerId,
                page,
                acceptingScores,
            });
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": {
                    "aggregated_time": (0, utils_2.clientSerializeDate)((0, utils_1.getServerDate)()),
                    "current_page": ranking.currentPage,
                    "page_max": ranking.pageMax,
                    "my_data": ranking.myData,
                    "ranking_data": ranking.rows,
                    "total": ranking.total,
                },
            });
        }
        // get player endless rank
        const endlessRanking = (0, rush_1.getPlayerRushEventEndlessBattleRankingSync)(playerId, eventId);
        // get all rankings for page
        const rankings = (0, rushEvent_1.getRushEventEndlessRankingListSync)(eventId, page);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "aggregated_time": (0, utils_2.clientSerializeDate)((0, utils_1.getServerDate)()),
                "current_page": page + 1,
                "page_max": rankings.pageMax,
                "my_data": endlessRanking,
                "ranking_data": rankings.list
            }
        });
    }));
    fastify.post("/ranking/played_party", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _d;
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        const rankNumber = body.rank_number;
        if (isNaN(viewerId) || isNaN(eventId) || isNaN(rankNumber))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        const competition = (0, competition_1.getLeaderboardCompetitionForEvent)(types_2.QuestCategory.RUSH_EVENT, eventId);
        if (competition !== null) {
            const partyList = (0, presentation_1.getLeaderboardPlayedPartiesSync)({
                competition,
                rankNumber,
                acceptingScores: (0, availability_1.isLeaderboardEnabledSync)(competition.key),
            });
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": { "rush_ranking_party": (0, public_payload_1.stripWeaponRivenPublicPayload)(partyList) },
            });
        }
        // get party list
        const partyList = (_d = (0, rush_1.getRushEventEndlessBattleRankPlayedPartyListSync)(rankNumber, eventId)) !== null && _d !== void 0 ? _d : [];
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "rush_ranking_party": (0, public_payload_1.stripWeaponRivenPublicPayload)(partyList)
            }
        });
    }));
    fastify.post("/aggregated_time", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        if (isNaN(viewerId) || isNaN(eventId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "aggregated_time": (0, utils_2.clientSerializeDate)((0, utils_1.getServerDate)())
            }
        });
    }));
    fastify.post("/party", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        const playerPartyGroups = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "rush_party_defaults",
        }, () => (0, special_event_parties_1.ensureSpecialEventPartyGroupsSync)(playerId, (0, rush_party_categories_1.partyCategoryForRushEvent)(body.event_id), types_1.PartyCategory.RUSH, {
            getGroups: party_1.getPlayerPartyGroupListSync,
            getDefaults: player_1.getDefaultPlayerPartyGroupsSync,
            ensureGroups: party_1.ensurePlayerPartyGroupListSync,
        }));
        // convert to proper format
        const userPartyGroupList = [];
        for (const [idString, group] of Object.entries(playerPartyGroups)) {
            const groupId = Number(idString);
            if ((0, mode15_optional_1.isMode15RuntimeLoaded)()
                && (groupId < 1 || groupId > MODE15_VISIBLE_PARTY_SET_COUNT))
                continue;
            const partyList = [];
            // convert parties
            for (const [partyIdString, party] of Object.entries(group.list)) {
                partyList.push({
                    ability_soul_ids: party.abilitySoulIds,
                    character_ids: party.characterIds,
                    equipment_ids: party.equipmentIds,
                    unison_character_ids: party.unisonCharacterIds,
                    options: {
                        allow_other_players_to_heal_me: party.options.allowOtherPlayersToHealMe
                    },
                    party_edited: party.edited,
                    party_id: (0, special_event_parties_1.getGlobalPartyId)(groupId, Number(partyIdString)),
                    party_name: party.name
                });
            }
            userPartyGroupList.push({
                "party_group_color_id": group.colorId,
                "party_group_id": groupId,
                "party_list": partyList
            });
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "user_party_group_list": userPartyGroupList
            }
        });
    }));
    // The patched client opens this endpoint through the native Rush reward
    // remote with a private negative-event marker. The remote turns the marker
    // back into a positive event_id before sending it, so ordinary reward,
    // party-editing and global legal/terms flows retain their native payloads.
    fastify.post("/leaderboard", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = Number(body === null || body === void 0 ? void 0 : body.viewer_id);
        const eventId = Number(body === null || body === void 0 ? void 0 : body.event_id);
        if (!Number.isSafeInteger(viewerId)
            || viewerId <= 0
            || !Number.isSafeInteger(eventId)
            || eventId <= 0)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(String(viewerId));
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        const competition = (0, competition_1.getLeaderboardCompetitionForEvent)(types_2.QuestCategory.RUSH_EVENT, eventId);
        const payload = competition === null
            ? (0, presentation_1.buildUnavailableNativeLeaderboardPayload)()
            : (0, presentation_1.buildNativeLeaderboardPayload)(competition, playerId, (0, availability_1.isLeaderboardEnabledSync)(competition.key));
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": payload,
        });
    }));
    fastify.post("/battle/start", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const isAutoStartMode = body.is_auto_start_mode;
        const partyId = body.party_id;
        const questId = body.quest_id;
        (0, routine_game_logging_1.routineGameLog)("rush", () => `[RUSH] battle/start: viewer=${viewerId} questId=${questId} partyId=${partyId} autoStart=${isAutoStartMode}`);
        if (isNaN(viewerId) || isNaN(partyId) || isNaN(questId) || isAutoStartMode === undefined)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        if ((0, abyss_time_revision_1.isStaleAbyssClient)(types_2.QuestCategory.RUSH_EVENT, questId, request.headers.res_ver)) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, asset_update: true, result_code: 4050 }),
                data: {},
            });
        }
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        // get quest
        const questData = (0, assets_1.getQuestFromCategorySync)(types_2.QuestCategory.RUSH_EVENT, questId);
        if (questData === null || !('rankPointReward' in questData) || questData.rushEventId === undefined)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Quest doesn't exist."
            });
        // This endpoint starts Rush single-player battles only.  Keep the
        // rank gate here as a deep-link/API fallback, while Advent multiplayer
        // room creation, rescue discovery and rescue participation remain
        // untouched so lower-rank players can join an eligible host.
        const player = (0, player_1.getPlayerSync)(playerId);
        const playerRank = player === null ? 0 : (0, stamina_1.getRankDegree)(player.rankPoint);
        if (!(0, gauntlet_entry_rank_1.canStartRankGatedGauntletRush)(questData.rushEventId, playerRank)
            || !(0, abyss_tower_progress_1.canStartAbyssQuestSync)(playerId, types_2.QuestCategory.RUSH_EVENT, questId)) {
            console.log(`[RUSH] rank-gated Gauntlet start rejected: player=${playerId} `
                + `rank=${playerRank} required=${gauntlet_entry_rank_1.GAUNTLET_MIN_PLAYER_RANK} `
                + `event=${questData.rushEventId} quest=${questId}`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: 4050 }),
                data: {},
            });
        }
        if ((0, mode15_optional_1.isMode15RuntimeLoaded)()
            && questData.rushEventId === mode15_optional_1.MODE15_RUSH_EVENT_ID
            && questId !== mode15_optional_1.MODE15_PRACTICE_QUEST_ID) {
            const gate = (0, mode15_optional_1.canStartMode15QuestSync)(playerId, types_2.QuestCategory.RUSH_EVENT, questId);
            if (!gate.allowed) {
                // After a failed Fantasy Rush battle the legacy client may
                // replay the stale pre-reset round once while unwinding the
                // result screen.  Keep rejecting it, but use the client's
                // native non-fatal quest-unavailable response instead of an
                // HTTP 409 that is surfaced as H409.
                console.log(`[MODE15] stale/order-invalid Rush start rejected: player=${playerId} requested=${gate.stage} expected=${gate.expectedStage}`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({
                    data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: 4050 }),
                    data: {},
                });
            }
        }
        if (!(0, mode15_optional_1.isMode15EquipmentAllowedQuest)(types_2.QuestCategory.RUSH_EVENT, questId)) {
            const partyCategory = (0, rush_party_categories_1.partyCategoryForRushEvent)(questData.rushEventId);
            const restricted = (0, mode15_optional_1.getMode15ExclusiveGlobalPartyItemsSync)(playerId, partyCategory, partyId);
            if (restricted.length > 0) {
                console.log(`[MODE15] exclusive equipment denied in Rush: player=${playerId} quest=${questId} rushEvent=${questData.rushEventId} partyCategory=${partyCategory} party=${partyId} items=${restricted.join(",")}`);
                reply.header("content-type", "application/x-msgpack");
                return reply.status(200).send({
                    // Rush battle start has no native handling for 4507 and
                    // treats it as a fatal API error.  4050 is the standard
                    // non-fatal quest availability rejection used by battle
                    // start screens.
                    data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: 4050 }),
                    data: {},
                });
            }
        }
        let rivenParties = [];
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "single-quest", playerId, operation: "rush_start",
        }, () => {
            // Weapon riven battle rule (author 2026-10-27 15:17): an over-limit saved party loses
            // every revealed card; owners always get the authoritative party back.
            if (questData.fixedParty === undefined)
                rivenParties = require("../../data/domains/weapon-riven-party")
                    .enforceWeaponRivenStartPartiesSync(playerId, (0, rush_party_categories_1.partyCategoryForRushEvent)(questData.rushEventId), [partyId]);
            (0, service_1.startLeaderboardQuestSync)(playerId, {
                category: types_2.QuestCategory.RUSH_EVENT,
                eventId: questData.rushEventId,
                folderId: questData.rushEventFolderId,
                round: questData.rushEventRound,
                questId,
                totalRounds: questData.rushEventFolderId === undefined
                    ? 0
                    : (0, rush_event_folder_rounds_1.getRushEventFolderMaxRounds)(questData.rushEventId, questData.rushEventFolderId),
            });
            // Insert the active quest for '/single_battle_quest/finish'.
            (0, singleBattleQuest_1.insertActiveQuest)(playerId, {
                questId: questId,
                category: types_2.QuestCategory.RUSH_EVENT,
                useBoostPoint: false,
                useBossBoostPoint: false,
                isAutoStartMode: isAutoStartMode,
                isMulti: false,
                playId: body.play_id,
                continueCount: 0
            });
        });
        const headers = (0, utils_1.generateDataHeaders)({
            viewer_id: viewerId
        });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": headers,
            "data": Object.assign({ "user_info": {
                    "last_main_quest_id": body.quest_id
                }, "is_multi": "single", "start_time": headers['servertime'], "quest_name": "" }, yield rushRaidRivenPartyInfo(request, playerId, rivenParties))
        });
    }));
    fastify.post("/reset", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        const questType = body.quest_type;
        const resetTargetId = body.reset_target_id;
        const isResetAfterTargetRound = body.is_reset_after_target_round;
        (0, routine_game_logging_1.routineGameLog)("rush", () => `[RUSH] reset: viewer=${viewerId} eventId=${eventId} questType=${questType} resetTargetId=${resetTargetId} isResetAfterTarget=${isResetAfterTargetRound}`);
        if (isNaN(viewerId) || isNaN(eventId) || isNaN(questType))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        const rushEventData = (0, rushEvent_1.getPlayerRushEventSync)(playerId, eventId);
        if ((0, mode15_optional_1.isMode15RuntimeLoaded)() && eventId === mode15_optional_1.MODE15_RUSH_EVENT_ID) {
            yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "event", playerId, operation: "rush_reset_mode15",
            }, () => {
                if (rushEventData !== null)
                    repairDeepAbyssEndlessFolderLockSync(playerId, rushEventData);
                (0, mode15_optional_1.resetMode15RunSync)(playerId);
            });
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": [],
            });
        }
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId, operation: "rush_reset",
        }, () => {
            if (rushEventData !== null)
                repairDeepAbyssEndlessFolderLockSync(playerId, rushEventData);
            if (questType === ResetQuestType.FOLDER) {
                if ((0, rush_event_folder_lock_1.classifyDeepAbyssFolderReset)(eventId) === "restart_from_first") {
                    (0, service_1.resetLeaderboardCompetitionSync)(playerId, {
                        category: types_2.QuestCategory.RUSH_EVENT,
                        eventId,
                        folderId: rush_event_folder_lock_1.DEEP_ABYSS_RUSH_FOLDER_ID,
                    });
                    // Deep Abyss always abandons the entire finite run. Keep
                    // folder 1 selected so the client returns directly to
                    // round 700099001, regardless of reset_target_id.
                    (0, rushEvent_1.updatePlayerRushEventSync)(playerId, {
                        eventId: eventId,
                        activeRushBattleFolderId: rush_event_folder_lock_1.DEEP_ABYSS_RUSH_FOLDER_ID
                    });
                    (0, rushEvent_1.deletePlayerRushEventPlayedPartyListSync)(playerId, eventId, types_1.RushEventBattleType.FOLDER);
                    console.log(`[RUSH] Deep Abyss folder reset from first round: `
                        + `player=${playerId} ignoredResetTargetId=${resetTargetId}`);
                }
                else if (resetTargetId !== undefined) {
                    // A reset target keeps the native partial-reset behaviour
                    // for every Rush event except Deep Abyss.
                    (0, rushEvent_1.deletePlayerRushEventPlayedPartiesUntilSync)(playerId, eventId, types_1.RushEventBattleType.FOLDER, resetTargetId);
                }
                else {
                    (0, rushEvent_1.updatePlayerRushEventSync)(playerId, {
                        eventId: eventId,
                        activeRushBattleFolderId: null
                    });
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
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": []
        });
    }));
    // ---- reward ----
    fastify.post("/reward", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _e, _f, _g;
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        (0, routine_game_logging_1.routineGameLog)("rush", () => `[RUSH] reward: viewer=${viewerId} eventId=${eventId}`);
        if (!viewerId || isNaN(viewerId) || isNaN(eventId))
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
        // Rank remains part of the response, but the reward master-data ranges
        // describe cleared endless rounds (2-3, 4-5 and 6+), not leaderboard rank.
        const myRanking = (0, rush_1.getPlayerRushEventEndlessBattleRankingSync)(playerId, eventId);
        const rankNumber = (_e = myRanking === null || myRanking === void 0 ? void 0 : myRanking.rank_number) !== null && _e !== void 0 ? _e : null;
        const rushEvent = (0, rushEvent_1.getPlayerRushEventSync)(playerId, eventId);
        const maxRound = (_f = rushEvent === null || rushEvent === void 0 ? void 0 : rushEvent.endlessBattleMaxRound) !== null && _f !== void 0 ? _f : null;
        const eligibleDegreeIds = new Set((0, activity_degree_rewards_1.getEligibleRushDegreeIds)(eventId, maxRound));
        // find matching reward tier
        const rewardSourceEventId = (0, activity_degree_rewards_1.getRushDegreeRewardSourceEventId)(eventId);
        const rewards = (_g = rankingRewards[String(rewardSourceEventId)]) !== null && _g !== void 0 ? _g : {};
        let rewardList = [];
        if (maxRound !== null && maxRound > 0) {
            for (const entries of Object.values(rewards)) {
                for (const entry of entries) {
                    if (eligibleDegreeIds.has(entry.kindId)) {
                        rewardList.push(entry);
                        break;
                    }
                }
            }
        }
        const degreeIds = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId, operation: "rush_reward",
        }, () => (0, activity_degree_rewards_1.grantEligibleRushEventDegreesSync)(playerId, eventId, maxRound));
        (0, routine_game_logging_1.routineGameLog)("rush", () => `[RUSH] reward: rank=${rankNumber} maxRound=${maxRound} rewards=${rewardList.length}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "rank_number": rankNumber,
                "ranking_reward": {
                    "reward_list": rewardList.map(r => ({
                        "kind": r.kind,
                        "kind_id": r.kindId,
                        "number": r.number
                    })),
                    "status": 1
                },
                "degree_list": degreeIds.map(degreeId => ({
                    viewer_id: viewerId,
                    degree_id: degreeId,
                }))
            }
        });
    }));
    // ---- endless_battle ----
    fastify.post("/endless_battle", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _h, _j, _k;
        const body = request.body;
        const viewerId = body.viewer_id;
        const eventId = body.event_id;
        (0, routine_game_logging_1.routineGameLog)("rush", () => `[RUSH] endless_battle: viewer=${viewerId} eventId=${eventId}`);
        if (!viewerId || isNaN(viewerId) || isNaN(eventId))
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
        const rushEventData = (0, rushEvent_1.getPlayerRushEventSync)(playerId, eventId);
        const serializedPlayedParties = rushEventData !== null
            ? (0, rush_1.getSerializedPlayerRushEventPlayedPartiesSync)(playerId, eventId)
            : { endlessParties: null, folderParties: null };
        const maxRound = (_h = rushEventData === null || rushEventData === void 0 ? void 0 : rushEventData.endlessBattleMaxRound) !== null && _h !== void 0 ? _h : null;
        const nextRound = (_j = rushEventData === null || rushEventData === void 0 ? void 0 : rushEventData.endlessBattleNextRound) !== null && _j !== void 0 ? _j : 1;
        (0, routine_game_logging_1.routineGameLog)("rush", () => `[RUSH] endless_battle: maxRound=${maxRound} nextRound=${nextRound}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "endless_battle_max_round": maxRound,
                "endless_battle_next_round": nextRound,
                "endless_battle_played_party_list": (_k = serializedPlayedParties.endlessParties) !== null && _k !== void 0 ? _k : null
            }
        });
    }));
});
exports.default = routes;
/** Post-commit: projected party_info_list for the response, plus lobby cache refresh. */
function rushRaidRivenPartyInfo(request, playerId, parties) {
    return __awaiter(this, void 0, void 0, function* () {
        if (parties.length === 0)
            return {};
        yield require("../../lib/weapon-riven/party-refresh").refreshWeaponRivenPartiesAfterCommit(playerId, parties);
        return { party_info_list: require("../../lib/weapon-riven/client").projectWeaponRivenClientResponse(parties, require("../../lib/client-admission").hasWeaponRivenCapability(request)) };
    });
}
