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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const encyclopedia_1 = require("../../data/domains/encyclopedia");
const item_1 = require("../../data/domains/item");
const assets_1 = require("../../lib/assets");
const utils_1 = require("../../utils");
const encyclopedia_json_1 = __importDefault(require("../../../assets/encyclopedia.json"));
const FALLBACK_ENCYCLOPEDIA_KEY_ITEM_ID = 49200;
function validateEncyclopediaIds(value) {
    return Array.isArray(value)
        && value.length > 0
        && value.length <= 50
        && value.every(id => Number.isSafeInteger(id) && id > 0);
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/read_keyword", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const encyclopediaIds = body.encyclopedia_ids;
        if (!viewerId || isNaN(viewerId) || !validateEncyclopediaIds(encyclopediaIds))
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
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        const encyclopediaList = (0, encyclopedia_1.readPlayerEncyclopediaKeywordsSync)(playerId, encyclopediaIds);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "encyclopedia_list": encyclopediaList,
                "encyclopedia_info": encyclopediaList
            }
        });
    }));
    fastify.post("/unlock_keyword", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        const viewerId = body.viewer_id;
        const encyclopediaIds = body.encyclopedia_ids;
        if (!viewerId || isNaN(viewerId) || !validateEncyclopediaIds(encyclopediaIds))
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
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        const keyItemId = (0, assets_1.getConfigSync)().encyclopedia_point_item_id || FALLBACK_ENCYCLOPEDIA_KEY_ITEM_ID;
        const baseEncyclopedia = encyclopedia_json_1.default;
        const idsToUnlock = [...new Set(encyclopediaIds)].filter(id => baseEncyclopedia[String(id)] === undefined);
        let encyclopediaList;
        let itemAmount;
        let consumedKey = false;
        if (idsToUnlock.length === 0) {
            encyclopediaList = Object.fromEntries(encyclopediaIds.map(id => [String(id), baseEncyclopedia[String(id)]]));
            itemAmount = (_a = (0, item_1.getPlayerItemSync)(playerId, keyItemId)) !== null && _a !== void 0 ? _a : 0;
        }
        else {
            const result = (0, encyclopedia_1.unlockPlayerEncyclopediaKeywordsSync)(playerId, idsToUnlock, keyItemId);
            if (result === null)
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": "Not enough encyclopedia keys."
                });
            encyclopediaList = Object.assign(Object.assign({}, Object.fromEntries(encyclopediaIds
                .filter(id => baseEncyclopedia[String(id)] !== undefined)
                .map(id => [String(id), baseEncyclopedia[String(id)]]))), result.encyclopediaList);
            itemAmount = result.itemAmount;
            consumedKey = result.consumedKey;
        }
        console.log(`[ENCYCLOPEDIA] unlock player=${playerId} ids=${encyclopediaIds.join(",")} `
            + `key=${keyItemId} remaining=${itemAmount} consumed=${consumedKey}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "encyclopedia_list": encyclopediaList,
                "encyclopedia_info": encyclopediaList,
                "item_list": {
                    [keyItemId]: itemAmount
                }
            }
        });
    }));
    fastify.post("/index", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
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
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        const playerEncyclopedia = (0, encyclopedia_1.getPlayerEncyclopediaKeywordsSync)(playerId);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "encyclopedia_list": Object.assign(Object.assign({}, encyclopedia_json_1.default), playerEncyclopedia),
                "mail_arrived": false
            }
        });
    }));
});
exports.default = routes;
