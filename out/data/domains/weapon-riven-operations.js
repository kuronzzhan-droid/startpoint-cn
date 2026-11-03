"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markWeaponRivensSeenSync = exports.lockWeaponRivenSync = exports.dismantleWeaponRivensBatchSync = exports.dismantleWeaponRivenSync = exports.selectWeaponRivenSync = exports.drawWeaponRivenSync = void 0;
const crypto_1 = require("crypto");
const db_1 = require("../db");
const item_1 = require("./item");
const weaponRiven_1 = require("./weaponRiven");
const player_operation_receipt_1 = require("./player-operation-receipt");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const rules_1 = require("../../lib/weapon-riven/rules");
const model_1 = require("../../lib/weapon-riven/model");
function inBattle(playerId) {
    return !!(0, db_1.getDb)().prepare("SELECT 1 FROM players_active_quests WHERE player_id=?").get(playerId);
}
function changes(playerId, itemId) {
    const riven = (0, weaponRiven_1.getPlayerWeaponRivenSync)(playerId, itemId);
    return { weapon_riven_list: riven ? { [itemId]: riven } : {}, weapon_riven_deleted: riven ? [] : [itemId],
        item_list: { [itemId]: riven ? 1 : 0 } };
}
function conflict(playerId, itemId, reason) {
    return Object.assign(Object.assign({}, changes(playerId, itemId)), { weapon_riven_conflict: true, reason });
}
/** Refresh every supported balance even when a retry changes its requested payment item. */
function drawChanges(playerId, itemId, reason) {
    var _a;
    const result = reason ? conflict(playerId, itemId, reason) : changes(playerId, itemId);
    for (const { item_id } of rules_1.weaponRivenRuleSet.rules.reroll.cost_items) {
        result.item_list[item_id] = (_a = (0, item_1.getPlayerItemSync)(playerId, item_id)) !== null && _a !== void 0 ? _a : 0;
    }
    return result;
}
function drawWeaponRivenSync(playerId, itemId, rivenId, revision, random, requestKey, costItemId, mode = "full") {
    if (mode !== "full" && mode !== "values")
        throw new model_1.WeaponRivenError("invalid_argument", "Invalid weapon riven draw mode");
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "weapon_riven_draw" }, () => {
        const riven = (0, weaponRiven_1.getPlayerWeaponRivenSync)(playerId, itemId);
        // Validate the permanent identity before receipts: item slots are reused.
        if (!riven || riven.riven_id !== rivenId)
            return drawChanges(playerId, itemId, "riven_changed");
        const prior = requestKey ? (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, "weapon_riven_draw", requestKey) : null;
        if (prior)
            return drawChanges(playerId, itemId);
        // A retried draw recovers the durable choice without another debit.
        if (!riven.pending) {
            if (inBattle(playerId))
                return drawChanges(playerId, itemId, "battle_in_progress");
            if (riven.revision !== revision)
                return drawChanges(playerId, itemId, "riven_changed");
            // Only an absent field selects the default; all other values must match a configured ID exactly.
            const cost = costItemId === undefined ? riven.cost_options[0]
                : riven.cost_options.find(([id]) => id === costItemId);
            if (!cost)
                return drawChanges(playerId, itemId, "cost");
            const [currencyId, amount] = cost;
            const debit = (0, db_1.getDb)().prepare(`UPDATE players_items SET amount=amount-?
                WHERE player_id=? AND id=? AND amount>=?`).run(amount, playerId, currencyId, amount);
            if (debit.changes !== 1)
                return drawChanges(playerId, itemId, "cost");
            const affixes = mode === "values"
                ? (0, rules_1.rerollWeaponRivenQualities)(JSON.parse((0, weaponRiven_1.getPlayerWeaponRivenRowSync)(playerId, itemId).affixes_json), random)
                : (0, rules_1.rollWeaponRivenQualities)(riven.weapon_id, random);
            (0, db_1.getDb)().prepare(`UPDATE player_weapon_rivens SET roll_count=roll_count+1,revision=revision+1,
                pending_json=?,updated_at=? WHERE player_id=? AND item_id=?`)
                .run(JSON.stringify({ draw_id: (0, crypto_1.randomUUID)(), affixes, affix_version: 3 }), new Date().toISOString(), playerId, itemId);
        }
        if (requestKey)
            (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({ playerId, operation: "weapon_riven_draw", requestKey,
                response: { itemId, rivenId: riven.riven_id } });
        return drawChanges(playerId, itemId);
    });
}
exports.drawWeaponRivenSync = drawWeaponRivenSync;
function selectWeaponRivenSync(playerId, itemId, rivenId, drawId, confirm) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "weapon_riven_select" }, () => {
        var _a, _b, _c;
        const current = (0, weaponRiven_1.getPlayerWeaponRivenSync)(playerId, itemId);
        if (!current || current.riven_id !== rivenId)
            return conflict(playerId, itemId, "riven_changed");
        const prior = (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, "weapon_riven_select", drawId);
        if (prior) {
            if (prior.response.itemId !== itemId)
                throw new model_1.WeaponRivenError("draw_mismatch", "Draw belongs to another item");
            // A portable snapshot can bring back the pending draw after its
            // server-local receipt was committed. Replay the original decision
            // to consume it, while never touching a later draw or reused slot.
            if (((_a = current === null || current === void 0 ? void 0 : current.pending) === null || _a === void 0 ? void 0 : _a.draw_id) !== drawId || current.riven_id !== prior.response.rivenId)
                return changes(playerId, itemId);
            confirm = prior.response.isConfirm;
        }
        const riven = current;
        if (((_b = riven.pending) === null || _b === void 0 ? void 0 : _b.draw_id) !== drawId)
            throw new model_1.WeaponRivenError("draw_mismatch", "No matching pending draw", 409);
        if (inBattle(playerId))
            return conflict(playerId, itemId, "battle_in_progress");
        const row = (0, weaponRiven_1.getPlayerWeaponRivenRowSync)(playerId, itemId);
        const pending = JSON.parse(row.pending_json);
        (0, db_1.getDb)().prepare(`UPDATE player_weapon_rivens SET affixes_json=?,affix_version=?,pending_json=NULL,
            revision=revision+1,updated_at=? WHERE player_id=? AND item_id=?`)
            .run(confirm ? JSON.stringify(pending.affixes) : row.affixes_json, confirm ? (_c = pending.affix_version) !== null && _c !== void 0 ? _c : 1 : row.affix_version, new Date().toISOString(), playerId, itemId);
        if (!prior)
            (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({ playerId, operation: "weapon_riven_select", requestKey: drawId,
                response: { itemId, rivenId: riven.riven_id, isConfirm: confirm } });
        return changes(playerId, itemId);
    });
}
exports.selectWeaponRivenSync = selectWeaponRivenSync;
function dismantleChanges(playerId, itemId, previousItems = {}) {
    var _a;
    const current = changes(playerId, itemId);
    const rewardItemId = rules_1.weaponRivenRuleSet.rules.dismantle_return.item_id;
    const ids = new Set(Object.keys(previousItems));
    if (rewardItemId !== null)
        ids.add(String(rewardItemId));
    for (const id of ids) {
        if (Number(id) !== itemId)
            current.item_list[id] = (_a = (0, item_1.getPlayerItemSync)(playerId, id)) !== null && _a !== void 0 ? _a : 0;
    }
    return current;
}
/** Delete one card and every saved reference to it; equipped cards may be dismantled. */
function removeWeaponRivenSync(playerId, itemId) {
    const db = (0, db_1.getDb)();
    const changed = db.prepare(`SELECT category,group_id,slot FROM players_parties
        WHERE player_id=? AND (ability_soul_1=? OR ability_soul_2=? OR ability_soul_3=?)`)
        .all(playerId, itemId, itemId, itemId);
    db.prepare(`UPDATE players_parties SET
        ability_soul_1=CASE WHEN ability_soul_1=? THEN NULL ELSE ability_soul_1 END,
        ability_soul_2=CASE WHEN ability_soul_2=? THEN NULL ELSE ability_soul_2 END,
        ability_soul_3=CASE WHEN ability_soul_3=? THEN NULL ELSE ability_soul_3 END
        WHERE player_id=? AND (ability_soul_1=? OR ability_soul_2=? OR ability_soul_3=?)`)
        .run(itemId, itemId, itemId, playerId, itemId, itemId, itemId);
    // Saved battle teams can be offered again by history/recommendation UI.
    for (const table of ["players_rush_events_played_parties", "players_practice_battle_history"]) {
        for (let slot = 1; slot <= 3; slot++) {
            db.prepare(`UPDATE ${table} SET ability_soul_id_${slot}=NULL WHERE player_id=? AND ability_soul_id_${slot}=?`).run(playerId, itemId);
        }
    }
    db.prepare("DELETE FROM player_weapon_rivens WHERE player_id=? AND item_id=?").run(playerId, itemId);
    return changed;
}
function dismantleWeaponRivenSync(playerId, itemId, rivenId, requestKey) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "weapon_riven_dismantle" }, () => {
        var _a, _b;
        const riven = (0, weaponRiven_1.getPlayerWeaponRivenSync)(playerId, itemId);
        // Deleted/reused identities still conflict, but always refresh the material balance.
        if (!riven || riven.riven_id !== rivenId)
            return Object.assign(Object.assign({}, dismantleChanges(playerId, itemId)), { weapon_riven_conflict: true, reason: "riven_changed", changed_parties: [] });
        if (riven.locked)
            return Object.assign(Object.assign({}, dismantleChanges(playerId, itemId)), { weapon_riven_conflict: true, reason: "locked", changed_parties: [] });
        const prior = (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, "weapon_riven_dismantle", requestKey);
        if (prior) {
            // Old zero-refund receipts and restored card snapshots must never grant retroactively.
            return Object.assign(Object.assign({}, dismantleChanges(playerId, itemId, prior.response.item_list)), { changed_parties: (_a = prior.response.changed_parties) !== null && _a !== void 0 ? _a : [] });
        }
        if (inBattle(playerId))
            return Object.assign(Object.assign({}, dismantleChanges(playerId, itemId)), { weapon_riven_conflict: true, reason: "battle_in_progress", changed_parties: [] });
        const refund = (0, rules_1.getWeaponRivenDismantleReward)(riven.affixes.length, riven.roll_count);
        if (refund && !Number.isSafeInteger(((_b = (0, item_1.getPlayerItemSync)(playerId, refund.itemId)) !== null && _b !== void 0 ? _b : 0) + refund.amount)) {
            throw new RangeError("Weapon riven dismantle inventory amount exceeds the safe integer range.");
        }
        const changed = removeWeaponRivenSync(playerId, itemId);
        const result = Object.assign(Object.assign({}, dismantleChanges(playerId, itemId)), { changed_parties: changed });
        if (refund && refund.amount > 0)
            result.item_list[refund.itemId] = (0, item_1.givePlayerItemSync)(playerId, refund.itemId, refund.amount);
        (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({ playerId, operation: "weapon_riven_dismantle", requestKey, response: result });
        return result;
    });
}
exports.dismantleWeaponRivenSync = dismantleWeaponRivenSync;
/**
 * Batch dismantle (author 2026-10-27 15:34): all-or-nothing. Every item is checked like a single dismantle
 * (owned revealed card, matching revision and optional riven_id, not locked, no pending draw, no battle);
 * any failure returns HTTP 200 with weapon_riven_conflict and changes nothing.
 */
function dismantleWeaponRivensBatchSync(playerId, items, requestKey) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "weapon_riven_dismantle_batch" }, () => {
        var _a, _b, _c, _d, _e;
        const ids = items.map(item => item.item_id);
        if (ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length) {
            throw new model_1.WeaponRivenError("invalid_argument", "Batch must name 1-20 distinct weapon rivens");
        }
        const rewardItemId = rules_1.weaponRivenRuleSet.rules.dismantle_return.item_id;
        const snapshot = (deleted = []) => {
            var _a;
            const result = { weapon_riven_list: {}, weapon_riven_deleted: [], item_list: {} };
            for (const id of new Set([...ids, ...deleted])) {
                const change = changes(playerId, id);
                Object.assign(result.weapon_riven_list, change.weapon_riven_list);
                Object.assign(result.item_list, change.item_list);
                result.weapon_riven_deleted.push(...change.weapon_riven_deleted);
            }
            if (rewardItemId !== null)
                result.item_list[rewardItemId] = (_a = (0, item_1.getPlayerItemSync)(playerId, rewardItemId)) !== null && _a !== void 0 ? _a : 0;
            return result;
        };
        const reject = (reason, failed) => (Object.assign(Object.assign({}, snapshot()), { weapon_riven_conflict: true, reason, weapon_riven_conflict_items: failed, changed_parties: [], dismantle_return_total: [] }));
        const prior = (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, "weapon_riven_dismantle_batch", requestKey);
        if (prior) {
            // A genuine retry finds every card already gone. A card present again (restored save, or a
            // reused slot) was not dismantled by that receipt: never report its old success.
            const present = ids.filter(id => (0, weaponRiven_1.getPlayerWeaponRivenSync)(playerId, id) !== null);
            if (present.length)
                return reject("riven_changed", present);
            return Object.assign(Object.assign({}, snapshot(prior.response.weapon_riven_deleted)), { changed_parties: (_a = prior.response.changed_parties) !== null && _a !== void 0 ? _a : [], dismantle_return_total: (_b = prior.response.dismantle_return_total) !== null && _b !== void 0 ? _b : [] });
        }
        if (inBattle(playerId))
            return reject("battle_in_progress", ids);
        const cards = items.map(item => ({ item, riven: (0, weaponRiven_1.getPlayerWeaponRivenSync)(playerId, item.item_id) }));
        const failed = (test) => cards.filter(test).map(card => card.item.item_id);
        for (const [reason, test] of [
            ["riven_changed", (card) => !card.riven || card.riven.revision !== card.item.revision
                    || (card.item.riven_id !== undefined && card.riven.riven_id !== card.item.riven_id)],
            ["locked", (card) => !!card.riven.locked],
            ["pending", (card) => card.riven.pending !== null],
        ]) {
            const bad = failed(test);
            if (bad.length)
                return reject(reason, bad);
        }
        let amount = 0;
        for (const { riven } of cards)
            amount += (_d = (_c = (0, rules_1.getWeaponRivenDismantleReward)(riven.affixes.length, riven.roll_count)) === null || _c === void 0 ? void 0 : _c.amount) !== null && _d !== void 0 ? _d : 0;
        if (rewardItemId !== null && !Number.isSafeInteger(((_e = (0, item_1.getPlayerItemSync)(playerId, rewardItemId)) !== null && _e !== void 0 ? _e : 0) + amount)) {
            throw new RangeError("Weapon riven dismantle inventory amount exceeds the safe integer range.");
        }
        const parties = [];
        for (const id of ids)
            for (const party of removeWeaponRivenSync(playerId, id)) {
                if (!parties.some(other => other.category === party.category && other.group_id === party.group_id
                    && other.slot === party.slot))
                    parties.push(party);
            }
        if (rewardItemId !== null && amount > 0)
            (0, item_1.givePlayerItemSync)(playerId, rewardItemId, amount);
        const result = Object.assign(Object.assign({}, snapshot()), { changed_parties: parties, dismantle_return_total: rewardItemId !== null && amount > 0 ? [[rewardItemId, amount]] : [] });
        (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({ playerId, operation: "weapon_riven_dismantle_batch", requestKey, response: result });
        return result;
    });
}
exports.dismantleWeaponRivensBatchSync = dismantleWeaponRivensBatchSync;
/** State-setting operations are idempotent without storing a request receipt. */
function lockWeaponRivenSync(playerId, itemId, rivenId, locked) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "weapon_riven_lock" }, () => {
        const riven = (0, weaponRiven_1.getPlayerWeaponRivenSync)(playerId, itemId);
        if (!riven || riven.riven_id !== rivenId)
            return conflict(playerId, itemId, "riven_changed");
        if (riven.locked === locked)
            return changes(playerId, itemId);
        if (inBattle(playerId))
            return conflict(playerId, itemId, "battle_in_progress");
        (0, db_1.getDb)().prepare(`UPDATE player_weapon_rivens SET locked=?,revision=revision+1,updated_at=?
            WHERE player_id=? AND item_id=?`).run(locked, new Date().toISOString(), playerId, itemId);
        return changes(playerId, itemId);
    });
}
exports.lockWeaponRivenSync = lockWeaponRivenSync;
function markWeaponRivensSeenSync(playerId, itemIds) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "weapon_riven_seen" }, () => {
        const ids = [...new Set(itemIds)];
        const collect = () => {
            const result = { weapon_riven_list: {}, weapon_riven_deleted: [], item_list: {} };
            for (const id of ids) {
                const change = changes(playerId, id);
                Object.assign(result.weapon_riven_list, change.weapon_riven_list);
                Object.assign(result.item_list, change.item_list);
                result.weapon_riven_deleted.push(...change.weapon_riven_deleted);
            }
            return result;
        };
        const before = collect();
        const unseen = Object.entries(before.weapon_riven_list).filter(([, riven]) => riven.seen === 0);
        if (!unseen.length)
            return before;
        if (inBattle(playerId))
            return Object.assign(Object.assign({}, before), { weapon_riven_conflict: true, reason: "battle_in_progress" });
        const update = (0, db_1.getDb)().prepare(`UPDATE player_weapon_rivens SET seen=1,revision=revision+1,updated_at=?
            WHERE player_id=? AND item_id=? AND seen=0`);
        const now = new Date().toISOString();
        for (const [id] of unseen)
            update.run(now, playerId, Number(id));
        return collect();
    });
}
exports.markWeaponRivensSeenSync = markWeaponRivensSeenSync;
