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
const item_1 = require("../../data/domains/item");
const quest_1 = require("../../data/domains/quest");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const assets_1 = require("../../lib/assets");
const utils_1 = require("../../utils");
const quest_unlock_costs_json_1 = __importDefault(require("../../../assets/quest_unlock_costs.json"));
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/unlock", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const category = body.category;
        const questId = body.quest_id;
        if (isNaN(viewerId) || isNaN(category) || isNaN(questId)) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        }
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        }
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null) {
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        }
        const player = (0, player_1.getPlayerSync)(playerId);
        if (player === null) {
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player data."
            });
        }
        // Look up quest data
        const questData = (0, assets_1.getQuestFromCategorySync)(category, questId);
        if (questData === null) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Quest not found."
            });
        }
        const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "quest_unlock",
        }, () => {
            var _a, _b, _c;
            const progress = (0, quest_1.getPlayerQuestProgressSync)(playerId);
            const sectionProg = (_a = progress[String(category)]) !== null && _a !== void 0 ? _a : [];
            const existing = sectionProg.find(p => p.questId === questId);
            if (existing === null || existing === void 0 ? void 0 : existing.unlocked)
                return { error: "Quest already unlocked." };
            const unlockCost = quest_unlock_costs_json_1.default[String(questId)];
            const itemList = {};
            if (unlockCost) {
                for (let i = 0; i < unlockCost.itemIds.length; i++) {
                    const itemId = unlockCost.itemIds[i];
                    const cost = (_b = unlockCost.itemCounts[i]) !== null && _b !== void 0 ? _b : 1;
                    const current = (_c = (0, item_1.getPlayerItemSync)(playerId, itemId)) !== null && _c !== void 0 ? _c : 0;
                    if (current < cost)
                        return { error: `Not enough of item ${itemId} to unlock quest.` };
                    (0, item_1.updatePlayerItemSync)(playerId, itemId, current - cost);
                    itemList[String(itemId)] = current - cost;
                }
            }
            if (existing)
                (0, quest_1.updatePlayerQuestProgressSync)(playerId, category, { questId, unlocked: true });
            else
                (0, quest_1.insertPlayerQuestProgressSync)(playerId, category, { questId, finished: false, unlocked: true });
            return { itemList };
        });
        if (result.error !== undefined)
            return reply.status(400).send({
                "error": "Bad Request", "message": result.error,
            });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "item_list": result.itemList,
                "mail_arrived": false
            }
        });
    }));
});
exports.default = routes;
