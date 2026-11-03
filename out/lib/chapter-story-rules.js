"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chapterJoinedCharacters = exports.chapterIsUnlocked = exports.countClearedStoryChapters = exports.chapterIsCleared = exports.chapterIsFullyOpen = exports.chapterQuestIds = exports.parseStoryChapter = exports.SkipMainStoryError = void 0;
const chapter_story_client_data_json_1 = __importDefault(require("./chapter-story-client-data.json"));
const quests = chapter_story_client_data_json_1.default.quests;
const stages = chapter_story_client_data_json_1.default.stages;
class SkipMainStoryError extends Error {
    constructor(statusCode, code, message) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}
exports.SkipMainStoryError = SkipMainStoryError;
function parseStoryChapter(category, chapter) {
    if ((category !== 1 && category !== 4) || !Number.isInteger(chapter) || Number(chapter) < 1 || Number(chapter) > 12) {
        throw new SkipMainStoryError(400, "INVALID_CHAPTER", "难度必须为 1（普通）或 4（高难），章节必须为 1 至 12 的整数");
    }
    return { category, chapter: Number(chapter) };
}
exports.parseStoryChapter = parseStoryChapter;
function chapterQuestIds(category, chapter) {
    return quests[category].filter(([id]) => Math.floor(id / 1000000) === chapter).map(([id]) => id);
}
exports.chapterQuestIds = chapterQuestIds;
/** An atomic chapter skip must not grant any quest outside its release window. */
function chapterIsFullyOpen(category, chapter, now) {
    const selected = quests[category].filter(([id]) => Math.floor(id / 1000000) === chapter);
    const time = now.getTime();
    return selected.length > 0 && selected.every(([, start, end]) => time >= start && (end === null || time <= end));
}
exports.chapterIsFullyOpen = chapterIsFullyOpen;
function chapterIsCleared(progress, category, chapter) {
    const ids = chapterQuestIds(category, chapter);
    return ids.length > 0 && ids.every(id => { var _a; return Boolean((_a = progress.get(`${category}:${id}`)) === null || _a === void 0 ? void 0 : _a.finished); });
}
exports.chapterIsCleared = chapterIsCleared;
function countClearedStoryChapters(progress) {
    let count = 0;
    for (const category of [1, 4])
        for (let chapter = 1; chapter <= 12; chapter++) {
            if (chapterIsCleared(progress, category, chapter))
                count++;
        }
    return count;
}
exports.countClearedStoryChapters = countClearedStoryChapters;
/** Client SingleChapterBase -> StageNodeBase -> CommonQuestBase viewability.
 * Data comes from the original client tables, including UTC+08 release times.
 * A node requires ALL its prerequisite node's quests, not merely its last boss.
 */
function chapterIsUnlocked(progress, category, chapter, now) {
    const cleared = (section, id) => { var _a; return Boolean((_a = progress.get(`${section}:${id}`)) === null || _a === void 0 ? void 0 : _a.finished); };
    const nodeCleared = (section, ref) => {
        if (ref.length === 0)
            return true;
        const ids = quests[section].filter(([id]) => Math.floor(id / 1000) === ref[0] * 1000 + ref[1]);
        return ids.length > 0 && ids.every(([id]) => cleared(section, id));
    };
    return stages[category].filter(([id]) => id === chapter).some(([, node, required, requiredMain]) => {
        if (!nodeCleared(category, required) || !nodeCleared(1, requiredMain))
            return false;
        return quests[category].some(([id, start, end, gates]) => Math.floor(id / 1000) === chapter * 1000 + node && now.getTime() >= start &&
            (end === null || now.getTime() <= end) && gates.every(([section, questId]) => cleared(section, questId)));
    });
}
exports.chapterIsUnlocked = chapterIsUnlocked;
/** Only quest-join characters in the selected normal chapter are eligible. */
function chapterJoinedCharacters(category, chapter) {
    return category !== 1 ? [] : chapter_story_client_data_json_1.default.joins.filter(([, questId, type]) => (type === "quest" || type === "town") && Math.floor(Number(questId) / 1000000) === chapter).map(([id]) => Number(id));
}
exports.chapterJoinedCharacters = chapterJoinedCharacters;
