import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import {
    addFollow,
    bulkEditFollow,
    deleteFollower,
    deleteFollow,
    getFollowerCountSync,
    getPlayerIdByViewerIdSync,
    getRelatedPlayerIdsSync,
    getViewerIdByPlayerIdSync,
    MAX_FOLLOWING,
} from "../../data/domains/follow";
import { getSession } from "../../data/domains/session";
import { buildFollowUserInfoSync } from "../../lib/follow";
import { resolveProfileTargetPlayerIdSync } from "../../lib/profile-target";
import { generateDataHeaders } from "../../utils";
import { gameVerboseLog } from "../../lib/game-logging";

interface RequestContext {
    viewerId: number;
    playerId: number;
}

async function resolveContext(body: any): Promise<RequestContext | null> {
    const viewerId = Number(body?.viewer_id);
    if (!Number.isFinite(viewerId)) return null;
    const session = await getSession(String(viewerId));
    if (!session) return null;
    const playerId = resolvePlayerIdSync(session.accountId);
    return playerId ? { viewerId, playerId } : null;
}

function send(reply: FastifyReply, viewerId: number, data: any, resultCode = 1) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: resultCode }),
        data,
    });
}

function resolveTargetPlayerId(value: unknown): number | null {
    return resolveProfileTargetPlayerIdSync(Number(value));
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/lists", async (request: FastifyRequest, reply: FastifyReply) => {
        const ctx = await resolveContext(request.body);
        if (!ctx) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });

        const followInfo = getRelatedPlayerIdsSync(ctx.playerId)
            .map(targetPlayerId => buildFollowUserInfoSync(ctx.playerId, targetPlayerId))
            .filter((info): info is any => info !== null);
        return send(reply, ctx.viewerId, {
            follow_info: followInfo,
            followed_count: getFollowerCountSync(ctx.playerId),
        });
    });

    fastify.post("/add", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any;
        const ctx = await resolveContext(body);
        if (!ctx) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const targetPlayerId = resolveTargetPlayerId(body.follow_id);
        if (targetPlayerId === null) return send(reply, ctx.viewerId, {}, 1457);

        const result = await addFollow(ctx.playerId, targetPlayerId);
        if (result === "following_limit") return send(reply, ctx.viewerId, {}, 1451);
        if (result === "follower_limit") return send(reply, ctx.viewerId, {}, 1452);
        if (result === "self" || result === "target_not_found") return send(reply, ctx.viewerId, {}, 1457);
        gameVerboseLog(() => `[FOLLOW] add viewer=${ctx.viewerId} target=${Number(body.follow_id)} result=${result}`);
        return send(reply, ctx.viewerId, {});
    });

    fastify.post("/delete", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any;
        const ctx = await resolveContext(body);
        if (!ctx) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const targetPlayerId = resolveTargetPlayerId(body.follow_id);
        if (targetPlayerId !== null) await deleteFollow(ctx.playerId, targetPlayerId);
        gameVerboseLog(() => `[FOLLOW] delete viewer=${ctx.viewerId} target=${Number(body.follow_id)}`);
        return send(reply, ctx.viewerId, {});
    });

    fastify.post("/delete_followed", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any;
        const ctx = await resolveContext(body);
        if (!ctx) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const followerPlayerId = resolveTargetPlayerId(body.followed_id);
        if (followerPlayerId !== null) await deleteFollower(ctx.playerId, followerPlayerId);
        gameVerboseLog(() => `[FOLLOW] delete_follower viewer=${ctx.viewerId} follower=${Number(body.followed_id)}`);
        return send(reply, ctx.viewerId, {});
    });

    fastify.post("/bulk_edit", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any;
        // Bound work before resolving every supplied target or opening a write
        // transaction. One request can replace the whole legal following list.
        for (const field of ["add_follow_id_list", "delete_follow_id_list"]) {
            const ids = body?.[field];
            if (ids === undefined || ids === null) continue;
            if (!Array.isArray(ids) || ids.length > MAX_FOLLOWING
                || ids.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
                return reply.status(400).send({ error: "Invalid follow list", maxItems: MAX_FOLLOWING });
            }
        }
        const ctx = await resolveContext(body);
        if (!ctx) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });

        const addPlayerIds = ((body.add_follow_id_list || []) as any[])
            .map(id => resolveTargetPlayerId(id))
            .filter((id): id is number => id !== null);
        const deletePlayerIds = ((body.delete_follow_id_list || []) as any[])
            .map(id => resolveTargetPlayerId(id))
            .filter((id): id is number => id !== null);
        const fullPlayerIds = await bulkEditFollow(ctx.playerId, addPlayerIds, deletePlayerIds);
        const fullViewerIds = fullPlayerIds
            .map(getViewerIdByPlayerIdSync)
            .filter((id): id is number => id !== null);
        return send(reply, ctx.viewerId, { max_follower_user_viewer_id_list: fullViewerIds });
    });

    fastify.post("/search_id", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any;
        const ctx = await resolveContext(body);
        if (!ctx) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        const targetViewerId = Number(String(body.search_id || "").trim());
        const targetPlayerId = getPlayerIdByViewerIdSync(targetViewerId);
        if (targetPlayerId === null || targetPlayerId === ctx.playerId) {
            return send(reply, ctx.viewerId, {}, 1457);
        }
        const searchResult = buildFollowUserInfoSync(ctx.playerId, targetPlayerId);
        if (!searchResult) return send(reply, ctx.viewerId, {}, 1457);
        return send(reply, ctx.viewerId, { search_result: searchResult });
    });

    fastify.post("/search_twitter", async (request: FastifyRequest, reply: FastifyReply) => {
        const ctx = await resolveContext(request.body);
        if (!ctx) return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        return send(reply, ctx.viewerId, { search_result: [] });
    });
};

export default routes;
