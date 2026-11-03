"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bulkEditFollow = exports.bulkEditFollowSync = exports.deleteFollower = exports.deleteFollowerSync = exports.deleteFollow = exports.deleteFollowSync = exports.addFollow = exports.addFollowSync = exports.getFollowerCountSync = exports.getFollowingCountSync = exports.getFollowRelationSync = exports.getRelatedPlayerIdsSync = exports.getViewerIdByPlayerIdSync = exports.getPlayerIdByViewerIdSync = exports.MAX_FOLLOWERS = exports.MAX_FOLLOWING = void 0;
const db_1 = require("../db");
const activeAccount_1 = require("../activeAccount");
const utils_1 = require("../../utils");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
exports.MAX_FOLLOWING = 50;
exports.MAX_FOLLOWERS = 50;
function getPlayerIdByViewerIdSync(viewerId) {
    if (!Number.isSafeInteger(viewerId) || viewerId <= 0)
        return null;
    const row = (0, db_1.getDb)().prepare(`
        SELECT account_id
        FROM sessions
        WHERE token = ? AND type = 2
        LIMIT 1
    `).get(String(viewerId));
    return row ? (0, activeAccount_1.resolvePlayerIdSync)(row.account_id) : null;
}
exports.getPlayerIdByViewerIdSync = getPlayerIdByViewerIdSync;
function getViewerIdByPlayerIdSync(playerId) {
    if (!Number.isSafeInteger(playerId) || playerId <= 0)
        return null;
    const row = (0, db_1.getDb)().prepare(`
        SELECT s.token, p.account_id
        FROM players p
        INNER JOIN sessions s ON s.account_id = p.account_id AND s.type = 2
        WHERE p.id = ?
        LIMIT 1
    `).get(playerId);
    if (!row)
        return null;
    const viewerId = Number(row.token);
    // Viewer IDs address the account's selected archive. An inactive archive
    // must not publish that ID and then open/follow a different saved player.
    return Number.isSafeInteger(viewerId) && viewerId > 0
        && (0, activeAccount_1.resolvePlayerIdSync)(row.account_id) === playerId ? viewerId : null;
}
exports.getViewerIdByPlayerIdSync = getViewerIdByPlayerIdSync;
function getRelatedPlayerIdsSync(playerId) {
    const rows = (0, db_1.getDb)().prepare(`
        SELECT CASE
            WHEN follower_player_id = @player_id THEN followed_player_id
            ELSE follower_player_id
        END AS related_player_id
        FROM players_follows
        WHERE follower_player_id = @player_id OR followed_player_id = @player_id
        GROUP BY related_player_id
    `).all({ player_id: playerId });
    return rows.map(row => row.related_player_id);
}
exports.getRelatedPlayerIdsSync = getRelatedPlayerIdsSync;
function getFollowRelationSync(playerId, targetPlayerId) {
    const rows = (0, db_1.getDb)().prepare(`
        SELECT follower_player_id, followed_player_id, created_at
        FROM players_follows
        WHERE (follower_player_id = ? AND followed_player_id = ?)
           OR (follower_player_id = ? AND followed_player_id = ?)
    `).all(playerId, targetPlayerId, targetPlayerId, playerId);
    let followTime = null;
    let followedTime = null;
    for (const row of rows) {
        if (row.follower_player_id === playerId)
            followTime = row.created_at;
        if (row.follower_player_id === targetPlayerId)
            followedTime = row.created_at;
    }
    const state = followTime !== null
        ? (followedTime !== null ? 1 : 2)
        : (followedTime !== null ? 3 : 0);
    return { state, followTime, followedTime };
}
exports.getFollowRelationSync = getFollowRelationSync;
function getFollowingCountSync(playerId) {
    const row = (0, db_1.getDb)().prepare(`
        SELECT COUNT(*) AS count FROM players_follows WHERE follower_player_id = ?
    `).get(playerId);
    return row.count;
}
exports.getFollowingCountSync = getFollowingCountSync;
function getFollowerCountSync(playerId) {
    const row = (0, db_1.getDb)().prepare(`
        SELECT COUNT(*) AS count FROM players_follows WHERE followed_player_id = ?
    `).get(playerId);
    return row.count;
}
exports.getFollowerCountSync = getFollowerCountSync;
function addFollowInTransaction(playerId, targetPlayerId) {
    if (playerId === targetPlayerId)
        return "self";
    const target = (0, db_1.getDb)().prepare(`SELECT id FROM players WHERE id = ?`).get(targetPlayerId);
    if (!target)
        return "target_not_found";
    const existing = (0, db_1.getDb)().prepare(`
        SELECT 1 FROM players_follows
        WHERE follower_player_id = ? AND followed_player_id = ?
    `).get(playerId, targetPlayerId);
    if (existing)
        return "exists";
    if (getFollowingCountSync(playerId) >= exports.MAX_FOLLOWING)
        return "following_limit";
    if (getFollowerCountSync(targetPlayerId) >= exports.MAX_FOLLOWERS)
        return "follower_limit";
    (0, db_1.getDb)().prepare(`
        INSERT INTO players_follows (follower_player_id, followed_player_id, created_at)
        VALUES (?, ?, ?)
    `).run(playerId, targetPlayerId, (0, utils_1.getServerTime)());
    return "added";
}
function addFollowSync(playerId, targetPlayerId) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "add_follow" }, () => (addFollowInTransaction(playerId, targetPlayerId)));
}
exports.addFollowSync = addFollowSync;
function addFollow(playerId, targetPlayerId) {
    return (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "player", playerId, operation: "add_follow" }, () => (addFollowInTransaction(playerId, targetPlayerId)));
}
exports.addFollow = addFollow;
function deleteFollowInTransaction(playerId, targetPlayerId) {
    (0, db_1.getDb)().prepare(`
        DELETE FROM players_follows
        WHERE follower_player_id = ? AND followed_player_id = ?
    `).run(playerId, targetPlayerId);
}
function deleteFollowSync(playerId, targetPlayerId) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "delete_follow" }, () => (deleteFollowInTransaction(playerId, targetPlayerId)));
}
exports.deleteFollowSync = deleteFollowSync;
function deleteFollow(playerId, targetPlayerId) {
    return (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "player", playerId, operation: "delete_follow" }, () => (deleteFollowInTransaction(playerId, targetPlayerId)));
}
exports.deleteFollow = deleteFollow;
function deleteFollowerInTransaction(playerId, followerPlayerId) {
    (0, db_1.getDb)().prepare(`
        DELETE FROM players_follows
        WHERE follower_player_id = ? AND followed_player_id = ?
    `).run(followerPlayerId, playerId);
}
function deleteFollowerSync(playerId, followerPlayerId) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "delete_follower" }, () => (deleteFollowerInTransaction(playerId, followerPlayerId)));
}
exports.deleteFollowerSync = deleteFollowerSync;
function deleteFollower(playerId, followerPlayerId) {
    return (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "player", playerId, operation: "delete_follower" }, () => (deleteFollowerInTransaction(playerId, followerPlayerId)));
}
exports.deleteFollower = deleteFollower;
function bulkEditFollowInTransaction(playerId, addTargetPlayerIds, deleteTargetPlayerIds) {
    const fullFollowerTargets = new Set();
    for (const targetPlayerId of new Set(deleteTargetPlayerIds)) {
        deleteFollowInTransaction(playerId, targetPlayerId);
    }
    for (const targetPlayerId of new Set(addTargetPlayerIds)) {
        const result = addFollowInTransaction(playerId, targetPlayerId);
        if (result === "follower_limit")
            fullFollowerTargets.add(targetPlayerId);
        if (result === "following_limit")
            break;
    }
    return [...fullFollowerTargets];
}
function bulkEditFollowSync(playerId, addTargetPlayerIds, deleteTargetPlayerIds) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "bulk_edit_follow" }, () => (bulkEditFollowInTransaction(playerId, addTargetPlayerIds, deleteTargetPlayerIds)));
}
exports.bulkEditFollowSync = bulkEditFollowSync;
function bulkEditFollow(playerId, addTargetPlayerIds, deleteTargetPlayerIds) {
    return (0, persistence_coordinator_1.runPersistenceTransaction)({ domain: "player", playerId, operation: "bulk_edit_follow" }, () => (bulkEditFollowInTransaction(playerId, addTargetPlayerIds, deleteTargetPlayerIds)));
}
exports.bulkEditFollow = bulkEditFollow;
