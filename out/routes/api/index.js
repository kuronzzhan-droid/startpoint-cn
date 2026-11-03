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
const player_time_compat_1 = require("../../lib/player-time-compat");
const types_1 = require("../../data/types");
const utils_1 = require("../../data/utils");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const utils_2 = require("../../utils");
const daily_vmoney_mail_1 = require("../../lib/daily-vmoney-mail");
const validate_1 = require("../../lib/validate");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/load", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const zat = body.access_token;
        let viewerId = body.viewer_id;
        if (!zat || !viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const session = yield (0, session_1.getSession)(zat);
        if (session === null || session.type !== types_1.SessionType.ZAT)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid zat provided."
            });
        const viewerSession = yield (0, session_1.getSession)(String(viewerId));
        if (viewerSession === null || viewerSession.type !== types_1.SessionType.VIEWER)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer ID provided."
            });
        const accountId = session.accountId;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        const player = (0, player_1.getPlayerSync)(playerId);
        if (player === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player data."
            });
        const clock = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "legacy_load_snapshot",
        }, () => {
            var _a;
            const now = (0, utils_2.getServerDate)();
            const current = (0, player_1.getPlayerSync)(playerId);
            if (!current)
                throw new Error("Player disappeared during load maintenance.");
            (0, daily_vmoney_mail_1.ensureDailyVmoneyMailForPlayerSync)(playerId, (0, utils_2.getRealServerDate)().getTime());
            (0, player_1.dailyResetPlayerDataSync)(current, now);
            (0, player_1.collectPlayerDataPooledExpSync)(current, now);
            (0, player_1.updatePlayerSync)({ id: playerId, lastLoginTime: (0, player_time_compat_1.getPlayerBusinessDateSync)(playerId, now) });
            (0, validate_1.runPermanentValidators)(playerId);
            return { now, offset: (_a = (0, utils_2.getTimeOffset)()) !== null && _a !== void 0 ? _a : 0 };
        });
        const clientData = (0, utils_2.withServerClock)(clock.now, () => (0, utils_1.getClientSerializedData)(playerId, { viewerId }), clock.offset);
        if (clientData === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player data."
            });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_2.generateDataHeaders)({
                asset_update: true,
                viewer_id: viewerId
            }),
            "data": clientData
        });
    }));
});
exports.default = routes;
