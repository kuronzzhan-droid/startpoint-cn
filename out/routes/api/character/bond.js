"use strict";
// Character bond token and mana board opening endpoints
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
const character_1 = require("../../../data/domains/character");
const player_1 = require("../../../data/domains/player");
const session_1 = require("../../../data/domains/session");
const utils_1 = require("../../../utils");
const assets_1 = require("../../../lib/assets");
const utils_2 = require("../../../data/utils");
const activeAccount_1 = require("../../../data/activeAccount");
const character_helpers_1 = require("../../../lib/character-helpers");
const character_2 = require("../../../lib/character");
const mission_1 = require("../../../lib/mission");
const game_logging_1 = require("../../../lib/game-logging");
const persistence_coordinator_1 = require("../../../lib/persistence-coordinator");
const character_overlimit_board2_1 = require("../../../lib/character-overlimit");
const openManaBoardRequiredUncaps = {
    [1]: 10, [2]: 8, [3]: 6, [4]: 4, [5]: 2
};
const openManaBoardRequiredExp = {
    [3]: character_2.characterExpCaps[3][0],
    [4]: character_2.characterExpCaps[4][0],
    [5]: character_2.characterExpCaps[5][0]
};
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/receive_bond_token", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const characterId = body.character_id;
        const manaBoardIndex = body.mana_board_index;
        (0, game_logging_1.gameVerboseLog)(() => `[MANA] receive_bond_token: viewer=${viewerId} char=${characterId} boardIdx=${manaBoardIndex}`);
        if (isNaN(viewerId) || isNaN(characterId) || isNaN(manaBoardIndex))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const sess = yield (0, character_helpers_1.validateSessionAndPlayer)(viewerId, reply);
        if (!sess)
            return reply;
        const { playerId } = sess;
        const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "character_receive_bond_token",
        }, () => {
            const player = (0, player_1.getPlayerSync)(playerId);
            if (!player)
                throw new Error("Player not found.");
            const character = (0, character_1.getPlayerCharacterSync)(playerId, characterId);
            if (!character)
                return { error: "Character not owned." };
            const token = character.bondTokenList.find(entry => entry.manaBoardIndex === manaBoardIndex);
            if (!token || token.status === 0)
                return { error: "Cannot receive bond token." };
            // Replays read the committed claim marker inside the same player queue.
            const shouldClaim = token.status !== 2;
            const balance = player.bondToken + (shouldClaim ? 1 : 0);
            if (shouldClaim) {
                (0, player_1.updatePlayerSync)({ id: playerId, bondToken: balance });
                (0, character_1.updatePlayerCharacterBondTokenSync)(playerId, characterId, { manaBoardIndex, status: 2 });
            }
            const entries = [(0, character_helpers_1.buildCharacterListEntry)(characterId, character, {
                    bond_token_list: character.bondTokenList.map(entry => ({
                        mana_board_index: entry.manaBoardIndex,
                        status: entry.manaBoardIndex === manaBoardIndex ? 2 : entry.status,
                    })),
                })];
            const data = {
                user_info: { bond_token: balance },
                character_list: shouldClaim ? (0, mission_1.reconcileAwakeUnlockCharacterList)(playerId, entries) : entries,
                user_character_mana_node_list: {}, item_list: {}, evolution: [], mail_arrived: false,
            };
            return { data };
        });
        if (result.error !== undefined) {
            return reply.status(400).send({ error: "Bad Request", message: result.error });
        }
        return (0, character_helpers_1.sendCharacterResponse)(reply, viewerId, result.data, playerId);
    }));
    fastify.post("/open_mana_board", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const characterId = body.character_id;
        const manaBoardIndex = body.mana_board_index;
        (0, game_logging_1.gameVerboseLog)(() => `[MANA] open_mana_board: viewer=${viewerId} char=${characterId} boardIdx=${manaBoardIndex}`);
        if (isNaN(viewerId) || isNaN(characterId) || isNaN(manaBoardIndex))
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
                "error": "Internal Server Error", "message": "No players bound to account."
            });
        const characterAssetData = (0, assets_1.getCharacterDataSync)(characterId);
        if (characterAssetData === null)
            return reply.status(500).send({
                error: "Internal Server Error", message: "No character asset data found."
            });
        const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "character_open_mana_board",
        }, () => {
            var _a;
            const character = (0, character_1.getPlayerCharacterSync)(playerId, characterId);
            if (!character)
                return { error: "Character not owned." };
            const requiredExp = openManaBoardRequiredExp[characterAssetData.rarity];
            if (requiredExp !== undefined && requiredExp > character.exp) {
                return { error: "Character level is too low to unlock mana board." };
            }
            if (openManaBoardRequiredUncaps[characterAssetData.rarity] > character.overLimitStep) {
                return { error: "Character is not uncapped enough to unlock mana board." };
            }
            // 作者 10-27：水杰拉德 129989 玛纳板 2 起要 120 级(=第 8 次突破的等级上限)
            const board2Level120 = { [129989]: 8 };
            if (manaBoardIndex >= 2 && board2Level120[characterId] !== undefined) {
                const needExp = (0, character_overlimit_board2_1.getCharacterExpCap)(characterId, characterAssetData.rarity, board2Level120[characterId]);
                if (needExp === undefined || needExp > character.exp) {
                    return { error: "Character level is too low to unlock mana board." };
                }
            }
            const previous = character.bondTokenList.find(token => token.manaBoardIndex === manaBoardIndex - 1);
            if (manaBoardIndex > 1 && ((_a = previous === null || previous === void 0 ? void 0 : previous.status) !== null && _a !== void 0 ? _a : 0) < 1) {
                return { error: "Must unlock all previous mana board nodes." };
            }
            if (!character.bondTokenList.some(token => token.manaBoardIndex === manaBoardIndex)) {
                const boardCount = (0, assets_1.getCharacterManaBoardCountSync)(characterId);
                const existingBoards = new Set(character.bondTokenList.map(token => token.manaBoardIndex));
                for (let i = 1; i <= boardCount; i++) {
                    if (!existingBoards.has(i)) {
                        (0, character_1.insertPlayerCharacterBondTokenSync)(playerId, characterId, { manaBoardIndex: i, status: 0 });
                    }
                }
            }
            (0, character_1.updatePlayerCharacterSync)(playerId, characterId, { manaBoardIndex });
            return { data: {
                    character_list: [{
                            viewer_id: viewerId, character_id: characterId, mana_board_index: manaBoardIndex,
                            create_time: (0, utils_2.clientSerializeDate)(character.joinTime),
                            update_time: (0, utils_2.clientSerializeDate)(character.updateTime),
                            join_time: (0, utils_2.clientSerializeDate)(character.joinTime),
                        }],
                    mail_arrived: false,
                } };
        });
        if (result.error !== undefined) {
            return reply.status(400).send({ error: "Bad Request", message: result.error });
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }), data: result.data,
        });
    }));
});
exports.default = routes;
