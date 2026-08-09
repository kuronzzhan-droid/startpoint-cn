import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { reloadRogueEventConfig } from "../../lib/assets"

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/ping", async () => ({
        ok: true,
        server_time: new Date().toISOString(),
    }))

    fastify.post(
        "/reload_assets",
        async (_request: FastifyRequest, reply: FastifyReply) => {
            try {
                return reply.status(200).send({
                    ok: true,
                    reloaded: reloadRogueEventConfig(),
                })
            } catch (error) {
                fastify.log.error(error)
                return reply.status(500).send({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        },
    )
}

export default routes
