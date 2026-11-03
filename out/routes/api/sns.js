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
const session_1 = require("../../data/domains/session");
const utils_1 = require("../../utils");
function resolveViewerId(body) {
    return __awaiter(this, void 0, void 0, function* () {
        const viewerId = Number(body === null || body === void 0 ? void 0 : body.viewer_id);
        if (!Number.isFinite(viewerId))
            return null;
        return (yield (0, session_1.getSession)(String(viewerId))) ? viewerId : null;
    });
}
function send(reply, viewerId, data) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
        data,
    });
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    // The follow screen asks once per supported SNS type. Returning explicit
    // nulls is parsed by the client as NoData and prevents it from attempting
    // a Twitter import for accounts that have no social account bound.
    fastify.post("/get", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const viewerId = yield resolveViewerId(request.body);
        if (viewerId === null) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        }
        return send(reply, viewerId, {
            profile_image_url: null,
            twitter_id: null,
        });
    }));
    // Keep the optional social-link control safe. No external Twitter data is
    // stored or fetched by this private server implementation.
    fastify.post("/update_twitter", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const viewerId = yield resolveViewerId(request.body);
        if (viewerId === null) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
        }
        return send(reply, viewerId, {});
    }));
});
exports.default = routes;
