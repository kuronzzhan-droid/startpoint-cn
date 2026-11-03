"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveFiveBossSoloReceiptSync = exports.isActiveFiveBossSoloSync = exports.getFiveBossSoloReceiptSync = exports.abortFiveBossSoloSync = exports.abandonFiveBossSoloForMultiSync = exports.getFiveBossSoloRewardMultiplierSync = exports.markFiveBossSoloAutoUsedSync = exports.startFiveBossSolo = exports.startFiveBossSoloSync = void 0;
const db_1 = require("../../data/db");
const player_1 = require("../../data/domains/player");
const quest_active_1 = require("../../data/domains/quest_active");
const option_1 = require("../../data/domains/option");
const fiveBossGauntletRun_1 = require("../../data/domains/fiveBossGauntletRun");
const stamina_1 = require("../../lib/stamina");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const contract_1 = require("./contract");
const battle_1 = require("../../lib/weapon-riven/battle");
const settlement_response_1 = require("../../lib/weapon-riven/settlement-response");
function startFiveBossSoloInTransaction(playerId, playId, persist, partyId) {
    var _a;
    if (typeof playId !== "string" || !playId.length || playId.length > 255)
        throw new Error("Invalid play id.");
    const db = (0, db_1.getDb)();
    const active = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
    if ((active === null || active === void 0 ? void 0 : active.isMulti) && (0, contract_1.isFiveBossGauntletQuest)(active.category, active.questId)) {
        throw new Error("Finish or abort the multiplayer run before starting solo.");
    }
    const old = db.prepare("SELECT status FROM five_boss_solo_runs WHERE player_id = ? AND play_id = ?")
        .get(playerId, playId);
    if (old) {
        if (old.status !== "active" || (active === null || active === void 0 ? void 0 : active.playId) !== playId)
            throw new Error("This play id has ended.");
        return null;
    }
    const player = (0, player_1.getPlayerSync)(playerId);
    if (!player)
        throw new Error("Player does not exist.");
    // The legacy helper rounds now to seconds. Subsecond heal timestamps
    // must not make its negative fraction consume an extra stamina point.
    const stamina = Math.max(player.stamina, (0, stamina_1.computeRealTimeStamina)(player));
    const staminaCost = contract_1.FIVE_BOSS_GAUNTLET.staminaCost;
    if (stamina < staminaCost)
        throw new Error("Insufficient stamina.");
    const debit = db.prepare(`UPDATE players_items SET amount = amount - 1
        WHERE player_id = ? AND id = ? AND amount >= 1`).run(playerId, contract_1.FIVE_BOSS_GAUNTLET.ticketItemId);
    if (debit.changes !== 1)
        throw new fiveBossGauntletRun_1.FiveBossGauntletRunError("insufficient_ticket", "Not enough entry tickets.");
    (0, player_1.updatePlayerSync)({ id: playerId, stamina: stamina - staminaCost, staminaHealTime: new Date(),
        totalStaminaUsed: ((_a = player.totalStaminaUsed) !== null && _a !== void 0 ? _a : 0) + staminaCost });
    db.prepare("UPDATE five_boss_solo_runs SET status = 'aborted' WHERE player_id = ? AND status = 'active'").run(playerId);
    const autoAtStart = (0, option_1.getPlayerOptionSync)(playerId, "auto_play", true);
    const loadout = (0, battle_1.getSoloWeaponRivenStartLoadoutSync)(playerId, partyId);
    db.prepare(`INSERT INTO five_boss_solo_runs(player_id, play_id, status, auto_at_start, auto_used, riven_loadout_json)
        VALUES (?, ?, 'active', ?, ?, ?)`).run(playerId, playId, autoAtStart ? 1 : 0, autoAtStart ? 1 : 0, JSON.stringify(loadout));
    return persist();
}
function startFiveBossSoloSync(playerId, playId, persist, partyId) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "single-quest", playerId, operation: "five_boss_solo_start",
    }, () => startFiveBossSoloInTransaction(playerId, playId, persist, partyId));
}
exports.startFiveBossSoloSync = startFiveBossSoloSync;
/** Async HTTP entry point; keeps the single-player start off the request's synchronous transaction path. */
function startFiveBossSolo(playerId, playId, persist, partyId) {
    return (0, persistence_coordinator_1.runPersistenceTransaction)({
        domain: "single-quest", playerId, operation: "five_boss_solo_start",
    }, () => startFiveBossSoloInTransaction(playerId, playId, persist, partyId));
}
exports.startFiveBossSolo = startFiveBossSolo;
/** Monotone marker, bound to the persistent current solo play, never a retry snapshot. */
function markFiveBossSoloAutoUsedSync(playerId) {
    (0, db_1.getDb)().prepare(`UPDATE five_boss_solo_runs SET auto_used = 1
        WHERE player_id = ? AND play_id = (
            SELECT play_id FROM players_active_quests
            WHERE player_id = ? AND is_multi = 0 AND category = ? AND quest_id = ?
        ) AND status = 'active' AND auto_used = 0`)
        .run(playerId, playerId, contract_1.FIVE_BOSS_GAUNTLET.category, contract_1.FIVE_BOSS_GAUNTLET.visibleQuestId);
}
exports.markFiveBossSoloAutoUsedSync = markFiveBossSoloAutoUsedSync;
function getFiveBossSoloRewardMultiplierSync(playerId, playId) {
    const row = (0, db_1.getDb)().prepare(`SELECT auto_at_start, auto_used FROM five_boss_solo_runs
        WHERE player_id = ? AND play_id = ? AND status = 'active'`)
        .get(playerId, playId);
    return (row === null || row === void 0 ? void 0 : row.auto_at_start) === 0 && row.auto_used === 0 ? 2 : 1;
}
exports.getFiveBossSoloRewardMultiplierSync = getFiveBossSoloRewardMultiplierSync;
/** An explicit new multiplayer start abandons the old solo run without inventing a room. */
function abandonFiveBossSoloForMultiSync(playerId, playId) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "multi-settlement", playerId, operation: "abandon_five_boss_solo_for_multi",
    }, () => {
        const active = (0, quest_active_1.getPlayerActiveQuestSync)(playerId);
        if (!active || active.isMulti || active.playId !== playId
            || !(0, contract_1.isFiveBossGauntletQuest)(active.category, active.questId))
            return false;
        abortFiveBossSoloSync(playerId, playId);
        (0, db_1.getDb)().prepare("DELETE FROM players_active_quests WHERE player_id = ? AND play_id = ? AND is_multi = 0")
            .run(playerId, playId);
        return true;
    });
}
exports.abandonFiveBossSoloForMultiSync = abandonFiveBossSoloForMultiSync;
/** Called in the single-abort transaction before its active quest is cleared. */
function abortFiveBossSoloSync(playerId, playId) {
    (0, db_1.getDb)().prepare(`UPDATE five_boss_solo_runs SET status = 'aborted'
        WHERE player_id = ? AND play_id = ? AND status = 'active'`).run(playerId, playId);
}
exports.abortFiveBossSoloSync = abortFiveBossSoloSync;
function getFiveBossSoloReceiptSync(playerId, requestKey) {
    if (!requestKey)
        return undefined;
    const row = (0, db_1.getDb)().prepare(`SELECT response_json FROM five_boss_solo_runs
        WHERE player_id = ? AND finish_request_key = ? AND status = 'settled'`)
        .get(playerId, requestKey);
    return row ? (0, settlement_response_1.refreshWeaponRivenSettlementResponseSync)(playerId, JSON.parse(row.response_json)) : undefined;
}
exports.getFiveBossSoloReceiptSync = getFiveBossSoloReceiptSync;
function isActiveFiveBossSoloSync(playerId, playId) {
    return !!(0, db_1.getDb)().prepare(`SELECT 1 FROM five_boss_solo_runs
        WHERE player_id = ? AND play_id = ? AND status = 'active'`).get(playerId, playId);
}
exports.isActiveFiveBossSoloSync = isActiveFiveBossSoloSync;
/** Called inside the ordinary single-finish transaction with all rewards. */
function saveFiveBossSoloReceiptSync(playerId, playId, requestKey, response) {
    if (!requestKey)
        throw new Error("Missing five-boss finish request identity.");
    const result = (0, db_1.getDb)().prepare(`UPDATE five_boss_solo_runs
        SET status = 'settled', finish_request_key = ?, response_json = ?
        WHERE player_id = ? AND play_id = ? AND status = 'active'`)
        .run(requestKey, JSON.stringify(response), playerId, playId);
    if (result.changes !== 1)
        throw new Error("Five-boss solo run is no longer active.");
}
exports.saveFiveBossSoloReceiptSync = saveFiveBossSoloReceiptSync;
