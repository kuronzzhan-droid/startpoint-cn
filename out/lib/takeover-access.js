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
exports.getRequestUdid = exports.installTakeoverUdidGuard = exports.TAKEOVER_OLD_ACCESS_ERROR = void 0;
const db_1 = require("../data/db");
const types_1 = require("../data/types");
const utils_1 = require("../utils");
const player_login_1 = require("./player-login");
const request_route_path_1 = require("./request-route-path");
exports.TAKEOVER_OLD_ACCESS_ERROR = 516;
function normalizeViewerId(value) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
        return String(value);
    if (typeof value !== "string" || !/^\d{1,15}$/.test(value))
        return null;
    return value;
}
/** Reject the superseded local store after an account has moved devices. */
function installTakeoverUdidGuard(fastify) {
    fastify.addHook("preHandler", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const requestPath = (0, request_route_path_1.requestRoutePath)(request);
        if (!requestPath.startsWith("/api/index.php/"))
            return;
        // The new account guard has already checked this exact request and account.
        if ((0, player_login_1.verifiedPlayerLogin)(request))
            return;
        // Leaderboard reads are public and may be retried without the local-store UDID.
        // Keep takeover protection for mutating/authenticated APIs, but do not turn a
        // missing UDID into an empty leaderboard response that the client cannot render.
        if (requestPath.endsWith("/event/rush/leaderboard"))
            return;
        const body = request.body;
        if (!body || typeof body !== "object" || Array.isArray(body))
            return;
        const viewerId = normalizeViewerId(body.viewer_id);
        if (!viewerId)
            return;
        const row = (0, db_1.getDb)().prepare(`
            SELECT a.takeover_udid
            FROM sessions AS s
            JOIN accounts AS a ON a.id = s.account_id
            WHERE s.token = ? AND s.type = ?
            LIMIT 1
        `).get(viewerId, types_1.SessionType.VIEWER);
        if (!(row === null || row === void 0 ? void 0 : row.takeover_udid))
            return;
        if (String((_a = request.headers.udid) !== null && _a !== void 0 ? _a : "") === row.takeover_udid)
            return;
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({
                viewer_id: Number(viewerId),
                result_code: exports.TAKEOVER_OLD_ACCESS_ERROR,
            }),
            data: {},
        });
    }));
}
exports.installTakeoverUdidGuard = installTakeoverUdidGuard;
function getRequestUdid(request) {
    var _a;
    const value = request.headers.udid;
    if (Array.isArray(value))
        return ((_a = value[0]) === null || _a === void 0 ? void 0 : _a.trim()) || null;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
exports.getRequestUdid = getRequestUdid;
