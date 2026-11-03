"use strict";
// Character → quest mapping helpers
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCharacterStoryQuestIds = exports.getCharacterIdFromMission = void 0;
const character_quest_lookup_json_1 = __importDefault(require("../../../assets/character_quest_lookup.json"));
// The master table is immutable for this server process. Preserve its prefix
// matching and row order, but index it once instead of scanning it for every
// awakening condition (including repeated final-mission dependencies).
const storyQuestIdsByPrefix = new Map();
for (const [key, rows] of Object.entries(character_quest_lookup_json_1.default)) {
    if (rows.length === 0)
        continue;
    for (let length = 0; length <= key.length; length += 1) {
        const prefix = key.substring(0, length);
        const ids = (_a = storyQuestIdsByPrefix.get(prefix)) !== null && _a !== void 0 ? _a : [];
        ids.push(parseInt(key));
        storyQuestIdsByPrefix.set(prefix, ids);
    }
}
function getCharacterIdFromMission(missionId) {
    const s = String(missionId);
    return s.length > 1 ? s.substring(0, s.length - 1) : s;
}
exports.getCharacterIdFromMission = getCharacterIdFromMission;
function getCharacterStoryQuestIds(characterId) {
    var _a;
    const cid = String(characterId);
    const lookupId = cid === '1' ? '10' : cid;
    // Callers receive their own array, as with the original scan.
    return [...((_a = storyQuestIdsByPrefix.get(lookupId)) !== null && _a !== void 0 ? _a : [])];
}
exports.getCharacterStoryQuestIds = getCharacterStoryQuestIds;
