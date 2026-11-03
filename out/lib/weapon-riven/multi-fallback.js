"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disabledRivenSnapshot = exports.rivenFreezeUnavailable = void 0;
const node_crypto_1 = require("node:crypto");
const multi_protocol_1 = require("./multi-protocol");
const room_preview_1 = require("./room-preview");
const public_payload_1 = require("./public-payload");
/** Only a definite unavailable freeze may fall back; authorization and unknown outcomes may not. */
function rivenFreezeUnavailable(error) {
    var _a, _b;
    const failure = error;
    return new Set(["REALTIME_BUSINESS_CHANNEL_UNAVAILABLE",
        "BUSINESS_PENDING_BUDGET", "UNKNOWN_REALTIME_BUSINESS_KIND", "UNKNOWN_RIVEN_BUSINESS_KIND"])
        .has((_b = (_a = failure === null || failure === void 0 ? void 0 : failure.code) !== null && _a !== void 0 ? _a : failure === null || failure === void 0 ? void 0 : failure.message) !== null && _b !== void 0 ? _b : "");
}
exports.rivenFreezeUnavailable = rivenFreezeUnavailable;
/** Owner-local, disabled wire DTO only. Never claims parent persistence or derives conversion rights. */
function disabledRivenSnapshot(input, ackConnectionIds) {
    const snapshotId = (0, node_crypto_1.randomUUID)();
    const members = input.members.map(member => {
        const mate = (0, multi_protocol_1.cloneRivenJson)(member.mate.comId
            ? (0, public_payload_1.stripWeaponRivenPublicPayload)(member.mate) : (0, room_preview_1.stripWeaponRivenRoomPreview)(member.mate));
        if (!member.mate.comId)
            mate.party = Object.assign(Object.assign({}, mate.party), { weapon_rivens: [[1], [1], [1]], weapon_riven_scope: multi_protocol_1.RIVEN_MULTI_SCOPE, weapon_riven_snapshot_id: snapshotId, weapon_riven_mode: 0, weapon_riven_catalog: "none", weapon_riven_reason: "rpc_unavailable" });
        return mate;
    });
    const canonical = (0, multi_protocol_1.canonicalRivenMembers)(members);
    return { identity: (0, multi_protocol_1.cloneRivenJson)(input.identity), snapshotId, members, canonical,
        sha256: (0, node_crypto_1.createHash)("sha256").update(canonical, "ascii").digest("hex"), mode: 0,
        catalog: "none", reason: "rpc_unavailable", rulesDigest: "none", ackConnectionIds,
        conversionLoadouts: [], audit: [] };
}
exports.disabledRivenSnapshot = disabledRivenSnapshot;
