"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertWeaponRivenSync = exports.getPlayerWeaponRivenRowSync = exports.getPlayerWeaponRivenSync = exports.getPlayerWeaponRivenListSync = exports.convertUnknownWeaponRivensSync = exports.WeaponRivenError = void 0;
const db_1 = require("../db");
const rules_1 = require("../../lib/weapon-riven/rules");
const constants_1 = require("../../lib/weapon-riven/constants");
const display_1 = require("../../lib/weapon-riven/display");
const model_1 = require("../../lib/weapon-riven/model");
Object.defineProperty(exports, "WeaponRivenError", { enumerable: true, get: function () { return model_1.WeaponRivenError; } });
const quality_1 = require("../../lib/weapon-riven/quality");
const migrate_quality_1 = require("../../lib/weapon-riven/migrate-quality");
const weapon_riven_quality_1 = require("../initializers/weapon-riven-quality");
var weapon_riven_conversion_1 = require("./weapon-riven-conversion");
Object.defineProperty(exports, "convertUnknownWeaponRivensSync", { enumerable: true, get: function () { return weapon_riven_conversion_1.convertUnknownWeaponRivensSync; } });
function view(row) {
    var _a;
    const affixes = JSON.parse(row.affixes_json);
    const pending = row.pending_json === null ? null : JSON.parse(row.pending_json);
    const refund = (0, rules_1.getWeaponRivenDismantleReward)(affixes.length, row.roll_count);
    const costs = (0, rules_1.getWeaponRivenCostOptions)(row.roll_count);
    return { riven_id: row.riven_id, weapon_id: row.weapon_id,
        affixes: (0, display_1.displayWeaponRivenAffixes)(row.weapon_id, affixes, row.affix_version), roll_count: row.roll_count,
        locked: row.locked, seen: row.seen, disposition: Math.round((0, rules_1.getWeaponRivenDisposition)(row.weapon_id)),
        dismantle_return: refund ? [[refund.itemId, refund.amount]] : [],
        revision: row.revision, next_cost: costs[0][1], cost_options: costs,
        pending: pending === null ? null : { draw_id: pending.draw_id,
            affixes: (0, display_1.displayWeaponRivenAffixes)(row.weapon_id, pending.affixes, (_a = pending.affix_version) !== null && _a !== void 0 ? _a : 1) } };
}
function getPlayerWeaponRivenListSync(playerId) {
    (0, weapon_riven_quality_1.migrateWeaponRivenQualities)((0, db_1.getDb)(), playerId);
    const rows = (0, db_1.getDb)().prepare("SELECT * FROM player_weapon_rivens WHERE player_id=? ORDER BY item_id").all(playerId);
    return Object.fromEntries(rows.map(row => [String(row.item_id), view(row)]));
}
exports.getPlayerWeaponRivenListSync = getPlayerWeaponRivenListSync;
function getPlayerWeaponRivenSync(playerId, itemId) {
    const row = getPlayerWeaponRivenRowSync(playerId, itemId);
    return row ? view(row) : null;
}
exports.getPlayerWeaponRivenSync = getPlayerWeaponRivenSync;
/** Operations must use durable quality pairs, never the response's projected levels. */
function getPlayerWeaponRivenRowSync(playerId, itemId) {
    const query = (0, db_1.getDb)().prepare("SELECT * FROM player_weapon_rivens WHERE player_id=? AND item_id=?");
    const row = query.get(playerId, itemId);
    if (row && (row.affix_version !== 3 || (row.pending_json !== null && JSON.parse(row.pending_json).affix_version !== 3))) {
        (0, weapon_riven_quality_1.migrateWeaponRivenQualities)((0, db_1.getDb)(), playerId);
        return query.get(playerId, itemId);
    }
    return row;
}
exports.getPlayerWeaponRivenRowSync = getPlayerWeaponRivenRowSync;
/** Storage primitive; reward entrances use grantWeaponRivenSync for overflow rewards and receipts. */
function insertWeaponRivenSync(playerId, weaponId, affixes, sourceKey, random = Math.random, format = 1) {
    if (format === 1 && rules_1.weaponRivenRuleSet.rules.schema_version === 3) {
        affixes = (0, migrate_quality_1.migrateWeaponRivenAffixes)(weaponId, affixes, rules_1.weaponRivenRuleSet);
        format = 3;
    }
    if (format === 3)
        (0, quality_1.validateWeaponRivenQualities)(affixes, rules_1.weaponRivenRuleSet);
    const db = (0, db_1.getDb)();
    if (!db.inTransaction)
        throw new Error("Weapon riven creation requires a transaction");
    const existing = db.prepare("SELECT item_id FROM player_weapon_rivens WHERE player_id=? AND source_key=?")
        .get(playerId, sourceKey);
    if (existing)
        return existing.item_id;
    const occupied = new Set(db.prepare("SELECT item_id FROM player_weapon_rivens WHERE player_id=?").all(playerId).map(row => row.item_id));
    if (occupied.size >= rules_1.weaponRivenRuleSet.rules.items.holding_limit)
        return null;
    const available = [];
    for (let itemId = constants_1.FIRST_RIVEN_ITEM_ID; itemId <= constants_1.LAST_RIVEN_ITEM_ID; itemId++) {
        if (!occupied.has(itemId))
            available.push(itemId);
    }
    if (available.length === 0)
        return null;
    const u = random();
    if (!Number.isFinite(u) || u < 0 || u >= 1)
        throw new RangeError("Weapon riven random source must return a value in [0, 1).");
    const itemId = available[Math.floor(u * available.length)];
    const sequence = db.prepare(`INSERT INTO player_weapon_riven_sequences(player_id,last_id)
        VALUES (?, (SELECT COALESCE(MAX(riven_id),0)+1 FROM player_weapon_rivens WHERE player_id=?))
        ON CONFLICT(player_id) DO UPDATE SET last_id=MAX(last_id,
            (SELECT COALESCE(MAX(riven_id),0) FROM player_weapon_rivens WHERE player_id=?))+1
        RETURNING last_id`).get(playerId, playerId, playerId);
    if (!Number.isSafeInteger(sequence.last_id))
        throw new Error("Weapon riven sequence exhausted");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO player_weapon_rivens(player_id,riven_id,item_id,weapon_id,affixes_json,
        source_key,created_at,updated_at,affix_version) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(playerId, sequence.last_id, itemId, weaponId, JSON.stringify(affixes), sourceKey, now, now, format);
    return itemId;
}
exports.insertWeaponRivenSync = insertWeaponRivenSync;
