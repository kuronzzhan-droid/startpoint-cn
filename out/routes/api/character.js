"use strict";
// Handles the insertion of mana into characters.
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
exports.characterMaxOverLimits = void 0;
const character_1 = require("../../data/domains/character");
const item_1 = require("../../data/domains/item");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const utils_1 = require("../../utils");
const assets_1 = require("../../lib/assets");
const character_degree_rewards_1 = require("../../lib/character-degree-rewards");
const character_2 = require("../../lib/character");
const utils_2 = require("../../data/utils");
const activeAccount_1 = require("../../data/activeAccount");
const mission_1 = require("../../lib/mission");
const game_logging_1 = require("../../lib/game-logging");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const character_overlimit_1 = require("../../lib/character-overlimit");
exports.characterMaxOverLimits = {
    [1]: 12, // 1* max over limit count
    [2]: 10, // 2* max over limit count
    [3]: 8, // 3* max over limit count
    [4]: 6, // 4* max over limit count
    [5]: 4, // 5* max over limit count
};
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/set_illustration_settings", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const characterId = body.character_id;
        const illustration_settings = body.illustration_settings;
        if (isNaN(viewerId) || isNaN(characterId) || !illustration_settings)
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
        // get player id
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === undefined)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "character_illustration_settings",
        }, () => {
            (0, character_1.updatePlayerCharacterSync)(playerId, characterId, {
                illustrationSettings: illustration_settings.slice(0, 6)
            });
        });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {}
        });
    }));
    fastify.post("/over_limit", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
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
        const characterId = body.character_id;
        const overLimitCount = body.over_limit_count;
        if (!Number.isSafeInteger(overLimitCount) || overLimitCount <= 0) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid over limit count." });
        }
        const characterAssetData = (0, assets_1.getCharacterDataSync)(characterId);
        if (characterAssetData === null)
            return reply.status(500).send({
                error: "Internal Server Error", message: "No character asset data found."
            });
        const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "character_over_limit",
        }, () => {
            // Read balances and progress after reaching the head of the player queue.
            const character = (0, character_1.getPlayerCharacterSync)(playerId, characterId);
            if (!character)
                return { error: "Character not owned." };
            const newOverLimit = character.overLimitStep + overLimitCount;
            const rarity = characterAssetData.rarity;
            const requestError = (0, character_overlimit_1.validateOverLimitRequest)(characterId, rarity, character.overLimitStep, overLimitCount, Boolean(body.use_stack), body.item_id);
            if (requestError !== null)
                return { error: requestError };
            let stack = character.stack;
            const itemList = {};
            if (body.use_stack) {
                stack -= overLimitCount;
                if (stack < 0)
                    return { error: "Character does not have enough duplicates to uncap." };
                (0, character_1.updatePlayerCharacterSync)(playerId, characterId, { overLimitStep: newOverLimit, stack });
            }
            else {
                const itemId = body.item_id;
                const costs = [{ itemId, amount: overLimitCount }, ...(0, character_overlimit_1.getExtendedOverLimitExtraCosts)(characterId, rarity, character.overLimitStep, overLimitCount)];
                const remainders = {};
                for (const cost of costs) {
                    const count = (0, item_1.getPlayerItemSync)(playerId, cost.itemId);
                    if (count === null)
                        return { error: "Attempted to use unowned item." };
                    const remaining = count - cost.amount;
                    if (remaining < 0)
                        return { error: "Not enough of item to uncap." };
                    remainders[cost.itemId] = remaining;
                }
                for (const [costItemId, remaining] of Object.entries(remainders)) {
                    (0, item_1.updatePlayerItemSync)(playerId, Number(costItemId), remaining);
                    itemList[Number(costItemId)] = remaining;
                }
                (0, character_1.updatePlayerCharacterSync)(playerId, characterId, { overLimitStep: newOverLimit });
            }
            (0, character_degree_rewards_1.grantCharacterDegreeRewardsSync)(playerId, [characterId]);
            const data = {
                character_list: [{
                        over_limit_step: newOverLimit, character_id: characterId, stack,
                        create_time: (0, utils_2.clientSerializeDate)(character.joinTime),
                        update_time: (0, utils_2.clientSerializeDate)(new Date()),
                        join_time: (0, utils_2.clientSerializeDate)(character.joinTime),
                    }],
                item_list: itemList, mail_arrived: false,
            };
            (0, mission_1.settleDegreeMissionResponse)(playerId, viewerId, data, undefined, [9]);
            return { data };
        });
        if (result.error !== undefined) {
            return reply.status(400).send({ error: "Bad Request", message: result.error });
        }
        const responseData = result.data;
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": responseData
        });
    }));
    fastify.post("/bulk_over_limit", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                error: "Bad Request", message: "Invalid request body.",
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                error: "Bad Request", message: "Invalid viewer id.",
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        const player = playerId !== null ? (0, player_1.getPlayerSync)(playerId) : null;
        if (player === null)
            return reply.status(500).send({
                error: "Internal Server Error", message: "No players bound to account.",
            });
        const responseData = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "character_bulk_over_limit",
        }, () => {
            const characters = (0, character_1.getPlayerCharactersSync)(playerId);
            const characterList = [];
            (0, game_logging_1.gameVerboseLog)(() => `[bulk_over_limit] player=${playerId} totalChars=${Object.keys(characters).length}`);
            for (const [charId, charData] of Object.entries(characters)) {
                if (charData.stack <= 0)
                    continue;
                const assetData = (0, assets_1.getCharacterDataSync)(Number(charId));
                if (!assetData)
                    continue;
                const maxOver = exports.characterMaxOverLimits[assetData.rarity];
                if (maxOver === undefined)
                    continue;
                const rest = maxOver - charData.overLimitStep;
                if (rest <= 0)
                    continue;
                const count = Math.min(charData.stack, rest);
                const newOverLimit = charData.overLimitStep + count;
                const newStack = charData.stack - count;
                (0, character_1.updatePlayerCharacterSync)(playerId, Number(charId), {
                    overLimitStep: newOverLimit,
                    stack: newStack,
                });
                (0, character_degree_rewards_1.grantCharacterDegreeRewardsSync)(playerId, [Number(charId)]);
                characterList.push({
                    character_id: Number(charId),
                    over_limit_step: newOverLimit,
                    stack: newStack,
                    create_time: (0, utils_2.clientSerializeDate)(charData.joinTime),
                    update_time: (0, utils_2.clientSerializeDate)(new Date()),
                    join_time: (0, utils_2.clientSerializeDate)(charData.joinTime),
                });
            }
            (0, game_logging_1.gameVerboseLog)(() => `[bulk_over_limit] done: ${characterList.length} characters modified`);
            const data = { character_list: characterList, mail_arrived: false };
            (0, mission_1.settleDegreeMissionResponse)(playerId, viewerId, data, undefined, [9]);
            return data;
        });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: responseData,
        });
    }));
    fastify.post("/add_character_from_town", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const characterId = body.character_id;
        if (!viewerId || isNaN(viewerId) || !characterId || isNaN(characterId))
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
        const responseData = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "character_add_from_town",
        }, () => {
            const giveResult = (0, character_2.givePlayerCharacterSync)(playerId, characterId);
            const existing = (giveResult === null || giveResult === void 0 ? void 0 : giveResult.character)
                ? [giveResult.character] : [];
            const data = {
                character_list: existing.length > 0
                    ? (0, mission_1.reconcileAwakeUnlockCharacterList)(playerId, existing) : existing,
                item_list: (giveResult === null || giveResult === void 0 ? void 0 : giveResult.item) ? { [giveResult.item.id]: giveResult.item.inventoryCount } : {},
                mail_arrived: false,
            };
            (0, mission_1.settleDegreeMissionResponse)(playerId, viewerId, data, undefined, [4]);
            return data;
        });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": responseData
        });
    }));
});
exports.default = routes;
