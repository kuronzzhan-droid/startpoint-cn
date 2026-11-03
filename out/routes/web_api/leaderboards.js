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
const leaderboard_1 = require("../../data/domains/leaderboard");
const competition_1 = require("../../lib/leaderboard/competition");
const settlement_1 = require("../../lib/leaderboard/settlement");
const availability_1 = require("../../lib/leaderboard/availability");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const work_control_1 = require("../../lib/leaderboard/work-control");
const sync_budget_1 = require("../../lib/leaderboard/sync-budget");
const persistence_admission_1 = require("../../lib/persistence-admission");
function resolveKey(request, reply) {
    const key = request.params.key;
    if ((0, competition_1.getLeaderboardCompetition)(key) !== null)
        return key;
    reply.status(404).send({ error: "Leaderboard competition not found." });
    return null;
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.setErrorHandler((error, _request, reply) => {
        if (error instanceof sync_budget_1.LeaderboardSyncLimitError)
            return reply.status(409).send({
                error: error.message, code: error.code, resource: error.resource,
                limit: sync_budget_1.SYNCHRONOUS_SETTLEMENT_LIMITS[error.resource], observed: error.observed,
            });
        if (!(error instanceof work_control_1.LeaderboardWorkBusyError))
            return reply.send(error);
        return reply.header("retry-after", "2").status(429).send({ error: error.message, code: error.code });
    });
    fastify.get("/", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        return reply.send((0, competition_1.getLeaderboardCompetitions)().map(competition => ({
            competition,
            availability: (0, availability_1.getLeaderboardAvailabilitySync)(competition.key),
            overview: (0, settlement_1.getLeaderboardSettlementOverviewSync)(competition.key),
        })));
    }));
    fastify.get("/:key", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const key = resolveKey(request, reply);
        if (key === null)
            return reply;
        const competition = (0, competition_1.getLeaderboardCompetition)(key);
        const season = (0, competition_1.getLeaderboardCompetitionSeasonSync)(key);
        const query = request.query;
        const requestedPage = Number((_a = query.page) !== null && _a !== void 0 ? _a : 0);
        if (!Number.isSafeInteger(requestedPage) || requestedPage < 0) {
            return reply.status(400).send({ error: "page must be a non-negative safe integer." });
        }
        const { total, filter } = (0, settlement_1.getLeaderboardSeasonRewardViewSync)(key, season);
        const page = Math.min(requestedPage, Math.max(0, Math.ceil(total / competition.pageSize) - 1));
        return reply.send({
            competition,
            availability: (0, availability_1.getLeaderboardAvailabilitySync)(key),
            overview: (0, settlement_1.getLeaderboardSettlementOverviewSync)(key),
            page,
            rows: (0, leaderboard_1.getLeaderboardRankPageSync)({
                competitionKey: key,
                season,
                offset: page * competition.pageSize,
                limit: competition.pageSize,
                filter,
            }),
            total,
        });
    }));
    fastify.patch("/:key/availability", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _b;
        const key = resolveKey(request, reply);
        if (key === null)
            return reply;
        const body = ((_b = request.body) !== null && _b !== void 0 ? _b : {});
        if (typeof body.enabled !== "boolean") {
            return reply.status(400).send({ error: "enabled must be a boolean." });
        }
        const enabled = body.enabled;
        if (enabled) {
            const season = (0, competition_1.getLeaderboardCompetitionSeasonSync)(key);
            if ((0, settlement_1.getLeaderboardSeasonRewardViewSync)(key, season).settled) {
                return reply.status(409).send({ error: "当前赛季已结算，请先换季再开启排行榜。" });
            }
            if ((0, availability_1.isLeaderboardDeadlineDueSync)(key)) {
                return reply.status(409).send({ error: "已到截止时间，请先修改截止时间或关闭定时开关，再开启排行榜。" });
            }
        }
        return reply.send(Object.assign({ ok: true }, (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "leaderboard", operation: `admin_availability:${key}`,
        }, () => (0, availability_1.setLeaderboardAvailabilitySync)(key, enabled))));
    }));
    fastify.patch("/:key/config", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _c;
        const key = resolveKey(request, reply);
        if (key === null)
            return reply;
        const current = (0, settlement_1.getLeaderboardSettlementConfigSync)(key);
        const body = ((_c = request.body) !== null && _c !== void 0 ? _c : {});
        const rewardTiers = body.rewardTiers === undefined
            ? current.rewardTiers
            : body.rewardTiers;
        try {
            for (const field of ["autoEnabled", "freezeEnabled"]) {
                if (body[field] !== undefined && typeof body[field] !== "boolean") {
                    throw new Error("到时冻结和自动发奖开关必须是布尔值。");
                }
            }
            const autoEnabled = body.autoEnabled === undefined ? current.autoEnabled : body.autoEnabled;
            const freezeEnabled = autoEnabled || (body.freezeEnabled === undefined
                ? current.freezeEnabled : body.freezeEnabled);
            const settleAtMs = body.settleAtMs === undefined ? current.settleAtMs
                : body.settleAtMs === null ? null : Number(body.settleAtMs);
            if ((autoEnabled || freezeEnabled) && settleAtMs === null) {
                throw new Error("开启定时冻结或自动发奖时必须设置截止时间。");
            }
            (0, settlement_1.validateRewardTiers)(rewardTiers);
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "leaderboard", operation: `admin_config:${key}`,
            }, () => (0, settlement_1.putLeaderboardSettlementConfigSync)(Object.assign(Object.assign({}, current), { autoEnabled,
                freezeEnabled,
                settleAtMs, repeatIntervalMs: body.repeatIntervalMs === undefined
                    ? current.repeatIntervalMs
                    : body.repeatIntervalMs === null ? null : Number(body.repeatIntervalMs), rewardTiers, mailSubject: typeof body.mailSubject === "string"
                    ? body.mailSubject : current.mailSubject, mailBody: typeof body.mailBody === "string"
                    ? body.mailBody : current.mailBody, excludeBots: body.excludeBots === undefined
                    ? current.excludeBots : Boolean(body.excludeBots), updatedAtMs: Date.now() })));
        }
        catch (error) {
            if ((0, persistence_admission_1.isPersistenceAdmissionError)(error))
                throw error;
            return reply.status(400).send({
                error: error instanceof Error ? error.message : "Invalid settlement config.",
            });
        }
        return reply.send({ ok: true, config: (0, settlement_1.getLeaderboardSettlementConfigSync)(key) });
    }));
    fastify.post("/:key/settle", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _d;
        const key = resolveKey(request, reply);
        if (key === null)
            return reply;
        const body = ((_d = request.body) !== null && _d !== void 0 ? _d : {});
        const expectedSeason = body.expectedSeason;
        if (expectedSeason !== undefined && (!Number.isSafeInteger(expectedSeason) || expectedSeason < 1)) {
            return reply.status(400).send({ error: "expectedSeason must be a positive safe integer." });
        }
        const outcome = yield (0, settlement_1.settleLeaderboardSeason)(key, "admin-manual", undefined, expectedSeason);
        return reply.status(outcome.ok ? 200 : 409).send(outcome);
    }));
    fastify.post("/:key/rollover", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const key = resolveKey(request, reply);
        if (key === null)
            return reply;
        const outcome = yield (0, work_control_1.runLeaderboardWork)(key, "rollover", () => (0, settlement_1.rolloverLeaderboardSeasonSync)(key, "admin-rollover"));
        return reply.status(outcome.ok ? 200 : 409).send(outcome.ok ? outcome : Object.assign(Object.assign({}, outcome), { error: "当前赛季尚未结算，不能换季。" }));
    }));
});
exports.default = routes;
