import type { FastifyInstance } from "fastify"
import { RoomCommandError } from "../coordinator/command-protocol"
import { generateDataHeaders } from "../../utils"

/** An uncertain owner response cannot be presented as a dissolved room or a paid finish. */
export function installRealtimeHttpFailureHandler(fastify: FastifyInstance): void {
    const fallback = fastify.errorHandler
    fastify.setErrorHandler((error, request, reply) => {
        if (!(error instanceof RoomCommandError)) return fallback.call(fastify, error, request, reply)
        const viewerId = Number((request.body as { viewer_id?: unknown } | null)?.viewer_id) || 0
        console.warn(`[MULTI-REALTIME] request unavailable code=${error.code} unknown=${error.outcomeUnknown}`)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({ data_headers: generateDataHeaders({ viewer_id: viewerId, result_code: 4050 }), data: {} })
    })
}
