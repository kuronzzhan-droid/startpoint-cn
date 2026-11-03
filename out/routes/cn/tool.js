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
const utils_1 = require("../../utils");
const session_1 = require("../../data/domains/session");
const account_1 = require("../../data/domains/account");
const player_1 = require("../../data/domains/player");
const types_1 = require("../../data/types");
const activeAccount_1 = require("../../data/activeAccount");
const player_login_1 = require("../../lib/player-login");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const account_creation_budget_1 = require("../../lib/account-creation-budget");
const player_login_rate_limit_1 = require("../../lib/player-login-rate-limit");
function generateLoginToken() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 32; i++) {
        token += chars[Math.floor(Math.random() * chars.length)];
    }
    return token;
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    const creation = (0, account_creation_budget_1.accountCreationBudget)(fastify);
    const returningLoginLimited = (0, player_login_rate_limit_1.createPlayerLoginRateLimiter)();
    fastify.post("/get_header_response", (request, reply) => {
        const body = request.body;
        reply.header("content-type", "application/x-msgpack");
        reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: body.viewer_id
            }),
            "data": []
        });
    });
    fastify.post("/auth", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)(),
            data: {}
        });
    }));
    fastify.post("/signup", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const signedIn = (_a = (0, player_login_1.verifiedPlayerLogin)(request)) !== null && _a !== void 0 ? _a : (0, player_login_1.readPlayerLoginSession)(request.headers["x-sp-session"]);
        if (signedIn) {
            const profile = (0, player_login_1.playerLoginProfile)(signedIn.account_id);
            reply.type("application/x-msgpack");
            return reply.send({ data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: signedIn.viewer_id, short_udid: 0, udid: signedIn.udid }),
                data: { login_token: signedIn.token, newAccount: 0, roleName: profile.name, accountName: profile.username,
                    sign: "dummy_sign", createDate: new Date().toISOString(), serverName: "StarPoint CN", serverId: 1 } });
        }
        const body = request.body;
        const udid = request.headers["udid"] || "unknown";
        const shortUdid = 0;
        const deviceId = body.device_id;
        const loginToken = generateLoginToken();
        let accountId;
        let newAccount = true;
        if (!deviceId) {
            return reply.status(400).send({ error: "Missing device_id" });
        }
        const reserved = { current: null };
        let signup;
        try {
            // Avoid taking a write lock when new-account capacity is exhausted.
            // The transaction rechecks the binding to handle concurrent deletion.
            const binding = (0, session_1.getDeviceBindingSync)(deviceId);
            const existing = binding && (0, account_1.getAccountSync)(binding.account_id);
            if (existing && returningLoginLimited(request.ip, "/player-auth/resume", {}, existing.id)) {
                return reply.header("retry-after", "60").type("application/x-msgpack").send({
                    data_headers: (0, utils_1.generateDataHeaders)({ result_code: 516 }), data: {},
                });
            }
            if (!existing) {
                reserved.current = creation.reserve(request.ip);
                if (!reserved.current)
                    throw new account_creation_budget_1.AccountCreationBudgetError();
            }
            signup = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "account", operation: "signup_device",
            }, () => {
                var _a;
                let resolvedAccountId;
                let createdPlayerId;
                let viewerId;
                // Device binding: each device gets its own account.
                const binding = (0, session_1.getDeviceBindingSync)(deviceId);
                if (binding) {
                    // Known device — verify account still exists.
                    const accountExists = (0, account_1.getAccountSync)(binding.account_id);
                    if (accountExists) {
                        resolvedAccountId = binding.account_id;
                        newAccount = false;
                        (0, account_1.updateAccountSync)(Object.assign({ id: resolvedAccountId, lastLoginTime: new Date() }, (accountExists.takeoverUdid ? { takeoverUdid: udid } : {})));
                        const sessions = (0, session_1.getAccountSessionsOfTypeSync)(resolvedAccountId, types_1.SessionType.VIEWER);
                        if (sessions.length > 0) {
                            viewerId = parseInt(sessions[0].token);
                            (0, session_1.deleteAccountSessionsOfTypeSync)(resolvedAccountId, types_1.SessionType.VIEWER);
                        }
                    }
                    else {
                        // Account was deleted — clean up the stale binding in the
                        // same transaction that creates its replacement.
                        (0, session_1.deleteDeviceBindingSync)(deviceId);
                    }
                }
                if (resolvedAccountId === undefined) {
                    // A previously valid account may disappear between the cheap
                    // read and BEGIN. Still require admission before creating it.
                    (_a = reserved.current) !== null && _a !== void 0 ? _a : (reserved.current = creation.reserve(request.ip));
                    if (!reserved.current)
                        throw new account_creation_budget_1.AccountCreationBudgetError();
                    const account = (0, account_1.insertAccountSync)({
                        appId: "wf_cn", idpAlias: "", idpCode: "leiting", idpId: "", status: "normal",
                    });
                    const player = (0, player_1.insertDefaultPlayerSync)(account.id);
                    (0, session_1.insertDeviceBindingSync)(deviceId, account.id);
                    resolvedAccountId = account.id;
                    createdPlayerId = player.id;
                }
                viewerId !== null && viewerId !== void 0 ? viewerId : (viewerId = (0, utils_1.generateViewerId)());
                (0, session_1.insertSessionWithTokenSync)({
                    token: String(viewerId),
                    accountId: resolvedAccountId,
                    type: types_1.SessionType.VIEWER,
                    expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                });
                return { accountId: resolvedAccountId, viewerId, createdPlayerId, newAccount };
            });
        }
        catch (error) {
            (_b = reserved.current) === null || _b === void 0 ? void 0 : _b.release();
            if (error instanceof account_creation_budget_1.AccountCreationBudgetError) {
                reply.type("application/x-msgpack");
                return reply.send({ data_headers: (0, utils_1.generateDataHeaders)({ result_code: 516 }), data: {} });
            }
            throw error;
        }
        if (signup.newAccount)
            (_c = reserved.current) === null || _c === void 0 ? void 0 : _c.commit();
        else
            (_d = reserved.current) === null || _d === void 0 ? void 0 : _d.release();
        accountId = signup.accountId;
        const viewerId = signup.viewerId;
        newAccount = signup.newAccount;
        if (signup.createdPlayerId !== undefined) {
            // Update the management-panel preference only after the DB commit.
            (0, activeAccount_1.saveAccountDefaultPlayer)(accountId, signup.createdPlayerId);
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId,
                short_udid: shortUdid,
                udid: udid,
            }),
            data: {
                login_token: loginToken,
                newAccount: newAccount ? 1 : 0,
                roleName: `Player${accountId}`,
                accountName: `Player${accountId}`,
                sign: "dummy_sign",
                createDate: new Date().toISOString(),
                serverName: "StarPoint CN",
                serverId: 1,
            }
        });
    }));
});
exports.default = routes;
