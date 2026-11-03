"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertUnknownWeaponRivensSync = void 0;
const db_1 = require("../db");
const item_1 = require("./item");
const weapon_riven_grant_1 = require("./weapon-riven-grant");
const player_operation_receipt_1 = require("./player-operation-receipt");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const rules_1 = require("../../lib/weapon-riven/rules");
const constants_1 = require("../../lib/weapon-riven/constants");
const weapon_riven_party_1 = require("./weapon-riven-party");
const settlement_response_1 = require("../../lib/weapon-riven/settlement-response");
function convertUnknownWeaponRivensSync(playerId, loadout, sourceKey, random = Math.random) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "weapon_riven_convert" }, () => {
        var _a, _b, _c, _d;
        const prior = (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, "weapon_riven_convert", sourceKey);
        if (prior)
            return (0, settlement_response_1.refreshWeaponRivenSettlementDataSync)(playerId, Object.assign(Object.assign({}, prior.response), { party_info_list: (_a = prior.response.party_info_list) !== null && _a !== void 0 ? _a : [] }));
        const result = { weapon_riven_list: {}, weapon_riven_deleted: [], weapon_riven_granted: [],
            weapon_riven_auto_dismantled: [], item_list: {}, party_info_list: [] };
        const db = (0, db_1.getDb)();
        const owned = db.prepare("SELECT id FROM players_equipment WHERE player_id=? ORDER BY id").all(playerId)
            .map(row => row.id).filter(id => (0, rules_1.isWeaponRivenRevealCandidate)(id));
        const slots = ((_b = loadout.abilitySoulIds) !== null && _b !== void 0 ? _b : []).slice(0, 3);
        const convertedSlots = [], consumedIds = [];
        for (let slot = 0; slot < slots.length; slot++) {
            const cardId = slots[slot];
            if (!(0, constants_1.isUnknownWeaponRivenItemId)(cardId) || ((_c = (0, item_1.getPlayerItemSync)(playerId, cardId)) !== null && _c !== void 0 ? _c : 0) < 1)
                continue;
            // Themed cards reveal from their pool: owned pool weapons first, otherwise the whole pool.
            const theme = cardId === constants_1.UNKNOWN_RIVEN_ITEM_ID ? undefined : (0, rules_1.getWeaponRivenTheme)(cardId);
            let candidates = owned;
            if (theme) {
                const pool = (0, rules_1.getWeaponRivenThemePool)(theme);
                const ownedPool = pool.filter(id => owned.includes(id));
                candidates = ownedPool.length > 0 ? ownedPool : theme.fallback === "pool" ? pool : [];
            }
            if (candidates.length === 0)
                continue;
            const u = random();
            if (!Number.isFinite(u) || u < 0 || u >= 1)
                throw new Error("Random source must return [0,1)");
            const weaponId = candidates[Math.floor(u * candidates.length)];
            const affixes = (0, rules_1.rollWeaponRivenQualities)(weaponId, random);
            const granted = (0, weapon_riven_grant_1.grantWeaponRivenSync)(playerId, weaponId, affixes, `${sourceKey}:slot:${slot}`, random, 3);
            const debit = db.prepare("UPDATE players_items SET amount=amount-1 WHERE player_id=? AND id=? AND amount>=1").run(playerId, cardId);
            if (debit.changes !== 1)
                throw new Error("Unknown riven balance changed inside settlement");
            convertedSlots.push(slot);
            consumedIds.push(cardId);
            Object.assign(result.weapon_riven_list, granted.weapon_riven_list);
            result.weapon_riven_granted.push(...granted.weapon_riven_granted);
            result.weapon_riven_auto_dismantled.push(...granted.weapon_riven_auto_dismantled);
            Object.assign(result.item_list, granted.item_list);
            result.item_list[cardId] = (_d = (0, item_1.getPlayerItemSync)(playerId, cardId)) !== null && _d !== void 0 ? _d : 0;
        }
        if (convertedSlots.length > 0) {
            // Plain-unknown-only battles keep the historical numeric call shape.
            const remaining = consumedIds.every(id => id === constants_1.UNKNOWN_RIVEN_ITEM_ID)
                ? result.item_list[constants_1.UNKNOWN_RIVEN_ITEM_ID]
                : Object.fromEntries([...new Set(consumedIds)].map(id => [id, result.item_list[id]]));
            result.party_info_list = (0, weapon_riven_party_1.getWeaponRivenPartyInfoListSync)(playerId, (0, weapon_riven_party_1.cleanupConvertedUnknownWeaponRivenPartiesSync)(playerId, remaining, loadout.partyId, convertedSlots, consumedIds));
        }
        (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({ playerId, operation: "weapon_riven_convert", requestKey: sourceKey, response: result });
        return result;
    });
}
exports.convertUnknownWeaponRivensSync = convertUnknownWeaponRivensSync;
