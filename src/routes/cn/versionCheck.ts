import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const CN_API_HOST = "shijtswygamegf.leiting.com";

const IOS_SDK_LOG_PATHS = [
    "/api/mg_log!addMgActivateLog.action",
    "/api/mg_log!addMgCreateRoleLog.action",
    "/api/mg_log!addMgLoginLog.action",
    "/api/mg_log!addMgRegisterLog.action",
] as const;

const versionData = [
    "// 用于官服正式用",
    JSON.stringify({
        "default": {
            "apiPath": CN_API_HOST,
        },
    })
].join("\r\n");

const routes = async (fastify: FastifyInstance) => {
    fastify.get("/shijtswy/version/client_release_android.dis",
        async (_request: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "text/plain; charset=utf-8");
        reply.status(200).send(versionData);
    });

    fastify.get("/shijtswy/version/client_release_ios.dis",
        async (_request: FastifyRequest, reply: FastifyReply) => {
        reply.header("content-type", "text/plain; charset=utf-8");
        reply.status(200).send(versionData);
    });

    // The iOS Leiting SDK treats a 404 from these telemetry endpoints as a
    // fatal H404 and returns the game to the title screen. The private server
    // does not consume this telemetry, so acknowledge it without persisting
    // or parsing the payload.
    for (const route of IOS_SDK_LOG_PATHS) {
        fastify.post(route, async (_request: FastifyRequest, reply: FastifyReply) => {
            reply.type("application/json; charset=utf-8");
            reply.status(200).send({ code: 0, message: "success" });
        });
    }

    // Older iOS builds query this legacy bootstrap document before entering
    // the normal game API flow. Keep it aligned with the .dis response.
    fastify.get("/wf/210009_config_20200415.json",
        async (_request: FastifyRequest, reply: FastifyReply) => {
        reply.type("application/json; charset=utf-8");
        reply.status(200).send({
            default: {
                apiPath: CN_API_HOST,
            },
        });
    });
};

export default routes;
