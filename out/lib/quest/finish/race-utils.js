"use strict";
// Character race lookup — loaded from the server-bundled CDN master at startup.
// CDN character.json: row[4] = comma-separated race names (e.g., "Human,Beast")
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRaceKeyString = exports.getRaceKey = exports.getCharacterRaces = void 0;
const content_master_1 = require("../../content-master");
const charRaceMap = {};
function init() {
    for (const [charId, rows] of Object.entries(content_master_1.cdnCharacters)) {
        if (!Array.isArray(rows))
            continue;
        const r = rows[0];
        if (!r || !Array.isArray(r))
            continue;
        const raceStr = String(r[4] || "");
        const races = raceStr ? raceStr.split(",").map((s) => s.trim()).filter((s) => s !== "") : [];
        if (races.length > 0)
            charRaceMap[charId] = races;
    }
}
init();
/** Returns the races for a character by ID (numeric or string) */
function getCharacterRaces(charId) {
    return charRaceMap[String(charId)] || [];
}
exports.getCharacterRaces = getCharacterRaces;
/** Build a sorted unique race key (e.g., "Dragon+Human") */
function getRaceKey(races) {
    return [...new Set(races.filter((r) => r !== ""))].sort();
}
exports.getRaceKey = getRaceKey;
/** Build a race key string from races */
function getRaceKeyString(races) {
    return getRaceKey(races).join("+");
}
exports.getRaceKeyString = getRaceKeyString;
