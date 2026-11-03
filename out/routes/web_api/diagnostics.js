"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const default_runtime_1 = require("../../multi/coordinator/default-runtime");
/** Management-only runtime controls for bounded multiplayer diagnostics. */
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.get("/realtime", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            return reply.status(200).send(yield (0, default_runtime_1.getRoomCommandGateway)().execute("runtime.diagnostics", {}));
        }
        catch (_a) {
            return reply.status(503).send({ error: "REALTIME_OWNER_UNAVAILABLE", owner: (0, default_runtime_1.realtimeOwnerStatus)() });
        }
    }));
    // Recent per-battle summaries (same content as the [MULTI-BATTLE] log lines).
    fastify.get("/battles", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            return reply.status(200).send(yield (0, default_runtime_1.getRoomCommandGateway)().execute("runtime.battles", {}));
        }
        catch (_b) {
            return reply.status(503).send({ error: "REALTIME_OWNER_UNAVAILABLE" });
        }
    }));
    fastify.post("/realtime", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _c;
        try {
            return reply.status(200).send(yield (0, default_runtime_1.getRoomCommandGateway)().execute("runtime.configureDiagnostics", (_c = request.body) !== null && _c !== void 0 ? _c : {}));
        }
        catch (error) {
            return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) });
        }
    }));
});
exports.default = routes;
