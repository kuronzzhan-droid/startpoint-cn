"use strict";
// Save validator system — runs permanent validators on /load.
// Temporal filters are applied at serialization time (see load.ts).
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyTemporalFilters = exports.runPermanentValidators = void 0;
const max_level_1 = require("./max-level");
const party_slot_1 = require("./party-slot");
const unison_unlock_1 = require("./unison-unlock");
const player_repair_1 = require("../../data/domains/player-repair");
const PERMANENT_VALIDATORS = [
    max_level_1.MaxLevelValidator,
    party_slot_1.PartySlotValidator,
    unison_unlock_1.UnisonUnlockValidator,
];
const TEMPORAL_FILTERS = [
// Add temporal filters here (e.g. ExBoostReleaseFilter, ItemReleaseFilter)
];
/** Run all permanent validators. Transaction owners can require atomic failure. */
function runPermanentValidators(playerId, context = {}, options = {}) {
    var _a;
    let totalFixes = 0;
    const appliedVersions = (0, player_repair_1.getPlayerRepairVersionsSync)(playerId);
    for (const v of PERMANENT_VALIDATORS) {
        if (((_a = appliedVersions.get(v.name)) !== null && _a !== void 0 ? _a : 0) >= v.version)
            continue;
        try {
            totalFixes += v.validate(playerId, context);
            (0, player_repair_1.setPlayerRepairVersionSync)(playerId, v.name, v.version);
        }
        catch (e) {
            // The caller owns the transaction and must discard its local
            // snapshots on failure. Do not commit repairs or version markers
            // from earlier validators when an atomic load fails later.
            if (options.throwOnError)
                throw e;
            console.error(`[VALIDATE:${v.name}] error:`, e);
        }
    }
    if (totalFixes > 0) {
        console.log(`[VALIDATE] player=${playerId}: ${totalFixes} total permanent fixes`);
    }
    return totalFixes;
}
exports.runPermanentValidators = runPermanentValidators;
/** Apply all temporal filters to serialized output. */
function applyTemporalFilters(output) {
    for (const f of TEMPORAL_FILTERS) {
        try {
            output = f.apply(output);
        }
        catch (e) {
            console.error(`[VALIDATE:${f.name}] filter error:`, e);
        }
    }
    return output;
}
exports.applyTemporalFilters = applyTemporalFilters;
