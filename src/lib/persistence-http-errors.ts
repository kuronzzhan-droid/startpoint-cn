import type { FastifyInstance } from "fastify"
import { generateDataHeaders } from "../utils"
import { isPersistenceAdmissionError } from "./persistence-admission"
import { requestRoutePath } from "./request-route-path"
import { ServerClosingError } from "./shutdown-state"

export function installPersistenceHttpErrors(app: FastifyInstance): void {
    app.setErrorHandler((error, request, reply) => {
        if (!isPersistenceAdmissionError(error)) return reply.send(error)
        reply.header("retry-after", "1")
        if (requestRoutePath(request).startsWith("/api/index.php/")) {
            return reply.status(200).type("application/x-msgpack").send({
                data_headers: generateDataHeaders({ result_code: 516 }), data: {},
            })
        }
        const closing = error instanceof ServerClosingError
        return reply.status(503).send({ ok: false, code: closing ? "SERVER_CLOSING" : "SERVER_BUSY",
            message: closing ? error.message : "服务器写入繁忙，请稍后重试。" })
    })
}
