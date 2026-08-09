import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { getPlayerSync } from "../../data/domains/player";
import { getSession } from "../../data/domains/session";
import { getFavoritePartySelectionSync } from "../../lib/profileFavorite";
import { generateDataHeaders } from "../../utils";

/**
 * The 1.4.59 client opens the extended player-history card through this
 * endpoint. CN saves do not persist the JP history-topic aggregates, but the
 * client still requires a complete response envelope before it can render the
 * card. Return the player's real profile party/title and an empty topic map;
 * the latter intentionally renders no unsupported history rows.
 */
const routes = async (fastify: FastifyInstance) => {
    fastify.post("/index", async (
        request: FastifyRequest,
        reply: FastifyReply,
    ) => {
        const body = request.body as any;
        const viewerId = Number(body?.viewer_id);
        if (!Number.isFinite(viewerId)) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body.",
            });
        }

        const session = await getSession(String(viewerId));
        if (!session) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id.",
            });
        }

        const playerId = resolvePlayerIdSync(session.accountId);
        const player = playerId === null ? null : getPlayerSync(playerId);
        if (playerId === null || !player) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account.",
            });
        }

        const favorite = getFavoritePartySelectionSync(
            playerId,
            player.leaderCharacterId,
        );

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: viewerId }),
            data: {
                // The CN 1.4.59 client contains the initial history/card
                // definitions under ID 1.
                player_history_id: 1,
                background_card_id: 1,
                degree_id: player.degreeId || 1,
                favorite_character: {
                    character_ids: favorite.characterIds,
                    unison_character_ids: favorite.unisonCharacterIds,
                },
                player_history_topic_list: {},
            },
        });
    });
};

export default routes;
