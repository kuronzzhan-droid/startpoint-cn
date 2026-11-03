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
const character_1 = require("../../data/domains/character");
const item_1 = require("../../data/domains/item");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const character_overlimit_1 = require("../../lib/character-overlimit");
const character_2 = require("../../lib/character");
const utils_1 = require("../../utils");
const assets_1 = require("../../lib/assets");
const utils_2 = require("../../data/utils");
const activeAccount_1 = require("../../data/activeAccount");
const active_mission_counters_1 = require("../../data/domains/active_mission_counters");
const character_stack_1 = require("../../lib/character-stack");
const mission_1 = require("../../lib/mission");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const rarityStackConvertItemCount = {
    [1]: 2,
    [2]: 2,
    [3]: 2,
    [4]: 10,
    [5]: 30
};
const rewardItemId = 990008;
const rarityStackConvertExp = {
    [1]: 500,
    [2]: 500,
    [3]: 500,
    [4]: 2000,
    [5]: 10000
};
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/stack_to_exp", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        const viewerId = body.viewer_id;
        const characterId = body.character_id;
        const convertCount = body.number;
        if (isNaN(viewerId) || isNaN(characterId))
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
        const player = playerId !== null ? (0, player_1.getPlayerSync)(playerId) : null;
        if (player === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        // get character asset data
        const characterAssetData = (0, assets_1.getCharacterDataSync)(characterId);
        if (characterAssetData === null)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Character does not exist."
            });
        // get character
        const character = (0, character_1.getPlayerCharacterSync)(playerId, characterId);
        if (character === null)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Player does not own character."
            });
        const validationError = (0, character_stack_1.validateCharacterStackConversion)(character.stack, convertCount, character.protection);
        if (validationError)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": validationError
            });
        const afterStack = character.stack - convertCount;
        // get amounts to add
        const rarity = characterAssetData.rarity;
        const increaseExp = rarityStackConvertExp[rarity] * convertCount;
        const increaseItemCount = rarityStackConvertItemCount[rarity] * convertCount;
        let afterExp = player.expPool;
        let afterItemCount = (_a = (0, item_1.getPlayerItemsSync)(playerId)[String(rewardItemId)]) !== null && _a !== void 0 ? _a : 0;
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "convert_stack_to_exp",
        }, () => {
            (0, character_1.updatePlayerCharacterSync)(playerId, characterId, { stack: afterStack });
            const adjustedExp = (0, player_1.adjustPlayerExpPoolSync)(playerId, increaseExp, 'stack_to_exp');
            if (adjustedExp === null)
                throw new Error(`Failed to update EXP pool for player ${playerId}`);
            afterExp = adjustedExp;
            afterItemCount = (0, item_1.givePlayerItemSync)(playerId, rewardItemId, increaseItemCount);
        });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "user_info": {
                    "exp_pool": afterExp,
                    "exp_pooled_time": (0, player_time_compat_1.getPlayerClientExpTime)(player)
                },
                "character_list": [
                    {
                        "viewer_id": viewerId,
                        "character_id": characterId,
                        "stack": afterStack,
                        "exp": character.exp,
                        "exp_total": character.exp,
                        "create_time": (0, utils_2.clientSerializeDate)(character.joinTime),
                        "update_time": (0, utils_2.clientSerializeDate)(new Date()),
                        "join_time": (0, utils_2.clientSerializeDate)(character.joinTime)
                    }
                ],
                "converted_exp_info": {
                    "add_exp": increaseExp
                },
                "item_list": {
                    [rewardItemId]: afterItemCount
                },
                "mail_arrived": false
            }
        });
    }));
    fastify.post("/bulk_stack_to_exp", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _b, _c, _d;
        const body = request.body;
        const viewerId = body.viewer_id;
        if (isNaN(viewerId))
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
        const player = playerId !== null ? (0, player_1.getPlayerSync)(playerId) : null;
        if (player === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        const allCharacters = (0, character_1.getPlayerCharactersSync)(playerId);
        const modifiedCharacters = [];
        let totalExp = 0;
        let totalStarGrains = 0;
        let processedCount = 0;
        const conversions = [];
        for (const [characterIdStr, character] of Object.entries(allCharacters)) {
            const characterId = parseInt(characterIdStr);
            if (character.stack <= 0 || character.protection)
                continue;
            const charAsset = (0, assets_1.getCharacterDataSync)(characterId);
            if (!charAsset)
                continue;
            const rarity = charAsset.rarity;
            const maxOver = (_b = (0, character_overlimit_1.getCharacterMaxOverLimit)(characterId, rarity)) !== null && _b !== void 0 ? _b : 0;
            if (character.overLimitStep < maxOver)
                continue;
            const stack = character.stack;
            const addExp = ((_c = rarityStackConvertExp[rarity]) !== null && _c !== void 0 ? _c : 0) * stack;
            const addStarGrain = ((_d = rarityStackConvertItemCount[rarity]) !== null && _d !== void 0 ? _d : 0) * stack;
            totalExp += addExp;
            totalStarGrains += addStarGrain;
            conversions.push({ characterId, stack });
            modifiedCharacters.push({
                "viewer_id": viewerId,
                "character_id": characterId,
                "stack": 0,
                "over_limit_step": character.overLimitStep,
                "exp": character.exp,
                "exp_total": character.exp,
                "create_time": (0, utils_2.clientSerializeDate)(character.joinTime),
                "update_time": (0, utils_2.clientSerializeDate)(character.updateTime),
                "join_time": (0, utils_2.clientSerializeDate)(character.joinTime)
            });
            processedCount++;
        }
        if (processedCount === 0) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                "data": {
                    "character_list": [],
                    "converted_exp_info": { "add_exp": 0 },
                    "item_list": (0, item_1.getPlayerItemsSync)(playerId),
                    "user_info": {
                        "exp_pool": player.expPool,
                        "exp_pooled_time": (0, player_time_compat_1.getPlayerClientExpTime)(player)
                    },
                    "mail_arrived": false
                }
            });
        }
        let newExpPool = player.expPool;
        let newStarGrainTotal = 0;
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "bulk_convert_stack_to_exp",
        }, () => {
            for (const conversion of conversions) {
                (0, character_1.updatePlayerCharacterSync)(playerId, conversion.characterId, { stack: 0 });
            }
            const adjustedExp = (0, player_1.adjustPlayerExpPoolSync)(playerId, totalExp, 'bulk_stack_to_exp');
            if (adjustedExp === null)
                throw new Error(`Failed to update EXP pool for player ${playerId}`);
            newExpPool = adjustedExp;
            if (totalStarGrains > 0) {
                newStarGrainTotal = (0, item_1.givePlayerItemSync)(playerId, rewardItemId, totalStarGrains);
            }
        });
        const items = (0, item_1.getPlayerItemsSync)(playerId);
        if (totalStarGrains > 0) {
            items[String(rewardItemId)] = newStarGrainTotal;
        }
        console.log(`[BULK_STACK_EXP] player ${playerId}: ${processedCount} characters converted, exp +${totalExp}, starGrain +${totalStarGrains}, expPool ${player.expPool}→${newExpPool}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "character_list": modifiedCharacters,
                "converted_exp_info": { "add_exp": totalExp },
                "item_list": items,
                "user_info": {
                    "exp_pool": newExpPool,
                    "exp_pooled_time": (0, player_time_compat_1.getPlayerClientExpTime)(player)
                },
                "mail_arrived": false
            }
        });
    }));
    fastify.post("/inject_exp", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _e;
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
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
        const player = playerId !== null ? (0, player_1.getPlayerSync)(playerId) : null;
        if (player === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        // increase character exp
        const characterId = body.character_id;
        const character = (0, character_1.getPlayerCharacterSync)(playerId, characterId);
        if (character === null)
            return reply.status(400).send({
                "error": "Internal Server Error",
                "message": "Player does not own character."
            });
        // Some CN clients send the spend as a negative delta. Accept either
        // sign, but reject zero, fractional and unsafe values before touching
        // the player's balance.
        const rawRequestedExp = body.exp;
        if (typeof rawRequestedExp !== "number"
            || !Number.isSafeInteger(rawRequestedExp)
            || rawRequestedExp === 0)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid exp amount."
            });
        const requestedExp = Math.abs(rawRequestedExp);
        const requestTime = (0, utils_1.getServerDate)();
        let expPooledTime = player.expPooledTime;
        const rewardResult = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "inject_exp",
        }, () => {
            var _a, _b;
            // Refresh passive pooled EXP before comparing with the amount the
            // client displayed, then read and deduct the authoritative balance
            // in the same transaction. A stale client may request slightly
            // more than remains; spend the remainder instead of returning an
            // HTTP 400, which the legacy client treats as a fatal H400 logout.
            const beforeSpend = (0, player_1.getPlayerSync)(playerId);
            if (beforeSpend === null)
                throw new Error(`Player ${playerId} disappeared during EXP injection`);
            (0, player_1.collectPlayerDataPooledExpSync)(beforeSpend, requestTime);
            const refreshedPlayer = (0, player_1.getPlayerSync)(playerId);
            if (refreshedPlayer === null)
                throw new Error(`Player ${playerId} disappeared during EXP refresh`);
            const spendExp = Math.min(requestedExp, refreshedPlayer.expPool);
            if (spendExp < requestedExp) {
                console.warn(`[EXP_POOL] clamped inject player=${playerId} requested=${requestedExp} available=${refreshedPlayer.expPool}`);
            }
            if (spendExp > 0) {
                const afterDeduction = (0, player_1.adjustPlayerExpPoolSync)(playerId, -spendExp, "inject_exp");
                if (afterDeduction === null) {
                    throw new Error(`Failed to deduct EXP pool for player ${playerId}`);
                }
            }
            const result = (0, character_2.givePlayerCharactersExpSync)(playerId, [characterId], spendExp, false);
            if (spendExp > 0)
                (0, active_mission_counters_1.incrementActiveMissionInjectedExpCountSync)(playerId);
            expPooledTime = (_b = (_a = (0, player_1.getPlayerSync)(playerId)) === null || _a === void 0 ? void 0 : _a.expPooledTime) !== null && _b !== void 0 ? _b : refreshedPlayer.expPooledTime;
            return result;
        });
        const responseData = {
            "add_exp_list": rewardResult.add_exp_list,
            "character_list": rewardResult.character_list,
            "user_info": {
                "exp_pool": rewardResult.exp_pool,
                "exp_pooled_time": (0, player_time_compat_1.getPlayerClientExpTime)({ expPooledTime, timeOffset: (_e = (0, player_1.getPlayerSync)(playerId)) === null || _e === void 0 ? void 0 : _e.timeOffset })
            },
        };
        (0, mission_1.settleDegreeMissionResponse)(playerId, viewerId, responseData, undefined, [5, 44], [characterId]);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": responseData
        });
    }));
});
exports.default = routes;
