"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAttentionEstablisherRank = void 0;
const stamina_1 = require("./stamina");
function resolveAttentionEstablisherRank(rankPoint) {
    // The client declares this field as PlayerRank, so it expects the
    // player's actual rank degree (up to 250), not a quest-rank ID.
    return (0, stamina_1.getRankDegree)(rankPoint);
}
exports.resolveAttentionEstablisherRank = resolveAttentionEstablisherRank;
