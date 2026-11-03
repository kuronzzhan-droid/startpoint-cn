"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStaleAbyssBattle = exports.isStaleAbyssClient = exports.getAbyssTimeRevisionAtVersion = exports.getAbyssTimeRevision = exports.resolveAbyssTimeRevision = exports.isAbyssFiniteQuest = exports.ABYSS_LAST_QUEST_ID = exports.ABYSS_FIRST_QUEST_ID = exports.ABYSS_TIME_REVISION_KEY = void 0;
const version_1 = require("./version");
const abyss_modes_1 = require("./abyss-modes");
exports.ABYSS_TIME_REVISION_KEY = "rush:700099";
exports.ABYSS_FIRST_QUEST_ID = 700099001;
exports.ABYSS_LAST_QUEST_ID = 700099098;
function isAbyssFiniteQuest(category, questId) {
    const eventId = (0, abyss_modes_1.abyssEventFromQuest)(category, questId);
    const round = Number(questId) % 1000;
    return eventId !== null && round >= 1 && round <= (eventId === abyss_modes_1.ABYSS_EX_EVENT_ID ? 30 : 98);
}
exports.isAbyssFiniteQuest = isAbyssFiniteQuest;
/** Only a published tower revision changes records; CDN versions alone do not. */
function resolveAbyssTimeRevision(patches, eventId = abyss_modes_1.ABYSS_NORMAL_EVENT_ID) {
    var _a;
    if (!(0, abyss_modes_1.isAbyssEvent)(eventId))
        return null;
    let winningVersion = null;
    let revision = null;
    for (const patch of patches) {
        if (!patch.enabled || patch.type !== "patch")
            continue;
        const candidate = (_a = patch.quest_time_revisions) === null || _a === void 0 ? void 0 : _a[`rush:${eventId}`];
        if (candidate === undefined)
            continue;
        if (!/^[a-f0-9]{64}$/.test(candidate)) {
            throw new Error(`Invalid Deep Abyss time revision in patch ${patch.id}`);
        }
        const order = winningVersion === null ? 1 : (0, version_1.compareVersion)(patch.version, winningVersion);
        if (order === 0 && revision !== candidate) {
            throw new Error(`Conflicting Deep Abyss time revisions at ${patch.version}`);
        }
        if (order > 0) {
            winningVersion = patch.version;
            revision = candidate;
        }
    }
    return revision;
}
exports.resolveAbyssTimeRevision = resolveAbyssTimeRevision;
function getAbyssTimeRevision(eventId = abyss_modes_1.ABYSS_NORMAL_EVENT_ID) {
    return resolveAbyssTimeRevision((0, version_1.getPatchManifest)().patches, eventId);
}
exports.getAbyssTimeRevision = getAbyssTimeRevision;
/** Rebuilt starts are accepted only when the client reports the current tower. */
function getAbyssTimeRevisionAtVersion(resourceVersion, eventId = abyss_modes_1.ABYSS_NORMAL_EVENT_ID) {
    if (typeof resourceVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(resourceVersion))
        return null;
    return resolveAbyssTimeRevision((0, version_1.getPatchManifest)().patches.filter(patch => (0, version_1.compareVersion)(patch.version, resourceVersion) <= 0), eventId);
}
exports.getAbyssTimeRevisionAtVersion = getAbyssTimeRevisionAtVersion;
function isStaleAbyssClient(category, questId, resourceVersion) {
    if (!isAbyssFiniteQuest(category, questId) || resourceVersion === undefined)
        return false;
    const eventId = (0, abyss_modes_1.abyssEventFromQuest)(category, questId);
    const current = getAbyssTimeRevision(eventId);
    return current !== null && getAbyssTimeRevisionAtVersion(resourceVersion, eventId) !== current;
}
exports.isStaleAbyssClient = isStaleAbyssClient;
function isStaleAbyssBattle(quest) {
    if (!isAbyssFiniteQuest(quest.category, quest.questId))
        return false;
    const current = getAbyssTimeRevision((0, abyss_modes_1.abyssEventFromQuest)(quest.category, quest.questId));
    return current !== null && quest.questTimeRevision !== current;
}
exports.isStaleAbyssBattle = isStaleAbyssBattle;
