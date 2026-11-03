"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installPersistenceHttpErrors = void 0;
const utils_1 = require("../utils");
const persistence_admission_1 = require("./persistence-admission");
const request_route_path_1 = require("./request-route-path");
const shutdown_state_1 = require("./shutdown-state");
function installPersistenceHttpErrors(app) {
    app.setErrorHandler((error, request, reply) => {
        if (!(0, persistence_admission_1.isPersistenceAdmissionError)(error))
            return reply.send(error);
        reply.header("retry-after", "1");
        if ((0, request_route_path_1.requestRoutePath)(request).startsWith("/api/index.php/")) {
            return reply.status(200).type("application/x-msgpack").send({
                data_headers: (0, utils_1.generateDataHeaders)({ result_code: 516 }), data: {},
            });
        }
        const closing = error instanceof shutdown_state_1.ServerClosingError;
        return reply.status(503).send({ ok: false, code: closing ? "SERVER_CLOSING" : "SERVER_BUSY",
            message: closing ? error.message : "服务器写入繁忙，请稍后重试。" });
    });
}
exports.installPersistenceHttpErrors = installPersistenceHttpErrors;
