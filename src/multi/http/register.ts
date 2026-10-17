import { FastifyInstance } from "fastify"
import { registerLobbyRoutes } from "./lobby"
import { registerRoomRoutes } from "./room"
import { registerBattleRoutes } from "./battle"
import { registerSocialRoutes } from "./social"
import { installRealtimeHttpFailureHandler } from "./command-error"

export async function multiBattleRoutes(fastify: FastifyInstance): Promise<void> {
    installRealtimeHttpFailureHandler(fastify)
    registerLobbyRoutes(fastify)
    registerRoomRoutes(fastify)
    registerBattleRoutes(fastify)
    registerSocialRoutes(fastify)
}
