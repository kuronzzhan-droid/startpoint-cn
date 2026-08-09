import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "../../data/domains/session";
import { generateDataHeaders } from "../../utils";

async function resolveViewerId(body: any): Promise<number | null> {
    const viewerId = Number(body?.viewer_id);
    if (!Number.isFinite(viewerId)) return null;
    return await getSession(String(viewerId)) ? viewerId : null;
}

function send(reply: FastifyReply, viewerId: number, data: any) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: generateDataHeaders({ viewer_id: viewerId }),
        data,
    });
}

const routes = async (fastify: FastifyInstance) => {
    // The follow screen asks once per supported SNS type. Returning explicit
    // nulls is parsed by the client as NoData and prevents it from attempting
    // a Twitter import for accounts that have no social account bound.
    fastify.post("/get", async (request: FastifyRequest, reply: FastifyReply) => {
        const viewerId = await resolveViewerId(request.body);
        if (viewerId === null) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        }
        return send(reply, viewerId, {
            profile_image_url: null,
            twitter_id: null,
        });
    });

    // Keep the optional social-link control safe. No external Twitter data is
    // stored or fetched by this private server implementation.
    fastify.post("/update_twitter", async (request: FastifyRequest, reply: FastifyReply) => {
        const viewerId = await resolveViewerId(request.body);
        if (viewerId === null) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        }
        return send(reply, viewerId, {});
    });
};

export default routes;
