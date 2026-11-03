"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateViewerIdSession = exports.generateViewerIdSessionSync = exports.deleteAccountSessionsOfType = exports.deleteAccountSessionsOfTypeSync = exports.deleteAccountSessions = exports.deleteSession = exports.deleteSessionSync = exports.insertSession = exports.insertSessionWithToken = exports.insertSessionWithTokenSync = exports.getAccountSessionsOfType = exports.getAccountSessionsOfTypeSync = exports.getSessionByAccountIdSync = exports.updateDeviceBindingNameSync = exports.getAllViewerSessionsSync = exports.getAllDeviceBindingsSync = exports.deleteDeviceBindingSync = exports.insertDeviceBindingSync = exports.getDeviceBindingSync = exports.migrateUnsafeViewerIdsSync = exports.getViewerIdSync = exports.getSession = void 0;
const db_1 = require("../db");
const cached_statement_1 = require("../../lib/cached-statement");
const crypto_1 = require("crypto");
const types_1 = require("../types");
const utils_1 = require("../../utils");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const MULTI_COM_VIEWER_ID_MIN = 900000000;
/**
 * Converts a RawSession into a Session.
 *
 * @param rawSession The RawSession to convert.
 * @returns The converted Session.
 */
function buildSession(rawSession) {
    return {
        token: rawSession.token,
        accountId: rawSession.account_id,
        expires: new Date(rawSession.expires),
        type: rawSession.type
    };
}
/**
 * Synchronously retrieves a session based on its token.
 *
 * @param token The token of the session to retrieve.
 * @returns The session that was found or null
 */
function getSessionSync(token) {
    const raw = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT token, account_id, expires, type
    FROM sessions
    WHERE token = ?
    `).get(token);
    if (raw === undefined)
        return null;
    const session = buildSession(raw);
    // viewer tokens don't expire.
    if (session.type !== types_1.SessionType.VIEWER && new Date() >= session.expires) {
        console.log(`session of type (${session.type}) expired:`, session);
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "account", operation: "expire_session",
        }, () => deleteSessionSync(session.token));
        return null;
    }
    return session;
}
/**
 * Retrieves a session based on its token.
 *
 * @param token The token of the session to retrieve.
 * @returns A promise that resolves with the session that was found or null
 */
function getSession(token) {
    return new Promise((resolve, reject) => {
        try {
            resolve(getSessionSync(token));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.getSession = getSession;
/**
 * Gets the viewer_id (session token) for an account.
 * Returns 0 if no viewer session exists.
 */
function getViewerIdSync(accountId) {
    var _a;
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT token FROM sessions WHERE account_id = ? AND type = 2 LIMIT 1
    `).get(accountId);
    const viewerId = Number((_a = row === null || row === void 0 ? void 0 : row.token) !== null && _a !== void 0 ? _a : 0);
    return Number.isSafeInteger(viewerId) && viewerId > 0 ? viewerId : 0;
}
exports.getViewerIdSync = getViewerIdSync;
/**
 * Reassigns legacy human viewer IDs that overlap the multiplayer COM range.
 * Only the VIEWER session token changes; account, player and device bindings
 * remain attached to the same account_id.
 */
function migrateUnsafeViewerIdsSync() {
    const db = (0, db_1.getDb)();
    const unsafeSessions = db.prepare(`
        SELECT token, account_id
        FROM sessions
        WHERE type = ? AND CAST(token AS INTEGER) >= ?
    `).all(types_1.SessionType.VIEWER, MULTI_COM_VIEWER_ID_MIN);
    if (unsafeSessions.length === 0)
        return 0;
    const tokenExists = db.prepare(`SELECT 1 FROM sessions WHERE token = ? LIMIT 1`);
    const updateToken = db.prepare(`
        UPDATE sessions
        SET token = ?
        WHERE token = ? AND account_id = ? AND type = ?
    `);
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "account", operation: "migrate_unsafe_viewer_ids" }, () => {
        let migrated = 0;
        for (const session of unsafeSessions) {
            let replacement = "";
            for (let attempt = 0; attempt < 10000; attempt += 1) {
                const candidate = String((0, utils_1.generateViewerId)());
                if (!tokenExists.get(candidate)) {
                    replacement = candidate;
                    break;
                }
            }
            if (!replacement) {
                throw new Error("Unable to allocate a safe viewer ID for legacy session migration");
            }
            updateToken.run(replacement, session.token, session.account_id, types_1.SessionType.VIEWER);
            migrated += 1;
        }
        return migrated;
    });
}
exports.migrateUnsafeViewerIdsSync = migrateUnsafeViewerIdsSync;
/**
 * Device binding: maps device_id → account_id
 */
function getDeviceBindingSync(deviceId) {
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `SELECT device_id, account_id, name FROM device_bindings WHERE device_id = ?`).get(deviceId);
    return row !== null && row !== void 0 ? row : null;
}
exports.getDeviceBindingSync = getDeviceBindingSync;
function insertDeviceBindingSync(deviceId, accountId, name) {
    (0, db_1.getDb)().prepare(`INSERT OR REPLACE INTO device_bindings (device_id, account_id, last_seen, name) VALUES (?, ?, ?, ?)`)
        .run(deviceId, accountId, new Date().toISOString(), name !== null && name !== void 0 ? name : null);
}
exports.insertDeviceBindingSync = insertDeviceBindingSync;
function deleteDeviceBindingSync(deviceId) {
    (0, db_1.getDb)().prepare(`DELETE FROM device_bindings WHERE device_id = ?`).run(deviceId);
}
exports.deleteDeviceBindingSync = deleteDeviceBindingSync;
/** Get all device bindings for admin panel */
function getAllDeviceBindingsSync() {
    return (0, db_1.getDb)().prepare(`SELECT device_id, account_id, name FROM device_bindings`).all();
}
exports.getAllDeviceBindingsSync = getAllDeviceBindingsSync;
/** Loads every viewer token needed by the account overview in one query. */
function getAllViewerSessionsSync() {
    const rows = (0, db_1.getDb)().prepare(`
        SELECT account_id, token
        FROM sessions
        WHERE type = ?
        ORDER BY rowid
    `).all(types_1.SessionType.VIEWER);
    return rows.map(row => ({ accountId: row.account_id, token: row.token }));
}
exports.getAllViewerSessionsSync = getAllViewerSessionsSync;
function updateDeviceBindingNameSync(deviceId, name) {
    (0, db_1.getDb)().prepare(`UPDATE device_bindings SET name = ? WHERE device_id = ?`).run(name, deviceId);
}
exports.updateDeviceBindingNameSync = updateDeviceBindingNameSync;
/**
 * Synchronously gets a session by account_id and type (for viewer_id reuse).
 */
function getSessionByAccountIdSync(accountId, type) {
    const raw = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT token, account_id, expires, type FROM sessions WHERE account_id = ? AND type = ?
    `).get(accountId, type);
    return raw ? buildSession(raw) : null;
}
exports.getSessionByAccountIdSync = getSessionByAccountIdSync;
/**
 * Synchronously returns all of the sessions of a particular type belonging to an account.
 *
 * @param accountId The ID of the account to get the sessions of.
 * @param type The type of session to get.
 * @returns An array of sessions.
 */
function getAccountSessionsOfTypeSync(accountId, type) {
    const rawResult = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT token, account_id, expires, type
    FROM sessions
    WHERE account_id = ? AND type = ?    
    `).all(accountId, type);
    return rawResult.map(raw => buildSession(raw));
}
exports.getAccountSessionsOfTypeSync = getAccountSessionsOfTypeSync;
/**
 * Returns all of the sessions of a particular type belonging to an account.
 *
 * @param accountId The ID of the account to get the sessions of.
 * @param type The type of session to get.
 * @returns A promise that resolves with an array of sessions.
 */
function getAccountSessionsOfType(accountId, type) {
    return new Promise((resolve, reject) => {
        try {
            resolve(getAccountSessionsOfTypeSync(accountId, type));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.getAccountSessionsOfType = getAccountSessionsOfType;
/**
 * Synchronously inserts a session into the database that already has a token.
 *
 * @param session The session to insert.
 */
function insertSessionWithTokenSync(session) {
    (0, db_1.getDb)().prepare(`
    INSERT INTO sessions (token, account_id, expires, type)
    VALUES (?, ?, ?, ?)    
    `).run(session.token, session.accountId, session.expires.toISOString(), session.type);
    return session;
}
exports.insertSessionWithTokenSync = insertSessionWithTokenSync;
/**
 * Synchronously inserts a session into the database that already has a token.
 *
 * @param session The session to insert.
 * @returns A promise that resolves with the session that was inserted.
 */
function insertSessionWithToken(session) {
    return new Promise((resolve, reject) => {
        try {
            resolve(insertSessionWithTokenSync(session));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.insertSessionWithToken = insertSessionWithToken;
/**
 * Synchronously inserts a session into the database.
 *
 * @param session The session to insert into the database without its token.
 * @returns The session that was inserted into the database.
 */
function insertSessionSync(session) {
    const token = (0, crypto_1.randomBytes)(54).toString('base64');
    const completeSession = session;
    completeSession.token = token;
    return insertSessionWithTokenSync(completeSession);
}
/**
 * Inserts a session into the database.
 *
 * @param session The session to insert into the database without its token.
 * @returns A promise that resolves with the session that was inserted into the database.
 */
function insertSession(session) {
    return new Promise((resolve, reject) => {
        try {
            resolve(insertSessionSync(session));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.insertSession = insertSession;
/**
 * Synchronously deletes a session from the database based on its token.
 *
 * @param token The token of the session to delete.
 */
function deleteSessionSync(token) {
    (0, db_1.getDb)().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}
exports.deleteSessionSync = deleteSessionSync;
/**
 * Deletes a session from the database based on its token.
 *
 * @param token The token of the session to delete.
 * @returns A promise that resolves when the session is deleted.
 */
function deleteSession(token) {
    return new Promise((resolve, reject) => {
        try {
            resolve(deleteSessionSync(token));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.deleteSession = deleteSession;
/**
 * Synchronously deletes all of the sessions assigned to a particular player.
 *
 * @param playerId The id of the player to delete all the sessions of.
 */
function deleteAccountSessionsSync(playerId) {
    (0, db_1.getDb)().prepare(`DELETE FROM sessions WHERE account_id = ?`).run(playerId);
}
/**
 * Deletes all of the sessions assigned to a particular player.
 *
 * @param playerId The id of the player to delete all the sessions of.
 * @returns A promise that resolves when the sessions have been deleted.
 */
function deleteAccountSessions(playerId) {
    return new Promise((resolve, reject) => {
        try {
            resolve(deleteAccountSessionsSync(playerId));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.deleteAccountSessions = deleteAccountSessions;
/**
 * Synchronously deletes all of an account's sessions of a particular type.
 *
 * @param accountId The ID of the account to delete the sessions of.
 * @param type The type of session to delete.
 */
function deleteAccountSessionsOfTypeSync(accountId, type) {
    (0, db_1.getDb)().prepare(`
    DELETE FROM sessions
    WHERE account_id = ? AND type = ?
    `).run(accountId, type);
}
exports.deleteAccountSessionsOfTypeSync = deleteAccountSessionsOfTypeSync;
/**
 * Deletes all of an account's sessions of a particular type.
 *
 * @param accountId The ID of the account to delete the sessions of.
 * @param type The type of session to delete.
 * @returns A promise that resolves when the sessions are deleted.
 */
function deleteAccountSessionsOfType(accountId, type) {
    return new Promise((resolve, reject) => {
        try {
            resolve(deleteAccountSessionsOfTypeSync(accountId, type));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.deleteAccountSessionsOfType = deleteAccountSessionsOfType;
function generateViewerIdSessionSync(accountId) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "account", operation: "generate_viewer_session" }, () => {
        // Delete any existing viewer ID sessions and insert the replacement
        // under one explicit account-owned transaction.
        deleteAccountSessionsOfTypeSync(accountId, types_1.SessionType.VIEWER);
        return insertSessionWithTokenSync({
            token: (0, utils_1.generateViewerId)().toString(),
            expires: new Date(new Date().getTime()),
            accountId,
            type: types_1.SessionType.VIEWER,
        });
    });
}
exports.generateViewerIdSessionSync = generateViewerIdSessionSync;
function generateViewerIdSession(accountId) {
    return Promise.resolve().then(() => generateViewerIdSessionSync(accountId));
}
exports.generateViewerIdSession = generateViewerIdSession;
// player
