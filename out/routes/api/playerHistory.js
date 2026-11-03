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
const activeAccount_1 = require("../../data/activeAccount");
const character_1 = require("../../data/domains/character");
const degree_1 = require("../../data/domains/degree");
const player_history_1 = require("../../data/domains/player-history");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const player_history_catalog_1 = require("../../lib/player-history-catalog");
const player_history_aggregates_1 = require("../../lib/player-history-aggregates");
const profileFavorite_1 = require("../../lib/profileFavorite");
const utils_1 = require("../../utils");
const utils_2 = require("../../utils");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}
function resolvePlayer(request, reply) {
    return __awaiter(this, void 0, void 0, function* () {
        const body = request.body;
        if (!isPositiveInteger(body === null || body === void 0 ? void 0 : body.viewer_id)) {
            reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
            return null;
        }
        const session = yield (0, session_1.getSession)(String(body.viewer_id));
        if (!session) {
            reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
            return null;
        }
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        const player = playerId === null ? null : (0, player_1.getPlayerSync)(playerId);
        if (playerId === null || !player) {
            reply.status(400).send({ error: "Bad Request", message: "Player not found." });
            return null;
        }
        return { viewerId: body.viewer_id, playerId, player };
    });
}
function sendResultCode(reply, viewerId, resultCode) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: resultCode }),
        data: {},
    });
}
function getDefaults(playerId, player, catalog) {
    const favorite = (0, profileFavorite_1.getFavoritePartySelectionSync)(playerId, player.leaderCharacterId);
    return {
        playerHistoryId: catalog.playerHistoryId,
        backgroundCardId: catalog.defaultBackgroundId,
        degreeId: player.degreeId || 1,
        characterIds: favorite.characterIds,
        unisonCharacterIds: favorite.unisonCharacterIds,
        topicVisibility: {},
    };
}
function parseCharacterIds(value) {
    if (!Array.isArray(value) || value.length !== 3)
        return null;
    if (!value.every(id => id === null || isPositiveInteger(id)))
        return null;
    return value;
}
function parseTopicVisibility(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return null;
    const entries = Object.entries(value);
    if (!entries.every(([key, visible]) => /^[1-9]\d*$/.test(key) && typeof visible === "boolean")) {
        return null;
    }
    return Object.fromEntries(entries);
}
function serializeTopics(catalog, topicVisibility, aggregates) {
    return Object.fromEntries(catalog.topics.map(topic => {
        var _a, _b;
        return [
            String(topic.index),
            {
                is_visible: (_a = topicVisibility[String(topic.index)]) !== null && _a !== void 0 ? _a : topic.toggleDefault,
                value_list: Object.assign(Object.assign({}, (0, player_history_catalog_1.createEmptyPlayerHistoryTopicValues)(topic.aggregationTarget)), ((_b = aggregates[topic.aggregationTarget]) !== null && _b !== void 0 ? _b : {})),
            },
        ];
    }));
}
function getStartGameDate(playerId, offsetMs) {
    const account = (0, player_1.getAccountFromPlayerIdSync)(playerId);
    if (!account)
        return "2025-07-17 12:00:00";
    return (0, player_history_aggregates_1.formatPlayerHistoryJstDate)(account.firstLoginTime, offsetMs);
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/index", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const resolved = yield resolvePlayer(request, reply);
        if (!resolved)
            return reply;
        const catalog = (0, player_history_catalog_1.getPlayerHistoryCatalog)((0, utils_1.getServerTimeForPlayer)(resolved.playerId) * 1000);
        if (!catalog)
            return sendResultCode(reply, resolved.viewerId, 11101);
        const defaults = getDefaults(resolved.playerId, resolved.player, catalog);
        const settings = (0, player_history_1.getPlayerHistorySettingsSync)(resolved.playerId, defaults);
        const backgroundCardId = catalog.backgroundIds.has(settings.backgroundCardId)
            ? settings.backgroundCardId
            : catalog.defaultBackgroundId;
        const degreeId = (0, degree_1.hasPlayerDegreeSync)(resolved.playerId, settings.degreeId)
            ? settings.degreeId
            : defaults.degreeId;
        const offsetMs = (_a = (0, utils_2.getTimeOffset)()) !== null && _a !== void 0 ? _a : 0;
        const aggregates = (0, player_history_aggregates_1.buildPlayerHistoryTopicAggregatesSync)(resolved.playerId, resolved.player, getStartGameDate(resolved.playerId, offsetMs), (0, player_history_aggregates_1.formatPlayerHistoryJstDate)((0, utils_2.getServerDate)(), 0), offsetMs);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: resolved.viewerId }),
            data: {
                player_history_id: catalog.playerHistoryId,
                background_card_id: backgroundCardId,
                degree_id: degreeId,
                favorite_character: {
                    character_ids: settings.characterIds,
                    unison_character_ids: settings.unisonCharacterIds,
                },
                player_history_topic_list: serializeTopics(catalog, settings.topicVisibility, aggregates),
            },
        });
    }));
    fastify.post("/edit", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const resolved = yield resolvePlayer(request, reply);
        if (!resolved)
            return reply;
        const catalog = (0, player_history_catalog_1.getPlayerHistoryCatalog)((0, utils_1.getServerTimeForPlayer)(resolved.playerId) * 1000);
        if (!catalog)
            return sendResultCode(reply, resolved.viewerId, 11101);
        const body = request.body;
        const fields = [
            body.party_info,
            body.degree_id,
            body.background_card_id,
            body.player_history_topic_visible,
        ].filter(value => value !== undefined && value !== null);
        if (fields.length !== 1) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Exactly one history setting is required.",
            });
        }
        const update = {};
        if (body.party_info !== undefined && body.party_info !== null) {
            if (typeof body.party_info !== "object" || Array.isArray(body.party_info)) {
                return reply.status(400).send({ error: "Bad Request", message: "Invalid party info." });
            }
            const party = body.party_info;
            const characterIds = parseCharacterIds(party.character_ids);
            const unisonCharacterIds = parseCharacterIds(party.unison_character_ids);
            if (!characterIds || !unisonCharacterIds) {
                return reply.status(400).send({ error: "Bad Request", message: "Invalid party info." });
            }
            const owned = new Set(Object.keys((0, character_1.getPlayerCharactersSync)(resolved.playerId)).map(Number));
            if (![...characterIds, ...unisonCharacterIds].every(id => id === null || owned.has(id))) {
                return reply.status(400).send({
                    error: "Bad Request",
                    message: "Favorite character is not owned.",
                });
            }
            update.characterIds = characterIds;
            update.unisonCharacterIds = unisonCharacterIds;
        }
        else if (body.degree_id !== undefined && body.degree_id !== null) {
            if (!isPositiveInteger(body.degree_id)
                || !(0, degree_1.hasPlayerDegreeSync)(resolved.playerId, body.degree_id)) {
                return reply.status(400).send({ error: "Bad Request", message: "Degree is not owned." });
            }
            update.degreeId = body.degree_id;
        }
        else if (body.background_card_id !== undefined && body.background_card_id !== null) {
            if (!isPositiveInteger(body.background_card_id)
                || !catalog.backgroundIds.has(body.background_card_id)) {
                return reply.status(400).send({
                    error: "Bad Request",
                    message: "Invalid background card id.",
                });
            }
            update.backgroundCardId = body.background_card_id;
        }
        else {
            const visibility = parseTopicVisibility(body.player_history_topic_visible);
            const topicIndexes = new Set(catalog.topics.map(topic => String(topic.index)));
            if (!visibility || Object.keys(visibility).some(index => !topicIndexes.has(index))) {
                return reply.status(400).send({
                    error: "Bad Request",
                    message: "Invalid topic visibility.",
                });
            }
            update.topicVisibility = visibility;
        }
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId: resolved.playerId, operation: "player_history_edit",
        }, () => (0, player_history_1.updatePlayerHistorySettingsSync)(resolved.playerId, getDefaults(resolved.playerId, resolved.player, catalog), update));
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: resolved.viewerId }),
            data: {},
        });
    }));
});
exports.default = routes;
