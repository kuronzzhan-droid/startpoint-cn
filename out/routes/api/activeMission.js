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
const player_time_compat_1 = require("../../lib/player-time-compat");
const mission_1 = require("../../data/domains/mission");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const mail_1 = require("../../data/domains/mail");
const quest_1 = require("../../data/domains/quest");
const utils_1 = require("../../utils");
const activeAccount_1 = require("../../data/activeAccount");
const index_1 = require("../../lib/mission/index");
const grants_1 = require("../../lib/mission/grants");
const content_snapshot_1 = require("../../content/runtime/content-snapshot");
const game_logging_1 = require("../../lib/game-logging");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/receive", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (!player)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "Player not found."
            });
        const activeMissions = (0, mission_1.getPlayerActiveMissionsSync)(playerId);
        const requestList = body.active_mission_list || [];
        const validation = (0, index_1.validateMissionRewardClaims)(activeMissions, requestList, {
            repository: (0, content_snapshot_1.getContentSnapshot)().repository,
            now: (0, utils_1.getServerTime)() * 1000,
            questProgress: (0, quest_1.getPlayerQuestProgressSync)(playerId),
        });
        if (!validation.ok)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": validation.message
            });
        const granter = new grants_1.MissionRewardGranter(playerId, player);
        const resultByMission = new Map();
        const characterList = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "mission", playerId, operation: "claim_active_missions",
        }, () => {
            for (const claim of validation.claims) {
                (0, mission_1.updatePlayerActiveMissionStageSync)(playerId, claim.stage, claim.missionId, true);
                let result = resultByMission.get(claim.missionId);
                if (!result) {
                    result = { mission_id: claim.missionId, progress_value: claim.progress, stages: [] };
                    resultByMission.set(claim.missionId, result);
                }
                result.stages.push({ stage: claim.stage, received: true });
                granter.grant(claim.rewards);
            }
            granter.persistPlayer();
            const existingCharacterList = granter.characterList;
            return validation.claims.length > 0
                ? (0, index_1.reconcileAwakeUnlockCharacterList)(playerId, existingCharacterList)
                : existingCharacterList;
        });
        const resultList = [...resultByMission.values()];
        (0, game_logging_1.gameVerboseLog)(() => `[ACTIVE_MISSION] receive viewer=${viewerId} missions=${requestList.length} items=${Object.keys(granter.itemList).length}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "active_mission_list": resultList,
                "user_info": Object.assign(Object.assign({}, granter.getUserInfo()), { "exp_pooled_time": (0, player_time_compat_1.getPlayerClientExpTime)(player) }),
                "character_list": characterList,
                "equipment_list": granter.equipmentList,
                "item_list": granter.itemList,
                "degree_list": granter.degreeList.map(degreeId => ({ viewer_id: viewerId, degree_id: degreeId })),
                "mail_arrived": (0, mail_1.getPlayerMailCountSync)(playerId, true) > 0
            }
        });
    }));
});
exports.default = routes;
