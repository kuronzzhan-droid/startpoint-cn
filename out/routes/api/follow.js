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
const follow_1 = require("../../data/domains/follow");
const session_1 = require("../../data/domains/session");
const follow_2 = require("../../lib/follow");
const profile_target_1 = require("../../lib/profile-target");
const utils_1 = require("../../utils");
const game_logging_1 = require("../../lib/game-logging");
function resolveContext(body) {
    return __awaiter(this, void 0, void 0, function* () {
        const viewerId = Number(body === null || body === void 0 ? void 0 : body.viewer_id);
        if (!Number.isFinite(viewerId))
            return null;
        const session = yield (0, session_1.getSession)(String(viewerId));
        if (!session)
            return null;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        return playerId ? { viewerId, playerId } : null;
    });
}
function send(reply, viewerId, data, resultCode = 1) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: resultCode }),
        data,
    });
}
function resolveTargetPlayerId(value) {
    return (0, profile_target_1.resolveProfileTargetPlayerIdSync)(Number(value));
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/lists", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const ctx = yield resolveContext(request.body);
        if (!ctx)
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const followInfo = (0, follow_1.getRelatedPlayerIdsSync)(ctx.playerId)
            .map(targetPlayerId => (0, follow_2.buildFollowUserInfoSync)(ctx.playerId, targetPlayerId))
            .filter((info) => info !== null);
        return send(reply, ctx.viewerId, {
            follow_info: followInfo,
            followed_count: (0, follow_1.getFollowerCountSync)(ctx.playerId),
        });
    }));
    fastify.post("/add", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const ctx = yield resolveContext(body);
        if (!ctx)
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const targetPlayerId = resolveTargetPlayerId(body.follow_id);
        if (targetPlayerId === null)
            return send(reply, ctx.viewerId, {}, 1457);
        const result = yield (0, follow_1.addFollow)(ctx.playerId, targetPlayerId);
        if (result === "following_limit")
            return send(reply, ctx.viewerId, {}, 1451);
        if (result === "follower_limit")
            return send(reply, ctx.viewerId, {}, 1452);
        if (result === "self" || result === "target_not_found")
            return send(reply, ctx.viewerId, {}, 1457);
        (0, game_logging_1.gameVerboseLog)(() => `[FOLLOW] add viewer=${ctx.viewerId} target=${Number(body.follow_id)} result=${result}`);
        return send(reply, ctx.viewerId, {});
    }));
    fastify.post("/delete", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const ctx = yield resolveContext(body);
        if (!ctx)
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const targetPlayerId = resolveTargetPlayerId(body.follow_id);
        if (targetPlayerId !== null)
            yield (0, follow_1.deleteFollow)(ctx.playerId, targetPlayerId);
        (0, game_logging_1.gameVerboseLog)(() => `[FOLLOW] delete viewer=${ctx.viewerId} target=${Number(body.follow_id)}`);
        return send(reply, ctx.viewerId, {});
    }));
    fastify.post("/delete_followed", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const ctx = yield resolveContext(body);
        if (!ctx)
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const followerPlayerId = resolveTargetPlayerId(body.followed_id);
        if (followerPlayerId !== null)
            yield (0, follow_1.deleteFollower)(ctx.playerId, followerPlayerId);
        (0, game_logging_1.gameVerboseLog)(() => `[FOLLOW] delete_follower viewer=${ctx.viewerId} follower=${Number(body.followed_id)}`);
        return send(reply, ctx.viewerId, {});
    }));
    fastify.post("/bulk_edit", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        // Bound work before resolving every supplied target or opening a write
        // transaction. One request can replace the whole legal following list.
        for (const field of ["add_follow_id_list", "delete_follow_id_list"]) {
            const ids = body === null || body === void 0 ? void 0 : body[field];
            if (ids === undefined || ids === null)
                continue;
            if (!Array.isArray(ids) || ids.length > follow_1.MAX_FOLLOWING
                || ids.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
                return reply.status(400).send({ error: "Invalid follow list", maxItems: follow_1.MAX_FOLLOWING });
            }
        }
        const ctx = yield resolveContext(body);
        if (!ctx)
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const addPlayerIds = (body.add_follow_id_list || [])
            .map(id => resolveTargetPlayerId(id))
            .filter((id) => id !== null);
        const deletePlayerIds = (body.delete_follow_id_list || [])
            .map(id => resolveTargetPlayerId(id))
            .filter((id) => id !== null);
        const fullPlayerIds = yield (0, follow_1.bulkEditFollow)(ctx.playerId, addPlayerIds, deletePlayerIds);
        const fullViewerIds = fullPlayerIds
            .map(follow_1.getViewerIdByPlayerIdSync)
            .filter((id) => id !== null);
        return send(reply, ctx.viewerId, { max_follower_user_viewer_id_list: fullViewerIds });
    }));
    fastify.post("/search_id", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const ctx = yield resolveContext(body);
        if (!ctx)
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const targetViewerId = Number(String(body.search_id || "").trim());
        const targetPlayerId = (0, follow_1.getPlayerIdByViewerIdSync)(targetViewerId);
        if (targetPlayerId === null || targetPlayerId === ctx.playerId) {
            return send(reply, ctx.viewerId, {}, 1457);
        }
        const searchResult = (0, follow_2.buildFollowUserInfoSync)(ctx.playerId, targetPlayerId);
        if (!searchResult)
            return send(reply, ctx.viewerId, {}, 1457);
        return send(reply, ctx.viewerId, { search_result: searchResult });
    }));
    fastify.post("/search_twitter", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const ctx = yield resolveContext(request.body);
        if (!ctx)
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        return send(reply, ctx.viewerId, { search_result: [] });
    }));
});
exports.default = routes;
