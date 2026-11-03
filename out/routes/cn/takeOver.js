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
exports.clearRecoveryFailuresForViewer = void 0;
const crypto_1 = require("crypto");
const db_1 = require("../../data/db");
const account_1 = require("../../data/domains/account");
const character_1 = require("../../data/domains/character");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const types_1 = require("../../data/types");
const stamina_1 = require("../../lib/stamina");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const takeover_access_1 = require("../../lib/takeover-access");
const player_party_pool_1 = require("../../multi/npc/player-party-pool");
const utils_1 = require("../../utils");
const TAKEOVER_INPUT_ID_ERROR = 3203;
const TAKEOVER_INPUT_ID_OR_PASSWORD_ERROR = 3204;
const SOCIAL_ACCOUNT_NOT_FOUND = 3205;
const FAILURE_LIMIT = 5;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
// Keep attacker-controlled IP/viewer keys and their last password bounded.
const FAILURE_MAP_MAX = 4096;
let nextFailureSweepAt = 0;
// The native client may submit the same recovery lookup more than once while
// closing its processing dialog. Treat that burst as one human attempt.
const FAILURE_DUPLICATE_WINDOW_MS = 5 * 1000;
const failures = new Map();
/** Clear every IP-scoped recovery lock for a viewer after an admin reset. */
function clearRecoveryFailuresForViewer(viewerId) {
    const suffix = `:${String(viewerId)}`;
    let cleared = 0;
    for (const key of failures.keys()) {
        if (!key.endsWith(suffix))
            continue;
        failures.delete(key);
        cleared += 1;
    }
    return cleared;
}
exports.clearRecoveryFailuresForViewer = clearRecoveryFailuresForViewer;
function send(reply, data, viewerId = 0, resultCode = 1) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: resultCode }),
        data,
    });
}
function parseViewerId(value) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
        return String(value);
    if (typeof value !== "string")
        return null;
    const normalized = value.trim();
    return /^\d{6,15}$/.test(normalized) ? normalized : null;
}
function parseDeviceId(value) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function isValidPassword(value) {
    return typeof value === "string"
        && value.length >= 8
        && value.length <= 64
        && /^[A-Za-z0-9]+$/.test(value)
        && /[A-Z]/.test(value)
        && /[a-z]/.test(value)
        && /[0-9]/.test(value);
}
function passwordsEqual(stored, supplied) {
    const left = Buffer.from(stored, "utf8");
    const right = Buffer.from(supplied, "utf8");
    return left.length === right.length && (0, crypto_1.timingSafeEqual)(left, right);
}
function accountByViewerId(viewerId) {
    const row = (0, db_1.getDb)().prepare(`
        SELECT a.id AS account_id, s.token AS viewer_id,
               a.takeover_password, a.takeover_udid, a.admin_note
        FROM sessions AS s
        JOIN accounts AS a ON a.id = s.account_id
        WHERE s.token = ? AND s.type = ? AND a.status = 'normal'
        LIMIT 1
    `).get(viewerId, types_1.SessionType.VIEWER);
    return row !== null && row !== void 0 ? row : null;
}
function clientIp(request) {
    // Fastify resolves forwarded addresses only for configured trusted proxies.
    return request.ip;
}
function failureKey(request, viewerId) {
    return `${clientIp(request)}:${viewerId}`;
}
// Failures one address may spend across all viewer IDs in a window, so a
// single client cannot fill the per-viewer table and lock everyone out.
const ADDRESS_FAILURE_LIMIT = 30;
const addressFailures = new Map();
function addressLimited(ip, now) {
    const entry = addressFailures.get(ip);
    if (!entry)
        return false;
    if (now >= entry.resetAt) {
        addressFailures.delete(ip);
        return false;
    }
    return entry.count >= ADDRESS_FAILURE_LIMIT;
}
function sweepFailures(now) {
    if (now < nextFailureSweepAt && failures.size < FAILURE_MAP_MAX)
        return;
    for (const [entryKey, entry] of failures) {
        if (entry.resetAt <= now)
            failures.delete(entryKey);
    }
    for (const [ip, entry] of addressFailures) {
        if (entry.resetAt <= now)
            addressFailures.delete(ip);
    }
    nextFailureSweepAt = now + FAILURE_WINDOW_MS;
}
function isRateLimited(request, viewerId) {
    const now = Date.now();
    if (addressLimited(clientIp(request), now))
        return true;
    const key = failureKey(request, viewerId);
    const entry = failures.get(key);
    if (!entry)
        return false;
    if (now >= entry.resetAt) {
        failures.delete(key);
        return false;
    }
    return entry.count >= FAILURE_LIMIT;
}
function recordFailure(request, viewerId, password) {
    const key = failureKey(request, viewerId);
    const now = Date.now();
    sweepFailures(now);
    const ip = clientIp(request);
    const address = addressFailures.get(ip);
    if (!address || now >= address.resetAt) {
        if (!address && addressFailures.size >= FAILURE_MAP_MAX) {
            const oldest = addressFailures.keys().next().value;
            if (oldest !== undefined)
                addressFailures.delete(oldest);
        }
        addressFailures.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
    }
    else {
        address.count += 1;
    }
    const previous = failures.get(key);
    if (!previous || now >= previous.resetAt) {
        if (!previous && failures.size >= FAILURE_MAP_MAX) {
            // Evict the oldest entry rather than refusing new viewers.
            const oldest = failures.keys().next().value;
            if (oldest !== undefined)
                failures.delete(oldest);
        }
        failures.set(key, {
            count: 1,
            resetAt: now + FAILURE_WINDOW_MS,
            lastFailureAt: now,
            lastPassword: password,
        });
        return;
    }
    if (previous.lastPassword === password
        && now - previous.lastFailureAt < FAILURE_DUPLICATE_WINDOW_MS) {
        failures.set(key, Object.assign(Object.assign({}, previous), { lastFailureAt: now }));
        return;
    }
    failures.set(key, Object.assign(Object.assign({}, previous), { count: previous.count + 1, lastFailureAt: now, lastPassword: password }));
}
function authenticateRecovery(request, body) {
    const viewerId = parseViewerId(body.input_viewer_id);
    const password = typeof body.input_password === "string" ? body.input_password : "";
    if (!viewerId || isRateLimited(request, viewerId))
        return null;
    const account = accountByViewerId(viewerId);
    if (!(account === null || account === void 0 ? void 0 : account.takeover_password) || !passwordsEqual(account.takeover_password, password)) {
        recordFailure(request, viewerId, password);
        return null;
    }
    failures.delete(failureKey(request, viewerId));
    return { account, viewerId };
}
function buildUserData(viewerId) {
    var _a;
    const account = accountByViewerId(viewerId);
    if (!account)
        return null;
    const playerId = (0, activeAccount_1.resolvePlayerIdSync)(account.account_id);
    if (!playerId)
        return null;
    const player = (0, player_1.getPlayerSync)(playerId);
    if (!player)
        return null;
    const leader = player.leaderCharacterId > 0
        ? (0, character_1.getPlayerCharacterSync)(playerId, player.leaderCharacterId)
        : null;
    return {
        leader_character_evolution_img_level: (_a = leader === null || leader === void 0 ? void 0 : leader.evolutionLevel) !== null && _a !== void 0 ? _a : 0,
        leader_character_id: player.leaderCharacterId,
        name: player.name,
        rank: (0, stamina_1.getRankDegree)(player.rankPoint || 0),
        viewer_id: Number(viewerId),
    };
}
function currentUserData(value) {
    const viewerId = parseViewerId(value);
    return viewerId ? buildUserData(viewerId) : null;
}
function performTransfer(target, suppliedPassword, currentViewerId, deviceId, newUdid) {
    return __awaiter(this, void 0, void 0, function* () {
        return (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "account", operation: "take_over_transfer",
        }, () => {
            var _a, _b, _c;
            // Re-read both identity and password inside the write lock: preview is
            // not authorization for a later transfer after a reset/race.
            const lockedTarget = accountByViewerId(target.viewer_id);
            if (!lockedTarget
                || lockedTarget.account_id !== target.account_id
                || !lockedTarget.takeover_password
                || lockedTarget.takeover_udid !== target.takeover_udid
                || !passwordsEqual(lockedTarget.takeover_password, suppliedPassword)) {
                throw new Error("TAKEOVER_TARGET_CHANGED");
            }
            const bindingAtNewDevice = (0, db_1.getDb)().prepare(`
            SELECT account_id FROM device_bindings WHERE device_id = ?
        `).get(deviceId);
            const currentViewer = currentViewerId ? accountByViewerId(currentViewerId) : null;
            if (currentViewer && bindingAtNewDevice && currentViewer.account_id !== bindingAtNewDevice.account_id) {
                throw new Error("TAKEOVER_CURRENT_ACCOUNT_MISMATCH");
            }
            const sourceAccountId = (_b = (_a = currentViewer === null || currentViewer === void 0 ? void 0 : currentViewer.account_id) !== null && _a !== void 0 ? _a : bindingAtNewDevice === null || bindingAtNewDevice === void 0 ? void 0 : bindingAtNewDevice.account_id) !== null && _b !== void 0 ? _b : null;
            const deletesSource = sourceAccountId !== null && sourceAccountId !== target.account_id;
            const sourceViewerId = deletesSource ? (0, session_1.getViewerIdSync)(sourceAccountId) : 0;
            const sourcePlayerIds = deletesSource ? (0, account_1.getAccountPlayersSync)(sourceAccountId) : [];
            const oldBinding = (0, db_1.getDb)().prepare(`
            SELECT device_id FROM device_bindings WHERE account_id = ? LIMIT 1
        `).get(target.account_id);
            (0, db_1.getDb)().prepare(`DELETE FROM device_bindings WHERE account_id = ? OR device_id = ?`)
                .run(target.account_id, deviceId);
            if (deletesSource)
                (0, db_1.getDb)().prepare(`DELETE FROM accounts WHERE id = ?`).run(sourceAccountId);
            const now = new Date().toISOString();
            (0, db_1.getDb)().prepare(`
            INSERT INTO device_bindings (device_id, account_id, last_seen, name)
            VALUES (?, ?, ?, NULL)
        `).run(deviceId, target.account_id, now);
            (0, db_1.getDb)().prepare(`
            UPDATE accounts
            SET takeover_udid = ?, last_login_time = ?, status = 'normal'
            WHERE id = ?
        `).run(newUdid, now, target.account_id);
            (0, db_1.getDb)().prepare(`DELETE FROM sessions WHERE account_id = ? AND type <> ?`)
                .run(target.account_id, types_1.SessionType.VIEWER);
            (0, db_1.getDb)().prepare(`
            INSERT INTO account_transfer_audit (
                source_account_id, source_viewer_id, target_account_id, target_viewer_id,
                old_device_id, new_device_id, source_player_count, target_note,
                transferred_at, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(deletesSource ? sourceAccountId : null, sourceViewerId > 0 ? String(sourceViewerId) : null, target.account_id, target.viewer_id, (_c = oldBinding === null || oldBinding === void 0 ? void 0 : oldBinding.device_id) !== null && _c !== void 0 ? _c : null, deviceId, sourcePlayerIds.length, target.admin_note, now, currentViewerId ? "in_game" : "title");
            // The audit is intentionally lightweight and bounded so repeated
            // transfers cannot make the save database grow without limit.
            (0, db_1.getDb)().prepare(`
            DELETE FROM account_transfer_audit
            WHERE id <= (
                SELECT id FROM account_transfer_audit
                ORDER BY id DESC
                LIMIT 1 OFFSET 5000
            )
        `).run();
            return {
                abolishedViewerId: sourceViewerId,
                linkedViewerId: Number(target.viewer_id),
                sourceAccountId: deletesSource ? sourceAccountId : null,
                sourcePlayerIds,
            };
        });
    });
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/take_over_register/get_take_over_setting", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = ((_a = request.body) !== null && _a !== void 0 ? _a : {});
        const viewerId = parseViewerId(body.viewer_id);
        const account = viewerId ? accountByViewerId(viewerId) : null;
        if (!viewerId || !account)
            return send(reply, {}, 0, TAKEOVER_INPUT_ID_ERROR);
        return send(reply, {
            exists_user_take_over_data: Boolean(account.takeover_password),
            social_account: {
                is_apple_linked: false,
                is_facebook_linked: false,
                is_google_linked: false,
            },
        }, Number(viewerId));
    }));
    fastify.post("/take_over_register/register_take_over_data", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _b;
        const body = ((_b = request.body) !== null && _b !== void 0 ? _b : {});
        const viewerId = parseViewerId(body.viewer_id);
        const password = body.input_password;
        const udid = (0, takeover_access_1.getRequestUdid)(request);
        const account = viewerId ? accountByViewerId(viewerId) : null;
        if (!viewerId || !account || !udid)
            return send(reply, {}, 0, TAKEOVER_INPUT_ID_ERROR);
        if (!isValidPassword(password)) {
            return send(reply, {}, Number(viewerId), TAKEOVER_INPUT_ID_OR_PASSWORD_ERROR);
        }
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "account", operation: "register_takeover",
        }, () => {
            (0, db_1.getDb)().prepare(`UPDATE accounts SET takeover_password = ?, takeover_udid = ? WHERE id = ?`)
                .run(password, udid, account.account_id);
        });
        // A player who still controls the currently bound device may replace
        // a forgotten password in-game. Do not leave that new password hidden
        // behind an earlier IP/viewer recovery lock from the same connection.
        failures.delete(failureKey(request, viewerId));
        return send(reply, { registered_viewer_id: Number(viewerId) }, Number(viewerId));
    }));
    fastify.post("/take_over/get_user_data_by_take_over_data", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _c;
        const body = ((_c = request.body) !== null && _c !== void 0 ? _c : {});
        const inputViewerId = parseViewerId(body.input_viewer_id);
        if (!inputViewerId)
            return send(reply, {}, 0, TAKEOVER_INPUT_ID_ERROR);
        const authenticated = authenticateRecovery(request, body);
        if (!authenticated) {
            return send(reply, {}, Number(inputViewerId), TAKEOVER_INPUT_ID_OR_PASSWORD_ERROR);
        }
        return send(reply, {
            current_user: currentUserData(body.viewer_id),
            linked_user: buildUserData(authenticated.viewerId),
        }, Number(inputViewerId));
    }));
    fastify.post("/take_over/take_over_by_take_over_data", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _d;
        const body = ((_d = request.body) !== null && _d !== void 0 ? _d : {});
        const inputViewerId = parseViewerId(body.input_viewer_id);
        const currentViewerId = parseViewerId(body.viewer_id);
        const suppliedPassword = typeof body.input_password === "string" ? body.input_password : "";
        const deviceId = parseDeviceId(body.device_id);
        const udid = (0, takeover_access_1.getRequestUdid)(request);
        if (!inputViewerId)
            return send(reply, {}, 0, TAKEOVER_INPUT_ID_ERROR);
        const authenticated = authenticateRecovery(request, body);
        if (!authenticated || !deviceId || !udid) {
            return send(reply, {}, Number(inputViewerId), TAKEOVER_INPUT_ID_OR_PASSWORD_ERROR);
        }
        try {
            const result = yield performTransfer(authenticated.account, suppliedPassword, currentViewerId, deviceId, udid);
            if (result.sourceAccountId !== null) {
                (0, activeAccount_1.removeDeletedAccountFromState)(result.sourceAccountId, result.sourcePlayerIds);
                try {
                    yield (0, player_party_pool_1.removePlayerQuestNpcPartySnapshots)(result.sourcePlayerIds);
                }
                catch (error) {
                    request.log.warn({ error }, "temporary account deleted but NPC snapshot cleanup failed");
                }
            }
            return send(reply, {
                abolished_viewer_id: result.abolishedViewerId,
                linked_viewer_id: result.linkedViewerId,
                short_udid: 0,
            }, result.linkedViewerId);
        }
        catch (error) {
            request.log.warn({ error }, "account takeover transaction rejected");
            return send(reply, {}, Number(inputViewerId), TAKEOVER_INPUT_ID_OR_PASSWORD_ERROR);
        }
    }));
    // The platform button is always rendered by this client build. Return a
    // handled native result instead of H404; this server supports passwords only.
    fastify.post("/take_over/get_user_data_by_social_account", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () { return send(reply, {}, 0, SOCIAL_ACCOUNT_NOT_FOUND); }));
    fastify.post("/take_over/take_over_by_social_account", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () { return send(reply, {}, 0, SOCIAL_ACCOUNT_NOT_FOUND); }));
    fastify.post("/take_over_register/register_social_account", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () { return send(reply, {}, 0, SOCIAL_ACCOUNT_NOT_FOUND); }));
    fastify.post("/take_over_register/disable_social_account", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () { return send(reply, {}, 0, SOCIAL_ACCOUNT_NOT_FOUND); }));
});
exports.default = routes;
