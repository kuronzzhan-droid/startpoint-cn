"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installRealtimeHttpFailureHandler = void 0;
const command_protocol_1 = require("../coordinator/command-protocol");
const utils_1 = require("../../utils");
/** An uncertain owner response cannot be presented as a dissolved room or a paid finish. */
function installRealtimeHttpFailureHandler(fastify) {
    const fallback = fastify.errorHandler;
    fastify.setErrorHandler((error, request, reply) => {
        var _a;
        if (!(error instanceof command_protocol_1.RoomCommandError))
            return fallback.call(fastify, error, request, reply);
        const viewerId = Number((_a = request.body) === null || _a === void 0 ? void 0 : _a.viewer_id) || 0;
        console.warn(`[MULTI-REALTIME] request unavailable code=${error.code} unknown=${error.outcomeUnknown}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({ data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: 4050 }), data: {} });
    });
}
exports.installRealtimeHttpFailureHandler = installRealtimeHttpFailureHandler;
