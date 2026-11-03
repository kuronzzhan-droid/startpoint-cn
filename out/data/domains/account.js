"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAccount = exports.updateAccountSync = exports.insertAccount = exports.insertAccountSync = exports.getAccountPlayers = exports.resolveAccountPlayerIdSync = exports.getAccountPlayersSync = exports.deleteAccountSync = exports.getAllAccountsSync = exports.getAccount = exports.getAccountFromIdpIdSync = exports.getAccountSync = void 0;
const db_1 = require("../db");
const cached_statement_1 = require("../../lib/cached-statement");
// Account
/**
 * Converts a RawAccount into a Account
 *
 * @param rawAccount The RawAccount to convert.
 * @returns The converted Account
 */
function buildAccount(rawAccount) {
    return {
        id: rawAccount.id,
        appId: rawAccount.app_id,
        firstLoginTime: new Date(rawAccount.first_login_time),
        idpAlias: rawAccount.idp_alias,
        idpCode: rawAccount.idp_code,
        idpId: rawAccount.idp_id,
        regTime: new Date(rawAccount.reg_time),
        lastLoginTime: new Date(rawAccount.last_login_time),
        status: rawAccount.status,
        username: rawAccount.username,
        passwordHash: rawAccount.password_hash,
        adminNote: rawAccount.admin_note,
        takeoverPassword: rawAccount.takeover_password,
        takeoverUdid: rawAccount.takeover_udid,
    };
}
/**
 * Asynchronously gets an Account from their id.
 *
 * @param accountId The ID of the Account to get.
 * @returns The Account that was found or null.
 */
function getAccountSync(accountId) {
    const db = (0, db_1.getDb)();
    const raw = db.prepare(`
    SELECT id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status,
           username, password_hash, admin_note, takeover_password, takeover_udid
    FROM accounts
    WHERE id = ?
    `).get(accountId);
    if (raw === undefined)
        return null;
    return buildAccount(raw);
}
exports.getAccountSync = getAccountSync;
/**
 * Gets an account from their IdpId.
 *
 * @param idpId The IdpId of the account.
 * @returns An account or null.
 */
function getAccountFromIdpIdSync(idpId) {
    const db = (0, db_1.getDb)();
    const raw = db.prepare(`
    SELECT id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status,
           username, password_hash, admin_note, takeover_password, takeover_udid
    FROM accounts
    WHERE idp_id = ?
    `).get(idpId);
    if (raw === undefined)
        return null;
    return buildAccount(raw);
}
exports.getAccountFromIdpIdSync = getAccountFromIdpIdSync;
/**
 * Gets an Account from their id.
 *
 * @param accountId The ID of the Account to get.
 * @returns A promise that resolves with the Account that was found or null.
 */
function getAccount(accountId) {
    return new Promise((resolve, reject) => {
        try {
            resolve(getAccountSync(accountId));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.getAccount = getAccount;
/**
 * Gets all accounts from the database.
 */
function getAllAccountsSync() {
    const db = (0, db_1.getDb)();
    const raw = db.prepare(`
    SELECT id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status,
           username, password_hash, admin_note, takeover_password, takeover_udid
    FROM accounts
    ORDER BY id DESC
    `).all();
    return raw.map(buildAccount);
}
exports.getAllAccountsSync = getAllAccountsSync;
/**
 * Deletes an account by ID.
 */
function deleteAccountSync(accountId) {
    const db = (0, db_1.getDb)();
    db.prepare(`DELETE FROM accounts WHERE id = ?`).run(accountId);
}
exports.deleteAccountSync = deleteAccountSync;
/**
 * Synchronously gets all of the players that are bound to an account.
 *
 * @param accountId The account's id.
 * @returns A list of player ids.
 */
function getAccountPlayersSync(accountId) {
    const db = (0, db_1.getDb)();
    const raw = (0, cached_statement_1.cachedStatement)(db, `
    SELECT id
    FROM players
    WHERE account_id = ?
    ORDER BY id
    `).all(accountId);
    return raw.map(player => player.id);
}
exports.getAccountPlayersSync = getAccountPlayersSync;
/** Selects the preferred player when owned, otherwise the account's first player. */
function resolveAccountPlayerIdSync(accountId, preferredPlayerId) {
    var _a;
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT id
        FROM players
        WHERE account_id = ?
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id
        LIMIT 1
    `).get(accountId, preferredPlayerId !== null && preferredPlayerId !== void 0 ? preferredPlayerId : 0);
    return (_a = row === null || row === void 0 ? void 0 : row.id) !== null && _a !== void 0 ? _a : null;
}
exports.resolveAccountPlayerIdSync = resolveAccountPlayerIdSync;
/**
 * Gets all of the players that are bound to an account.
 *
 * @param accountId The account's id.
 * @returns A promise that resolves with a list of player ids.
 */
function getAccountPlayers(accountId) {
    return new Promise((resolve, reject) => {
        try {
            resolve(getAccountPlayersSync(accountId));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.getAccountPlayers = getAccountPlayers;
/**
 * Synchronously inserts an Account into the database.
 *
 * @param account An Account object that doesn't include its id, firstLoginTime, lastLoginTime, nor regTime.
 * @returns The Account that was inserted into the database.
 */
function insertAccountSync(account) {
    const db = (0, db_1.getDb)();
    const dateNow = new Date();
    const dateNowISO = dateNow.toISOString();
    const result = db.prepare(`
    INSERT INTO accounts (app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(account.appId, dateNowISO, account.idpAlias, account.idpCode, account.idpId, dateNowISO, dateNowISO, account.status);
    const id = result.lastInsertRowid;
    // return the complete player
    const finalAccount = account;
    finalAccount.id = Number(id);
    finalAccount.firstLoginTime = dateNow;
    finalAccount.regTime = dateNow;
    return finalAccount;
}
exports.insertAccountSync = insertAccountSync;
/**
 * Inserts an Account into the database.
 *
 * @param account An Account object that doesn't include its id, firstLoginTime, nor regTime.
 * @returns A promise that resolves with the Account that was inserted into the database.
 */
function insertAccount(account) {
    return new Promise((resolve, reject) => {
        try {
            resolve(insertAccountSync(account));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.insertAccount = insertAccount;
/**
 * Synchronously updates an Account within the database.
 *
 * @param account The values of the Account to update.
 * @returns The updated Account.
 */
function updateAccountSync(account) {
    const id = account.id;
    const db = (0, db_1.getDb)();
    const fieldMap = {
        'appId': 'app_id',
        'firstLoginTime': 'first_login_time',
        'idpAlias': 'idp_alias',
        'idpCode': 'idp_code',
        'idpId': 'idp_id',
        'regTime': 'reg_time',
        'lastLoginTime': 'last_login_time',
        'status': 'status',
        'username': 'username',
        'passwordHash': 'password_hash',
        'adminNote': 'admin_note',
        'takeoverPassword': 'takeover_password',
        'takeoverUdid': 'takeover_udid'
    };
    const sets = [];
    const values = [];
    for (const key in account) {
        const value = account[key];
        const mapped = fieldMap[key];
        if (mapped && value !== undefined) {
            sets.push(`${mapped} = ?`);
            if (value instanceof Date) {
                values.push(value.toISOString());
            }
            else {
                values.push(value);
            }
        }
    }
    if (sets.length > 0)
        db.prepare(`
        UPDATE accounts
        SET ${sets.join(', ')}
        WHERE id = ?
        `).run([...values, id]);
    return getAccountSync(id);
}
exports.updateAccountSync = updateAccountSync;
/**
 * Updates an Account within the database.
 *
 * @param account The values of the Account to update.
 * @returns A promise that resolves with the updated Account.
 */
function updateAccount(account) {
    return new Promise((resolve, reject) => {
        try {
            resolve(updateAccountSync(account));
        }
        catch (error) {
            reject(error);
        }
    });
}
exports.updateAccount = updateAccount;
