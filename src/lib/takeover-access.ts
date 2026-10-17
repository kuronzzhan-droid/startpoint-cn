import type { FastifyInstance, FastifyRequest } from "fastify"
import { getDb } from "../data/db"
import { SessionType } from "../data/types"
import { generateDataHeaders } from "../utils"
import { verifiedPlayerLogin } from "./player-login"
import { requestRoutePath } from "./request-route-path"

export const TAKEOVER_OLD_ACCESS_ERROR = 516

function normalizeViewerId(value: unknown): string | null {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value)
    if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) return null
    return value
}

/** Reject the superseded local store after an account has moved devices. */
export function installTakeoverUdidGuard(fastify: FastifyInstance): void {
    fastify.addHook("preHandler", async (request, reply) => {
        const requestPath = requestRoutePath(request)
        if (!requestPath.startsWith("/api/index.php/")) return
        // The new account guard has already checked this exact request and account.
        if (verifiedPlayerLogin(request)) return
        // Leaderboard reads are public and may be retried without the local-store UDID.
        // Keep takeover protection for mutating/authenticated APIs, but do not turn a
        // missing UDID into an empty leaderboard response that the client cannot render.
        if (requestPath.endsWith("/event/rush/leaderboard")) return
        const body = request.body
        if (!body || typeof body !== "object" || Array.isArray(body)) return
        const viewerId = normalizeViewerId((body as Record<string, unknown>).viewer_id)
        if (!viewerId) return

        const row = getDb().prepare(`
            SELECT a.takeover_udid
            FROM sessions AS s
            JOIN accounts AS a ON a.id = s.account_id
            WHERE s.token = ? AND s.type = ?
            LIMIT 1
        `).get(viewerId, SessionType.VIEWER) as { takeover_udid: string | null } | undefined
        if (!row?.takeover_udid) return
        if (String(request.headers.udid ?? "") === row.takeover_udid) return

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({
                viewer_id: Number(viewerId),
                result_code: TAKEOVER_OLD_ACCESS_ERROR,
            }),
            data: {},
        })
    })
}

export function getRequestUdid(request: FastifyRequest): string | null {
    const value = request.headers.udid
    if (Array.isArray(value)) return value[0]?.trim() || null
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}
