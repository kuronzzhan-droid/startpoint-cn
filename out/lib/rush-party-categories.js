"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partyCategoryForRushEvent = exports.FANTASY_RUSH_EVENT_ID = void 0;
const types_1 = require("../data/types");
exports.FANTASY_RUSH_EVENT_ID = 700098;
/**
 * Resolve the persisted party category used by a Rush event.
 *
 * Legacy clients omit event_id and continue to use PartyCategory.RUSH.  New
 * clients send the event id and get a dedicated category for each activity.
 */
function partyCategoryForRushEvent(eventId) {
    switch (Number(eventId)) {
        case 700099:
            return types_1.PartyCategory.ABYSS_NORMAL;
        case 700100:
            return types_1.PartyCategory.ABYSS_EX;
        case exports.FANTASY_RUSH_EVENT_ID:
            return types_1.PartyCategory.FANTASY;
        default:
            return types_1.PartyCategory.RUSH;
    }
}
exports.partyCategoryForRushEvent = partyCategoryForRushEvent;
