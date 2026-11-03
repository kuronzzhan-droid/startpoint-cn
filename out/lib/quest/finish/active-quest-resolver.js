"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveActiveQuest = exports.resolveRebuildCategory = exports.isStrictFinishMode = void 0;
const assets_1 = require("../../assets");
const quest_active_1 = require("../../../data/domains/quest_active");
const types_1 = require("../../types");
const db_1 = require("../../../data/db");
const battle_clock_compatibility_1 = require("../../battle-clock-compatibility");
// Rush/raid clients can report a client-side category number that differs from
// the server category. Try the reported category first, then the safe fallbacks.
const REBUILD_FALLBACK_CATEGORIES = [
    types_1.QuestCategory.RUSH_EVENT,
    types_1.QuestCategory.RAID_EVENT,
];
/** Set QUEST_FINISH_STRICT=1 to disable request-body rebuilding. */
function isStrictFinishMode() {
    var _a;
    const raw = ((_a = process.env.QUEST_FINISH_STRICT) !== null && _a !== void 0 ? _a : "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
}
exports.isStrictFinishMode = isStrictFinishMode;
function isBattleQuest(quest) {
    return quest !== null && "rankPointReward" in quest;
}
function resolveRebuildCategory(clientCategory, questId, findQuest) {
    const tried = new Set();
    for (const category of [clientCategory, ...REBUILD_FALLBACK_CATEGORIES]) {
        if (tried.has(category))
            continue;
        tried.add(category);
        const questData = findQuest(category, questId);
        if (isBattleQuest(questData))
            return { category, questData };
    }
    return null;
}
exports.resolveRebuildCategory = resolveRebuildCategory;
function fromPersisted(row) {
    var _a, _b, _c, _d, _e, _f;
    return {
        questId: row.questId,
        category: row.category,
        useBossBoostPoint: row.useBossBoostPoint,
        useBoostPoint: row.useBoostPoint,
        isAutoStartMode: row.isAutoStartMode,
        isMulti: row.isMulti,
        isMultiHost: row.isMultiHost,
        roomNumber: (_a = row.roomNumber) !== null && _a !== void 0 ? _a : undefined,
        entryItemId: (_b = row.entryItemId) !== null && _b !== void 0 ? _b : undefined,
        eventId: (_c = row.eventId) !== null && _c !== void 0 ? _c : undefined,
        partySlot: (_d = row.partySlot) !== null && _d !== void 0 ? _d : undefined,
        playId: row.playId,
        continueCount: row.continueCount,
        startedAtMs: (_e = row.startedAtMs) !== null && _e !== void 0 ? _e : undefined,
        questTimeRevision: (_f = row.questTimeRevision) !== null && _f !== void 0 ? _f : null,
        clockVersion: row.clockVersion,
    };
}
function rebuildFromHint(hint, findQuest) {
    var _a, _b;
    const resolved = resolveRebuildCategory(hint.category, hint.quest_id, findQuest);
    if (resolved === null)
        return null;
    return {
        questId: hint.quest_id,
        category: resolved.category,
        // A rebuilt entry did not reserve boost points or entry items at start.
        useBossBoostPoint: false,
        useBoostPoint: false,
        isAutoStartMode: false,
        isMulti: false,
        eventId: resolved.questData.eventId,
        playId: (_a = hint.play_id) !== null && _a !== void 0 ? _a : "",
        continueCount: (_b = hint.continue_count) !== null && _b !== void 0 ? _b : 0,
    };
}
/**
 * Resolve from memory, then the persisted row, then (unless strict mode is
 * enabled) rebuild a minimal active quest from the request body.
 */
function resolveActiveQuest(options) {
    var _a, _b, _c, _d;
    const { playerId, hint, memory } = options;
    const readPersisted = (_a = options.readPersisted) !== null && _a !== void 0 ? _a : quest_active_1.getPlayerActiveQuestSync;
    const findQuest = (_b = options.findQuest) !== null && _b !== void 0 ? _b : ((category, questId) => (0, assets_1.getQuestFromCategorySync)(category, questId));
    const allowRebuild = (_c = options.allowRebuild) !== null && _c !== void 0 ? _c : !isStrictFinishMode();
    if (!options.readPersisted) {
        if (hint.play_id && (0, battle_clock_compatibility_1.isClockAbortedPlaySync)((0, db_1.getDb)(), playerId, hint.play_id))
            return null;
    }
    const persisted = readPersisted(playerId);
    const cached = memory[playerId];
    if (cached !== undefined) {
        if ((persisted === null || persisted === void 0 ? void 0 : persisted.playId) === cached.playId && (0, battle_clock_compatibility_1.isSupportedBattleClockVersion)(persisted.clockVersion)) {
            // Keep party/room metadata in memory, but use the committed clock.
            cached.startedAtMs = (_d = persisted.startedAtMs) !== null && _d !== void 0 ? _d : undefined;
            cached.clockVersion = persisted.clockVersion;
            return { quest: cached, source: "memory" };
        }
        if (cached.clockVersion === battle_clock_compatibility_1.BATTLE_CLOCK_VERSION)
            return { quest: cached, source: "memory" };
        delete memory[playerId];
    }
    const usePersisted = (row) => {
        const quest = fromPersisted(row);
        memory[playerId] = quest;
        return { quest, source: "database" };
    };
    if (persisted !== null) {
        if (!(0, battle_clock_compatibility_1.isSupportedBattleClockVersion)(persisted.clockVersion))
            return null;
        if (persisted.questId === hint.quest_id || !allowRebuild)
            return usePersisted(persisted);
        const rebuilt = rebuildFromHint(hint, findQuest);
        if (rebuilt === null)
            return usePersisted(persisted);
        console.warn(`[QUEST-RESOLVE] player ${playerId} persisted quest ${persisted.questId} != requested ${hint.quest_id}, rebuilding from request`);
        return { quest: rebuilt, source: "rebuilt" };
    }
    if (!allowRebuild)
        return null;
    const rebuilt = rebuildFromHint(hint, findQuest);
    return rebuilt === null ? null : { quest: rebuilt, source: "rebuilt" };
}
exports.resolveActiveQuest = resolveActiveQuest;
