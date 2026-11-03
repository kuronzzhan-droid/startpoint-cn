"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertPlayerMultiSpecialExchangeCampaignsSync = exports.updatePlayerMultiSpecialExchangeCampaignSync = exports.getPlayerMultiSpecialExchangeCampaignsSync = exports.insertPlayerStartDashExchangeCampaignsSync = exports.getPlayerStartDashExchangeCampaignsSync = exports.insertPlayerPeriodicRewardPointsListSync = exports.getPlayerPeriodicRewardPointsSync = void 0;
const db_1 = require("../db");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const cached_statement_1 = require("../../lib/cached-statement");
// ─── Periodic Reward Points ───
/**
 * Gets all of a player's periodic reward points.
 *
 * @param playerId The ID of the player.
 * @returns A list of the player's periodic reward points
 */
function getPlayerPeriodicRewardPointsSync(playerId) {
    const db = (0, db_1.getDb)();
    return (0, cached_statement_1.cachedStatement)(db, `
    SELECT id, point
    FROM players_periodic_reward_points
    WHERE player_id = ?
    `).all(playerId);
}
exports.getPlayerPeriodicRewardPointsSync = getPlayerPeriodicRewardPointsSync;
function insertPlayerPeriodicRewardPointsSync(playerId, periodicReward) {
    const db = (0, db_1.getDb)();
    db.prepare(`
    INSERT INTO players_periodic_reward_points (id, point, player_id)
    VALUES (?, ?, ?)
    `).run(periodicReward.id, periodicReward.point, playerId);
}
function insertPlayerPeriodicRewardPointsListSync(playerId, periodicRewards) {
    const db = (0, db_1.getDb)();
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "insert_periodic_reward_points" }, () => {
        for (const periodicReward of periodicRewards) {
            insertPlayerPeriodicRewardPointsSync(playerId, periodicReward);
        }
    });
}
exports.insertPlayerPeriodicRewardPointsListSync = insertPlayerPeriodicRewardPointsListSync;
// ─── Start Dash Exchange Campaign ───
/**
 * Gets the progress of a player's start dash exchange campaigns.
 *
 * @param playerId The player's ID.
 * @returns The status of the player's start dash exchange campaigns.
 */
function getPlayerStartDashExchangeCampaignsSync(playerId) {
    const db = (0, db_1.getDb)();
    const rawCampaigns = (0, cached_statement_1.cachedStatement)(db, `
    SELECT campaign_id, gacha_id, term_index, status, period_start_time, period_end_time
    FROM players_start_dash_exchange_campaigns
    WHERE player_id = ?
    `).all(playerId);
    return rawCampaigns.map(raw => ({
        campaignId: raw.campaign_id,
        gachaId: raw.gacha_id,
        termIndex: raw.term_index,
        status: raw.status,
        periodStartTime: new Date(raw.period_start_time),
        periodEndTime: new Date(raw.period_end_time)
    }));
}
exports.getPlayerStartDashExchangeCampaignsSync = getPlayerStartDashExchangeCampaignsSync;
function insertPlayerStartDashExchangeCampaignSync(playerId, campaign) {
    const db = (0, db_1.getDb)();
    db.prepare(`
    INSERT INTO players_start_dash_exchange_campaigns (campaign_id, gacha_id, term_index, status, period_start_time, period_end_time, player_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(campaign.campaignId, campaign.gachaId, campaign.termIndex, campaign.status, campaign.periodStartTime.toISOString(), campaign.periodEndTime.toISOString(), playerId);
}
function insertPlayerStartDashExchangeCampaignsSync(playerId, campaigns) {
    const db = (0, db_1.getDb)();
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "insert_start_dash_campaigns" }, () => {
        for (const campaign of campaigns) {
            insertPlayerStartDashExchangeCampaignSync(playerId, campaign);
        }
    });
}
exports.insertPlayerStartDashExchangeCampaignsSync = insertPlayerStartDashExchangeCampaignsSync;
// ─── Multi Special Exchange Campaign ───
/**
 * Gets the progress of a player's multi special exchange campaigns.
 *
 * @param playerId The player's ID.
 * @returns The status of the player's multi special exchange campaigns.
 */
function getPlayerMultiSpecialExchangeCampaignsSync(playerId) {
    const db = (0, db_1.getDb)();
    const rawCampaigns = (0, cached_statement_1.cachedStatement)(db, `
    SELECT campaign_id, status, ticket_item_id
    FROM players_multi_special_exchange_campaigns
    WHERE player_id = ?
    `).all(playerId);
    return rawCampaigns.map(raw => ({
        campaignId: raw.campaign_id,
        status: raw.status,
        ticketItemId: raw.ticket_item_id,
    }));
}
exports.getPlayerMultiSpecialExchangeCampaignsSync = getPlayerMultiSpecialExchangeCampaignsSync;
function insertPlayerMultiSpecialExchangeCampaignSync(playerId, campaign) {
    var _a;
    const db = (0, db_1.getDb)();
    db.prepare(`
    INSERT INTO players_multi_special_exchange_campaigns (campaign_id, status, ticket_item_id, player_id)
    VALUES (?, ?, ?, ?)
    `).run(campaign.campaignId, campaign.status, (_a = campaign.ticketItemId) !== null && _a !== void 0 ? _a : null, playerId);
}
function updatePlayerMultiSpecialExchangeCampaignSync(playerId, campaign) {
    var _a;
    (0, db_1.getDb)().prepare(`
        INSERT INTO players_multi_special_exchange_campaigns
            (campaign_id, status, ticket_item_id, player_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(campaign_id, player_id) DO UPDATE SET
            status = excluded.status,
            ticket_item_id = excluded.ticket_item_id
    `).run(campaign.campaignId, campaign.status, (_a = campaign.ticketItemId) !== null && _a !== void 0 ? _a : null, playerId);
}
exports.updatePlayerMultiSpecialExchangeCampaignSync = updatePlayerMultiSpecialExchangeCampaignSync;
function insertPlayerMultiSpecialExchangeCampaignsSync(playerId, campaigns) {
    const db = (0, db_1.getDb)();
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "insert_multi_special_exchange_campaigns" }, () => {
        for (const campaign of campaigns) {
            insertPlayerMultiSpecialExchangeCampaignSync(playerId, campaign);
        }
    });
}
exports.insertPlayerMultiSpecialExchangeCampaignsSync = insertPlayerMultiSpecialExchangeCampaignsSync;
