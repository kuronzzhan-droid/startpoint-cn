"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRushEventFolderMaxRounds = exports.rushEventFolderMaxRounds = void 0;
const assets_1 = require("./assets");
const abyss_modes_1 = require("./abyss-modes");
const mode15_optional_1 = require("./mode15-optional");
const types_1 = require("./types");
/**
 * Rush folder round counts.
 *
 * This helper used to live in the rush-event route module. The single battle
 * finish settlement now executes inside the SQLite writer thread, and a domain
 * module must not import a route module just to resolve folder rounds.
 */
exports.rushEventFolderMaxRounds = {
    [types_1.RushEventFolder.INTERMEDIATE]: 2,
    [types_1.RushEventFolder.ADVANCED]: 2,
    [types_1.RushEventFolder.GODLY]: 2,
};
function getRushEventFolderMaxRounds(eventId, folderId) {
    var _a, _b;
    // Deep Abyss is a data-driven 30-floor tower.  The legacy fallback map
    // only knows the three official two-round folders, so keep its finite
    // folder open for the configured roguelike run.
    if ((0, abyss_modes_1.isAbyssEvent)(eventId) && folderId === types_1.RushEventFolder.INTERMEDIATE) {
        const configured = Number((_a = (0, assets_1.getRogueEventConfig)(eventId)) === null || _a === void 0 ? void 0 : _a.rounds);
        return Number.isInteger(configured) && configured > 0 ? configured : 30;
    }
    if ((0, mode15_optional_1.isMode15RuntimeLoaded)()
        && eventId === mode15_optional_1.MODE15_RUSH_EVENT_ID
        && folderId === types_1.RushEventFolder.INTERMEDIATE) {
        // Mode15 exposes all fifteen rounds in the Rush folder.  The three
        // boss rows are placeholders completed by AdventEvent settlement.
        // Keep one sentinel round beyond stage 15 so native Rush completion
        // never closes the folder before stage-15 settlement resets the run.
        return 16;
    }
    const configuredMaxRound = (0, assets_1.getRushEventFolderMaxRoundSync)(eventId, folderId);
    if (configuredMaxRound > 0)
        return configuredMaxRound;
    // Retain the legacy defaults only for old/custom rows that have no quest
    // master data. Official event folders are resolved from their actual rows.
    return (_b = exports.rushEventFolderMaxRounds[folderId]) !== null && _b !== void 0 ? _b : 0;
}
exports.getRushEventFolderMaxRounds = getRushEventFolderMaxRounds;
