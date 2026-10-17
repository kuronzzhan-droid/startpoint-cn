import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { getRoomCommandGateway, realtimeOwnerStatus } from "../../multi/coordinator/default-runtime"

/** Management-only runtime controls for bounded multiplayer diagnostics. */
const routes = async (fastify: FastifyInstance) => {
    fastify.get("/realtime", async (_request: FastifyRequest, reply: FastifyReply) => {
        try { return reply.status(200).send(await getRoomCommandGateway().execute("runtime.diagnostics", {})) }
        catch { return reply.status(503).send({ error: "REALTIME_OWNER_UNAVAILABLE", owner: realtimeOwnerStatus() }) }
    })

    // Recent per-battle summaries (same content as the [MULTI-BATTLE] log lines).
    fastify.get("/battles", async (_request: FastifyRequest, reply: FastifyReply) => {
        try { return reply.status(200).send(await getRoomCommandGateway().execute("runtime.battles", {})) }
        catch { return reply.status(503).send({ error: "REALTIME_OWNER_UNAVAILABLE" }) }
    })

    fastify.post("/realtime", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            return reply.status(200).send(await getRoomCommandGateway().execute("runtime.configureDiagnostics", request.body ?? {}))
        } catch (error) {
            return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) })
        }
    })
}

export default routes
