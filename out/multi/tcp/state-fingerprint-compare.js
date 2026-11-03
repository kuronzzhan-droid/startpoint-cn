"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateFingerprintComparator = exports.computeStateGroupHashes = exports.deepEqualValue = exports.canonicalJson = exports.MISSING_OBSERVER_SENTINEL = exports.UNSET_SENTINEL = void 0;
const crypto = __importStar(require("crypto"));
exports.UNSET_SENTINEL = "<unset>";
exports.MISSING_OBSERVER_SENTINEL = "<missing_observer>";
function canonicalJson(value) {
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return "[" + value.map(item => canonicalJson(item)).join(",") + "]";
    }
    if (value instanceof Map) {
        const entries = [...value.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        return "{" + entries.map(([k, v]) => JSON.stringify(String(k)) + ":" + canonicalJson(v)).join(",") + "}";
    }
    if (typeof value === "object" && value !== null) {
        const obj = value;
        const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
    }
    return JSON.stringify(value);
}
exports.canonicalJson = canonicalJson;
function deepEqualValue(a, b) {
    if (a === b) {
        // Note: in wf-fp, floats are f64:... strings and integers are safe ints.
        // Object.is handles -0 vs +0 just in case a number is ever passed.
        return typeof a === "number" ? Object.is(a, b) : true;
    }
    if (a === null || b === null || typeof a !== typeof b)
        return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqualValue(a[i], b[i]))
                return false;
        }
        return true;
    }
    if (Array.isArray(b))
        return false;
    if (typeof a === "object" && typeof b === "object") {
        const objA = a;
        const objB = b;
        const keysA = Object.keys(objA);
        const keysB = Object.keys(objB);
        if (keysA.length !== keysB.length)
            return false;
        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(objB, key))
                return false;
            if (!deepEqualValue(objA[key], objB[key]))
                return false;
        }
        return true;
    }
    return false;
}
exports.deepEqualValue = deepEqualValue;
function classifyStateGroup(fieldPath) {
    if (fieldPath.startsWith("/battle/"))
        return "battle";
    if (fieldPath === "/zone" || fieldPath.startsWith("/zone/"))
        return "zone";
    if (/^\/enemies\/.+\/trial(?:\/|$)/.test(fieldPath))
        return "trial";
    if (fieldPath === "/enemies" || fieldPath.startsWith("/enemies/"))
        return "enemies";
    if (fieldPath === "/funnels" || fieldPath.startsWith("/funnels/"))
        return "funnels";
    if (fieldPath === "/modifier" || fieldPath.startsWith("/modifier/"))
        return "modifier";
    if (fieldPath === "/buff" || fieldPath.startsWith("/buff/"))
        return "buff";
    if (fieldPath.startsWith("/rng/"))
        return "rng";
    return "other";
}
function computeStateGroupHashes(state) {
    const groups = {
        battle: [],
        zone: [],
        enemies: [],
        trial: [],
        funnels: [],
        modifier: [],
        buff: [],
        rng: [],
    };
    const sortedEntries = [...state.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const entry of sortedEntries) {
        const group = classifyStateGroup(entry[0]);
        if (!groups[group])
            groups[group] = [];
        groups[group].push(entry);
    }
    const hashes = {};
    for (const [groupName, entries] of Object.entries(groups)) {
        const serialized = canonicalJson(entries);
        hashes[groupName] = crypto.createHash("sha256").update(serialized, "utf8").digest("hex").slice(0, 16);
    }
    hashes.all = crypto.createHash("sha256").update(canonicalJson(sortedEntries), "utf8").digest("hex").slice(0, 16);
    return hashes;
}
exports.computeStateGroupHashes = computeStateGroupHashes;
function projectUserInput(inp) {
    return {
        kind: "User",
        sourceBattleId: inp.sourceBattleId,
        targetBattleId: inp.targetBattleId,
        battleEpoch: inp.battleEpoch,
        applyTargetFrame: inp.applyTargetFrame,
        command: inp.command,
    };
}
function projectCoopInput(inp) {
    return {
        kind: "Coop",
        sourceBattleId: inp.sourceBattleId,
        sourceBattleEpoch: inp.sourceBattleEpoch,
        sourceFrame: inp.sourceFrame,
        targetBattleId: inp.targetBattleId,
        battleEpoch: inp.battleEpoch,
        applyTargetFrame: inp.applyTargetFrame,
        command: inp.command,
    };
}
function projectAllInput(inp) {
    return {
        ordinal: inp.ordinal,
        kind: inp.kind,
        sourceBattleId: inp.sourceBattleId,
        sourceBattleEpoch: inp.sourceBattleEpoch,
        sourceFrame: inp.sourceFrame,
        targetBattleId: inp.targetBattleId,
        battleEpoch: inp.battleEpoch,
        applyTargetFrame: inp.applyTargetFrame,
        command: inp.command,
    };
}
function projectSpeedApplied(ev) {
    var _a, _b, _c;
    return {
        stage: "speed_applied",
        battleId: ev.battleId,
        battleEpoch: ev.battleEpoch,
        targetFrame: ev.targetFrame,
        command: ev.command,
        detail: {
            speed: (_a = ev.detail.speed) !== null && _a !== void 0 ? _a : null,
            length: (_b = ev.detail.length) !== null && _b !== void 0 ? _b : null,
            targetOtherBattleId: (_c = ev.detail.targetOtherBattleId) !== null && _c !== void 0 ? _c : null,
        },
    };
}
function allObserversEqual(observerIds, valuesByObserver) {
    if (observerIds.length < 2)
        return true;
    const first = valuesByObserver[observerIds[0]];
    for (let i = 1; i < observerIds.length; i++) {
        if (!deepEqualValue(first, valuesByObserver[observerIds[i]]))
            return false;
    }
    return true;
}
function formatSummaryValue(value) {
    if (value === exports.UNSET_SENTINEL || value === exports.MISSING_OBSERVER_SENTINEL)
        return String(value);
    return canonicalJson(value);
}
const INITIAL_SEED_PATHS = ["/battle/id", "/battle/baseSeed", "/battle/separativeBaseSeed"];
class StateFingerprintComparator {
    constructor(identity, initialMembers = [], onDesyncReport) {
        this.identity = identity;
        this.onDesyncReport = onDesyncReport;
        this.expectedMembers = new Map();
        this.rosterFrozen = false;
        this.eventsByObserver = new Map();
        this.gapsByObserver = new Map();
        this.observerIssues = new Map();
        this.observerPendingSeqs = new Set();
        this.timelines = new Map();
        this.firstReport = null;
        if (initialMembers.length > 0) {
            for (const member of initialMembers) {
                this.registerExpectedMemberInternal(member);
            }
            this.rosterFrozen = true;
        }
    }
    freezeExpectedMembers(members) {
        if (members.length === 0)
            return;
        if (!this.rosterFrozen) {
            for (const member of members) {
                this.registerExpectedMemberInternal(member);
            }
            this.rosterFrozen = true;
        }
        else {
            for (const member of members) {
                if (this.isAuthorizedMember(member)) {
                    this.registerExpectedMemberInternal(member);
                }
            }
        }
    }
    isAuthorizedMember(member) {
        if (!this.rosterFrozen || this.expectedMembers.size === 0)
            return true;
        for (const existing of this.expectedMembers.values()) {
            if (member.viewerId > 0 && existing.viewerId > 0 && existing.viewerId === member.viewerId) {
                return true;
            }
            if (member.connectionId && existing.connectionId && existing.connectionId === member.connectionId) {
                return true;
            }
            if (member.observerId && existing.observerId === member.observerId) {
                return true;
            }
        }
        return false;
    }
    registerExpectedMember(member) {
        if (this.rosterFrozen && !this.isAuthorizedMember(member)) {
            return member.observerId || member.connectionId || `viewer:${member.viewerId}`;
        }
        return this.registerExpectedMemberInternal(member);
    }
    registerExpectedMemberInternal(member) {
        // Match by viewerId if already registered before battle socket bound connectionId
        if (member.viewerId > 0) {
            for (const [existingKey, existing] of this.expectedMembers) {
                if (existing.viewerId === member.viewerId) {
                    const updatedId = member.connectionId || existing.connectionId || existingKey;
                    if (updatedId !== existingKey) {
                        this.expectedMembers.delete(existingKey);
                        this.migrateObserverKey(existingKey, updatedId);
                    }
                    const updated = {
                        observerId: updatedId,
                        viewerId: member.viewerId,
                        connectionId: member.connectionId || existing.connectionId,
                    };
                    this.expectedMembers.set(updatedId, updated);
                    return updatedId;
                }
            }
        }
        const key = member.observerId || member.connectionId || `viewer:${member.viewerId}`;
        if (!this.expectedMembers.has(key)) {
            this.expectedMembers.set(key, {
                observerId: key,
                viewerId: member.viewerId,
                connectionId: member.connectionId,
            });
        }
        return key;
    }
    setObserverPendingSequences(observerId, hasPending) {
        const had = this.observerPendingSeqs.has(observerId);
        if (hasPending === had)
            return;
        if (hasPending)
            this.observerPendingSeqs.add(observerId);
        else
            this.observerPendingSeqs.delete(observerId);
        for (const timeline of this.timelines.values()) {
            this.recomputeTimeline(timeline);
        }
    }
    migrateObserverKey(fromKey, toKey) {
        var _a, _b, _c, _d;
        if (fromKey === toKey)
            return;
        const events = this.eventsByObserver.get(fromKey);
        if (events) {
            this.eventsByObserver.set(toKey, [...events, ...((_a = this.eventsByObserver.get(toKey)) !== null && _a !== void 0 ? _a : [])]);
            this.eventsByObserver.delete(fromKey);
        }
        const gaps = this.gapsByObserver.get(fromKey);
        if (gaps) {
            this.gapsByObserver.set(toKey, [...gaps, ...((_b = this.gapsByObserver.get(toKey)) !== null && _b !== void 0 ? _b : [])]);
            this.gapsByObserver.delete(fromKey);
        }
        const issues = this.observerIssues.get(fromKey);
        if (issues) {
            const target = (_c = this.observerIssues.get(toKey)) !== null && _c !== void 0 ? _c : new Set();
            for (const item of issues)
                target.add(item);
            this.observerIssues.set(toKey, target);
            this.observerIssues.delete(fromKey);
        }
        if (this.observerPendingSeqs.has(fromKey)) {
            this.observerPendingSeqs.delete(fromKey);
            this.observerPendingSeqs.add(toKey);
        }
        for (const timeline of this.timelines.values()) {
            const frames = timeline.framesByObserver.get(fromKey);
            if (frames) {
                const targetFrames = (_d = timeline.framesByObserver.get(toKey)) !== null && _d !== void 0 ? _d : new Map();
                for (const [f, obs] of frames)
                    targetFrames.set(f, Object.assign(Object.assign({}, obs), { observerId: toKey }));
                timeline.framesByObserver.set(toKey, targetFrames);
                timeline.framesByObserver.delete(fromKey);
            }
        }
    }
    getExpectedObserverIds() {
        return [...this.expectedMembers.keys()];
    }
    addEvents(observerId, events) {
        if (events.length === 0)
            return;
        let list = this.eventsByObserver.get(observerId);
        if (!list) {
            list = [];
            this.eventsByObserver.set(observerId, list);
        }
        list.push(...events);
    }
    addGap(observerId, gap) {
        let list = this.gapsByObserver.get(observerId);
        if (!list) {
            list = [];
            this.gapsByObserver.set(observerId, list);
        }
        list.push(gap);
        for (const timeline of this.timelines.values()) {
            if (gap.battleId === null || gap.battleId === timeline.battleId) {
                this.recomputeTimeline(timeline);
            }
        }
    }
    noteObserverIssue(observerId, reason) {
        let set = this.observerIssues.get(observerId);
        if (!set) {
            set = new Set();
            this.observerIssues.set(observerId, set);
        }
        set.add(reason);
        for (const timeline of this.timelines.values()) {
            this.recomputeTimeline(timeline);
        }
    }
    addFrameObservation(observation) {
        const key = `${observation.battleId}#${observation.battleEpoch}`;
        let timeline = this.timelines.get(key);
        if (!timeline) {
            timeline = {
                battleId: observation.battleId,
                battleEpoch: observation.battleEpoch,
                framesByObserver: new Map(),
                observedFrames: new Set(),
                bestReport: null,
                emittedSignature: null,
            };
            this.timelines.set(key, timeline);
        }
        let byFrame = timeline.framesByObserver.get(observation.observerId);
        if (!byFrame) {
            byFrame = new Map();
            timeline.framesByObserver.set(observation.observerId, byFrame);
        }
        byFrame.set(observation.postFrame, observation);
        timeline.observedFrames.add(observation.postFrame);
        return this.recomputeTimeline(timeline);
    }
    getFirstReport() {
        return this.firstReport;
    }
    getBattleReport(battleId, battleEpoch = 0) {
        var _a, _b;
        return (_b = (_a = this.timelines.get(`${battleId}#${battleEpoch}`)) === null || _a === void 0 ? void 0 : _a.bestReport) !== null && _b !== void 0 ? _b : null;
    }
    getAllBattleReports() {
        const out = [];
        for (const timeline of this.timelines.values()) {
            if (timeline.bestReport)
                out.push(timeline.bestReport);
        }
        return out;
    }
    /**
     * Returns sorted common checkpoint frames where all expected (or >= 2 observed)
     * observers have an actual checkpoint for (battleId, battleEpoch).
     */
    getCommonFrames(battleId, battleEpoch = 0) {
        const timeline = this.timelines.get(`${battleId}#${battleEpoch}`);
        if (!timeline)
            return [];
        const expected = this.getExpectedObserverIds();
        const targetObservers = expected.length >= 2 ? expected : [...timeline.framesByObserver.keys()];
        if (targetObservers.length < 2)
            return [];
        const sortedFrames = [...timeline.observedFrames].sort((a, b) => a - b);
        return sortedFrames.filter(f => targetObservers.every(obsId => { var _a; return (_a = timeline.framesByObserver.get(obsId)) === null || _a === void 0 ? void 0 : _a.has(f); }));
    }
    getBattleDiagnosticSummary(battleId, battleEpoch = 0) {
        var _a;
        const timeline = this.timelines.get(`${battleId}#${battleEpoch}`);
        const commonFrames = this.getCommonFrames(battleId, battleEpoch);
        const observedFramesByObserver = {};
        const sampleIntervalsByObserver = {};
        const throttleEventsByObserver = {};
        const observerIds = new Set([
            ...this.getExpectedObserverIds(),
            ...(timeline ? timeline.framesByObserver.keys() : []),
            ...this.eventsByObserver.keys(),
        ]);
        for (const obsId of observerIds) {
            const byFrame = timeline === null || timeline === void 0 ? void 0 : timeline.framesByObserver.get(obsId);
            const frames = byFrame ? [...byFrame.keys()].sort((a, b) => a - b) : [];
            observedFramesByObserver[obsId] = frames;
            sampleIntervalsByObserver[obsId] = frames.map(f => {
                var _a, _b;
                const obs = byFrame.get(f);
                return {
                    postFrame: f,
                    sampleInterval: (_a = obs.sampleInterval) !== null && _a !== void 0 ? _a : null,
                    previousCheckpointFrame: (_b = obs.previousCheckpointFrame) !== null && _b !== void 0 ? _b : null,
                };
            });
            throttleEventsByObserver[obsId] = ((_a = this.eventsByObserver.get(obsId)) !== null && _a !== void 0 ? _a : []).filter(ev => ev.stage === "lifecycle"
                && ev.detail.reason === "throttle"
                && (ev.battleId === null || ev.battleId === battleId)
                && (ev.battleEpoch === null || ev.battleEpoch === battleEpoch));
        }
        return {
            schema: this.identity.schema,
            battleId,
            battleEpoch,
            commonFrames,
            evidenceStatus: commonFrames.length > 0 ? "sufficient" : "insufficient_common_frames",
            observedFramesByObserver,
            sampleIntervalsByObserver,
            throttleEventsByObserver,
        };
    }
    recomputeTimeline(timeline) {
        var _a, _b, _c;
        const sortedFrames = [...timeline.observedFrames].sort((a, b) => a - b);
        const expectedObservers = this.getExpectedObserverIds();
        let candidateReport = null;
        for (const frame of sortedFrames) {
            const observedObservers = [];
            for (const obsId of expectedObservers) {
                if ((_a = timeline.framesByObserver.get(obsId)) === null || _a === void 0 ? void 0 : _a.has(frame)) {
                    observedObservers.push(obsId);
                }
            }
            for (const obsId of timeline.framesByObserver.keys()) {
                if (!observedObservers.includes(obsId) && ((_b = timeline.framesByObserver.get(obsId)) === null || _b === void 0 ? void 0 : _b.has(frame))) {
                    observedObservers.push(obsId);
                }
            }
            if (observedObservers.length < 2)
                continue;
            const evaluation = this.evaluateFrame(timeline, frame, expectedObservers, observedObservers);
            if (evaluation) {
                candidateReport = evaluation;
                break;
            }
        }
        if (!candidateReport)
            return null;
        const prevBest = timeline.bestReport;
        const shouldEmit = !prevBest
            || candidateReport.postFrame < prevBest.postFrame
            || (!prevBest.confirmed && candidateReport.confirmed)
            || prevBest.layer !== candidateReport.layer
            || prevBest.fieldPath !== candidateReport.fieldPath
            || prevBest.completeness !== candidateReport.completeness;
        timeline.bestReport = candidateReport;
        if (!this.firstReport
            || candidateReport.postFrame < this.firstReport.postFrame
            || (candidateReport.postFrame === this.firstReport.postFrame && !this.firstReport.confirmed && candidateReport.confirmed)
            || (this.firstReport.battleId === candidateReport.battleId && this.firstReport.battleEpoch === candidateReport.battleEpoch)) {
            this.firstReport = candidateReport;
        }
        const signature = `${candidateReport.battleId}#${candidateReport.battleEpoch}@${candidateReport.postFrame}:${candidateReport.layer}:${candidateReport.fieldPath}:${candidateReport.status}:${candidateReport.completeness}`;
        if (shouldEmit && timeline.emittedSignature !== signature) {
            const isFirstForBattle = timeline.emittedSignature === null;
            timeline.emittedSignature = signature;
            (_c = this.onDesyncReport) === null || _c === void 0 ? void 0 : _c.call(this, candidateReport, isFirstForBattle);
        }
        return candidateReport;
    }
    isCompactInputWindowComparable(timeline, frame, observedObservers, obsAtFrame) {
        var _a, _b;
        if (observedObservers.length < 2)
            return false;
        let commonPrevCheckpoint = undefined;
        for (const obsId of observedObservers) {
            const obs = obsAtFrame.get(obsId);
            if (!obs || !obs.inputSummary)
                return false;
            const prevCp = (_a = obs.previousCheckpointFrame) !== null && _a !== void 0 ? _a : null;
            if (commonPrevCheckpoint === undefined) {
                commonPrevCheckpoint = prevCp;
            }
            else if (prevCp !== commonPrevCheckpoint) {
                // Different accumulation windows (e.g. adaptive throttling on one observer)
                return false;
            }
            // If previousCheckpointFrame >= 0 and this observer has earlier rows, ensure prevCp wasn't a failed/missed checkpoint
            const obsFrames = timeline.framesByObserver.get(obsId);
            if (prevCp !== null && prevCp >= 0 && obsFrames) {
                const hasEarlierFrame = [...obsFrames.keys()].some(f => f < frame);
                if (hasEarlierFrame && !obsFrames.has(prevCp)) {
                    return false;
                }
            }
            // Check for any gap in (prevCp, frame] on this observer
            const windowStart = prevCp !== null && prevCp >= 0 ? prevCp : 0;
            for (const gap of (_b = this.gapsByObserver.get(obsId)) !== null && _b !== void 0 ? _b : []) {
                if (gap.battleId !== null && gap.battleId !== timeline.battleId)
                    continue;
                if (gap.battleEpoch !== null && gap.battleEpoch !== timeline.battleEpoch)
                    continue;
                if (gap.fromFrame !== null && gap.fromFrame > frame)
                    continue;
                if (gap.toFrame !== null && gap.toFrame <= windowStart && gap.reason !== "initial_missing")
                    continue;
                if (gap.reason === "initial_missing" && windowStart > 0)
                    continue;
                return false;
            }
        }
        return true;
    }
    evaluateFrame(timeline, frame, expectedObservers, observedObservers) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
        const allObserverOrder = expectedObservers.length > 0
            ? [...expectedObservers, ...observedObservers.filter(id => !expectedObservers.includes(id))]
            : [...observedObservers];
        const obsAtFrame = new Map();
        for (const obsId of observedObservers) {
            const obs = (_a = timeline.framesByObserver.get(obsId)) === null || _a === void 0 ? void 0 : _a.get(frame);
            if (obs)
                obsAtFrame.set(obsId, obs);
        }
        const isCompactV2 = this.identity.schema === "coop-state-fingerprint-compact-v2"
            || [...obsAtFrame.values()].some(o => o.schema === "coop-state-fingerprint-compact-v2" || o.inputSummary != null);
        const valueMapFor = (getter) => {
            const out = {};
            for (const obsId of allObserverOrder) {
                const obs = obsAtFrame.get(obsId);
                out[obsId] = obs ? getter(obs, obsId) : exports.MISSING_OBSERVER_SENTINEL;
            }
            return out;
        };
        // === Layer 1: Initial Values ===
        const initialDiffs = [];
        if (frame === 0) {
            const allKeys = new Set();
            for (const obs of obsAtFrame.values()) {
                for (const key of obs.state.keys())
                    allKeys.add(key);
            }
            const sortedKeys = [...allKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
            for (const fieldPath of sortedKeys) {
                const valuesByObserver = valueMapFor(obs => obs.state.has(fieldPath) ? obs.state.get(fieldPath) : exports.UNSET_SENTINEL);
                if (!allObserversEqual(observedObservers, valuesByObserver)) {
                    initialDiffs.push({ layer: "initial", fieldPath, valuesByObserver });
                }
            }
        }
        else if (!isCompactV2) {
            // Check initial seed fields if frame 0 was missing on any observer (v1)
            const frame0AllPresent = observedObservers.every(obsId => { var _a; return (_a = timeline.framesByObserver.get(obsId)) === null || _a === void 0 ? void 0 : _a.has(0); });
            if (!frame0AllPresent) {
                for (const fieldPath of INITIAL_SEED_PATHS) {
                    const valuesByObserver = valueMapFor(obs => obs.state.has(fieldPath) ? obs.state.get(fieldPath) : exports.UNSET_SENTINEL);
                    if (!allObserversEqual(observedObservers, valuesByObserver)) {
                        initialDiffs.push({ layer: "initial", fieldPath, valuesByObserver });
                    }
                }
            }
        }
        // === Layer 2: User & Speed Inputs ===
        const userSpeedDiffs = [];
        const userSpeedByObserver = {};
        // === Layer 3: Applied Coop & Combined Inputs ===
        const coopInputDiffs = [];
        const coopInputByObserver = {};
        const inputWindowComparable = isCompactV2
            ? this.isCompactInputWindowComparable(timeline, frame, observedObservers, obsAtFrame)
            : true;
        if (isCompactV2) {
            for (const obsId of allObserverOrder) {
                const obs = obsAtFrame.get(obsId);
                const events = (_b = this.eventsByObserver.get(obsId)) !== null && _b !== void 0 ? _b : [];
                const speedApplied = events
                    .filter(ev => ev.stage === "speed_applied"
                    && (ev.battleId === timeline.battleId || ev.detail.targetOtherBattleId === timeline.battleId)
                    && (ev.battleEpoch === null || ev.battleEpoch === timeline.battleEpoch))
                    .map(projectSpeedApplied);
                const speedReceived = events
                    .filter(ev => ev.stage === "speed_received"
                    && (ev.battleId === timeline.battleId || ev.detail.targetOtherBattleId === timeline.battleId));
                const routeEvents = events
                    .filter(ev => (ev.stage === "route_received" || ev.stage === "route_decoded" || ev.stage === "route_rejected")
                    && (ev.battleId === null || ev.battleId === timeline.battleId || ev.sourceBattleId === timeline.battleId));
                userSpeedByObserver[obsId] = {
                    userInputs: [],
                    speedApplied,
                    speedReceived,
                    routeEvents,
                    inputSummary: (_c = obs === null || obs === void 0 ? void 0 : obs.inputSummary) !== null && _c !== void 0 ? _c : null,
                    routeSummary: (_d = obs === null || obs === void 0 ? void 0 : obs.routeSummary) !== null && _d !== void 0 ? _d : null,
                };
                coopInputByObserver[obsId] = {
                    coopInputs: [],
                    allInputs: [],
                    inputSummary: (_e = obs === null || obs === void 0 ? void 0 : obs.inputSummary) !== null && _e !== void 0 ? _e : null,
                };
            }
            if (inputWindowComparable) {
                // Compare User input counts and User.* top-level kind counts in Layer 2 (user_speed)
                const userCountMap = valueMapFor(obs => obs.inputSummary ? obs.inputSummary.user : exports.UNSET_SENTINEL);
                if (!allObserversEqual(observedObservers, userCountMap)) {
                    userSpeedDiffs.push({
                        layer: "user_speed",
                        fieldPath: "/inputSummary/user",
                        valuesByObserver: userCountMap,
                    });
                }
                const userKindKeys = new Set();
                for (const obs of obsAtFrame.values()) {
                    if (!obs.inputSummary)
                        continue;
                    for (const k of Object.keys(obs.inputSummary.kinds)) {
                        if (k.startsWith("User."))
                            userKindKeys.add(k);
                    }
                }
                for (const k of [...userKindKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
                    const kindMap = valueMapFor(obs => { var _a; return obs.inputSummary ? ((_a = obs.inputSummary.kinds[k]) !== null && _a !== void 0 ? _a : 0) : exports.UNSET_SENTINEL; });
                    if (!allObserversEqual(observedObservers, kindMap)) {
                        userSpeedDiffs.push({
                            layer: "user_speed",
                            fieldPath: `/inputSummary/kinds/${k}`,
                            valuesByObserver: kindMap,
                        });
                    }
                }
                // Compare Coop input counts, Coop.* kinds, total count, unknown/readErrors, first/last frame, and orderedHash in Layer 3 (coop_input)
                const coopCountMap = valueMapFor(obs => obs.inputSummary ? obs.inputSummary.coop : exports.UNSET_SENTINEL);
                if (!allObserversEqual(observedObservers, coopCountMap)) {
                    coopInputDiffs.push({
                        layer: "coop_input",
                        fieldPath: "/inputSummary/coop",
                        valuesByObserver: coopCountMap,
                    });
                }
                const coopKindKeys = new Set();
                const otherKindKeys = new Set();
                for (const obs of obsAtFrame.values()) {
                    if (!obs.inputSummary)
                        continue;
                    for (const k of Object.keys(obs.inputSummary.kinds)) {
                        if (k.startsWith("Coop."))
                            coopKindKeys.add(k);
                        else if (!k.startsWith("User."))
                            otherKindKeys.add(k);
                    }
                }
                for (const k of [...coopKindKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
                    const kindMap = valueMapFor(obs => { var _a; return obs.inputSummary ? ((_a = obs.inputSummary.kinds[k]) !== null && _a !== void 0 ? _a : 0) : exports.UNSET_SENTINEL; });
                    if (!allObserversEqual(observedObservers, kindMap)) {
                        coopInputDiffs.push({
                            layer: "coop_input",
                            fieldPath: `/inputSummary/kinds/${k}`,
                            valuesByObserver: kindMap,
                        });
                    }
                }
                for (const fieldName of ["count", "unknown", "readErrors"]) {
                    const fMap = valueMapFor(obs => obs.inputSummary ? obs.inputSummary[fieldName] : exports.UNSET_SENTINEL);
                    if (!allObserversEqual(observedObservers, fMap)) {
                        coopInputDiffs.push({
                            layer: "coop_input",
                            fieldPath: `/inputSummary/${fieldName}`,
                            valuesByObserver: fMap,
                        });
                    }
                }
                for (const k of [...otherKindKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
                    const kindMap = valueMapFor(obs => { var _a; return obs.inputSummary ? ((_a = obs.inputSummary.kinds[k]) !== null && _a !== void 0 ? _a : 0) : exports.UNSET_SENTINEL; });
                    if (!allObserversEqual(observedObservers, kindMap)) {
                        coopInputDiffs.push({
                            layer: "coop_input",
                            fieldPath: `/inputSummary/kinds/${k}`,
                            valuesByObserver: kindMap,
                        });
                    }
                }
                for (const fieldName of ["firstFrame", "lastFrame", "orderedHash"]) {
                    const fMap = valueMapFor(obs => obs.inputSummary ? obs.inputSummary[fieldName] : exports.UNSET_SENTINEL);
                    if (!allObserversEqual(observedObservers, fMap)) {
                        coopInputDiffs.push({
                            layer: "coop_input",
                            fieldPath: `/inputSummary/${fieldName}`,
                            valuesByObserver: fMap,
                        });
                    }
                }
            }
        }
        else {
            const applyTargetFrame = frame === 0 ? -1 : frame - 1;
            let maxUserLen = 0;
            let maxSpeedAppliedLen = 0;
            for (const obsId of allObserverOrder) {
                const obs = obsAtFrame.get(obsId);
                const userInputs = obs ? obs.inputs.filter(i => i.kind === "User").map(projectUserInput) : [];
                const events = (_f = this.eventsByObserver.get(obsId)) !== null && _f !== void 0 ? _f : [];
                const speedApplied = events
                    .filter(ev => ev.stage === "speed_applied"
                    && ev.targetFrame === applyTargetFrame
                    && (ev.battleId === timeline.battleId || ev.detail.targetOtherBattleId === timeline.battleId)
                    && (ev.battleEpoch === null || ev.battleEpoch === timeline.battleEpoch))
                    .map(projectSpeedApplied);
                const speedReceived = events
                    .filter(ev => ev.stage === "speed_received"
                    && (ev.battleId === timeline.battleId || ev.detail.targetOtherBattleId === timeline.battleId));
                const routeEvents = events
                    .filter(ev => (ev.stage === "route_received" || ev.stage === "route_decoded" || ev.stage === "route_rejected")
                    && (ev.battleId === null || ev.battleId === timeline.battleId || ev.sourceBattleId === timeline.battleId));
                userSpeedByObserver[obsId] = { userInputs, speedApplied, speedReceived, routeEvents };
                if (obs) {
                    if (userInputs.length > maxUserLen)
                        maxUserLen = userInputs.length;
                    if (speedApplied.length > maxSpeedAppliedLen)
                        maxSpeedAppliedLen = speedApplied.length;
                }
            }
            for (let i = 0; i < maxUserLen; i++) {
                const cmdMap = valueMapFor((_obs, obsId) => {
                    const item = userSpeedByObserver[obsId].userInputs[i];
                    return item ? item.command : exports.UNSET_SENTINEL;
                });
                if (!allObserversEqual(observedObservers, cmdMap)) {
                    userSpeedDiffs.push({ layer: "user_speed", fieldPath: `/inputs/user/${i}/command`, valuesByObserver: cmdMap });
                    continue;
                }
                const itemMap = valueMapFor((_obs, obsId) => { var _a; return (_a = userSpeedByObserver[obsId].userInputs[i]) !== null && _a !== void 0 ? _a : exports.UNSET_SENTINEL; });
                if (!allObserversEqual(observedObservers, itemMap)) {
                    userSpeedDiffs.push({ layer: "user_speed", fieldPath: `/inputs/user/${i}`, valuesByObserver: itemMap });
                }
            }
            const userLenMap = valueMapFor((_obs, obsId) => userSpeedByObserver[obsId].userInputs.length);
            if (!allObserversEqual(observedObservers, userLenMap)) {
                userSpeedDiffs.push({ layer: "user_speed", fieldPath: "/inputs/user/length", valuesByObserver: userLenMap });
            }
            for (let i = 0; i < maxSpeedAppliedLen; i++) {
                const cmdMap = valueMapFor((_obs, obsId) => {
                    const item = userSpeedByObserver[obsId].speedApplied[i];
                    return item ? item.command : exports.UNSET_SENTINEL;
                });
                if (!allObserversEqual(observedObservers, cmdMap)) {
                    userSpeedDiffs.push({ layer: "user_speed", fieldPath: `/events/speed_applied/${i}/command`, valuesByObserver: cmdMap });
                    continue;
                }
                const itemMap = valueMapFor((_obs, obsId) => { var _a; return (_a = userSpeedByObserver[obsId].speedApplied[i]) !== null && _a !== void 0 ? _a : exports.UNSET_SENTINEL; });
                if (!allObserversEqual(observedObservers, itemMap)) {
                    userSpeedDiffs.push({ layer: "user_speed", fieldPath: `/events/speed_applied/${i}`, valuesByObserver: itemMap });
                }
            }
            const speedLenMap = valueMapFor((_obs, obsId) => userSpeedByObserver[obsId].speedApplied.length);
            if (!allObserversEqual(observedObservers, speedLenMap)) {
                userSpeedDiffs.push({ layer: "user_speed", fieldPath: "/events/speed_applied/length", valuesByObserver: speedLenMap });
            }
            let maxCoopLen = 0;
            let maxAllLen = 0;
            for (const obsId of allObserverOrder) {
                const obs = obsAtFrame.get(obsId);
                const coopInputs = obs ? obs.inputs.filter(i => i.kind === "Coop").map(projectCoopInput) : [];
                const allInputs = obs ? obs.inputs.map(projectAllInput) : [];
                coopInputByObserver[obsId] = { coopInputs, allInputs };
                if (obs) {
                    if (coopInputs.length > maxCoopLen)
                        maxCoopLen = coopInputs.length;
                    if (allInputs.length > maxAllLen)
                        maxAllLen = allInputs.length;
                }
            }
            for (let i = 0; i < maxCoopLen; i++) {
                const cmdMap = valueMapFor((_obs, obsId) => {
                    const item = coopInputByObserver[obsId].coopInputs[i];
                    return item ? item.command : exports.UNSET_SENTINEL;
                });
                if (!allObserversEqual(observedObservers, cmdMap)) {
                    coopInputDiffs.push({ layer: "coop_input", fieldPath: `/inputs/coop/${i}/command`, valuesByObserver: cmdMap });
                    continue;
                }
                const itemMap = valueMapFor((_obs, obsId) => { var _a; return (_a = coopInputByObserver[obsId].coopInputs[i]) !== null && _a !== void 0 ? _a : exports.UNSET_SENTINEL; });
                if (!allObserversEqual(observedObservers, itemMap)) {
                    coopInputDiffs.push({ layer: "coop_input", fieldPath: `/inputs/coop/${i}`, valuesByObserver: itemMap });
                }
            }
            const coopLenMap = valueMapFor((_obs, obsId) => coopInputByObserver[obsId].coopInputs.length);
            if (!allObserversEqual(observedObservers, coopLenMap)) {
                coopInputDiffs.push({ layer: "coop_input", fieldPath: "/inputs/coop/length", valuesByObserver: coopLenMap });
            }
            // Check combined input ordering if User and Coop lists matched individually
            if (userSpeedDiffs.length === 0 && coopInputDiffs.length === 0) {
                for (let i = 0; i < maxAllLen; i++) {
                    const ordMap = valueMapFor((_obs, obsId) => { var _a; return (_a = coopInputByObserver[obsId].allInputs[i]) !== null && _a !== void 0 ? _a : exports.UNSET_SENTINEL; });
                    if (!allObserversEqual(observedObservers, ordMap)) {
                        coopInputDiffs.push({ layer: "coop_input", fieldPath: `/inputs/${i}`, valuesByObserver: ordMap });
                    }
                }
            }
        }
        // === Layer 4: State ===
        const stateDiffs = [];
        if (frame > 0) {
            const allKeys = new Set();
            for (const obs of obsAtFrame.values()) {
                for (const key of obs.state.keys())
                    allKeys.add(key);
            }
            const sortedKeys = [...allKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
            for (const fieldPath of sortedKeys) {
                const valuesByObserver = valueMapFor(obs => obs.state.has(fieldPath) ? obs.state.get(fieldPath) : exports.UNSET_SENTINEL);
                if (!allObserversEqual(observedObservers, valuesByObserver)) {
                    stateDiffs.push({ layer: "state", fieldPath, valuesByObserver });
                }
            }
            if (stateDiffs.length === 0) {
                const zoneMap = valueMapFor(obs => obs.zone);
                if (!allObserversEqual(observedObservers, zoneMap)) {
                    stateDiffs.push({ layer: "state", fieldPath: "/battle/currentZoneIndex", valuesByObserver: zoneMap });
                }
                const floorMap = valueMapFor(obs => obs.floor);
                if (!allObserversEqual(observedObservers, floorMap)) {
                    stateDiffs.push({ layer: "state", fieldPath: "/battle/floor", valuesByObserver: floorMap });
                }
            }
        }
        const totalDiffs = initialDiffs.length + userSpeedDiffs.length + coopInputDiffs.length + stateDiffs.length;
        if (totalDiffs === 0)
            return null;
        // Determine primary layer and attribution in strict 4-layer order:
        // initial -> user_speed -> coop_input -> state
        let primaryLayer;
        let attribution;
        let primaryDiff;
        if (initialDiffs.length > 0) {
            primaryLayer = "initial";
            attribution = "initial_state";
            primaryDiff = initialDiffs[0];
        }
        else if (userSpeedDiffs.length > 0) {
            primaryLayer = "user_speed";
            attribution = "user_or_speed_input";
            primaryDiff = userSpeedDiffs[0];
        }
        else if (coopInputDiffs.length > 0) {
            primaryLayer = "coop_input";
            attribution = "coop_input_schedule";
            primaryDiff = coopInputDiffs[0];
        }
        else {
            primaryLayer = "state";
            attribution = "simulation_determinism";
            primaryDiff = stateDiffs[0];
        }
        // Compute completeness and incompleteReasons
        const incompleteReasonSet = new Set();
        const missingObservers = [];
        const completenessTargetObservers = expectedObservers.length > 0 ? expectedObservers : observedObservers;
        if (completenessTargetObservers.length < 2) {
            incompleteReasonSet.add("insufficient_expected_observers");
        }
        let hasUnsupportedOrNullCausal = false;
        for (const obsId of completenessTargetObservers) {
            const obsFrames = timeline.framesByObserver.get(obsId);
            if (!obsFrames || !obsFrames.has(frame)) {
                missingObservers.push(obsId);
                incompleteReasonSet.add(`missing_observer:${obsId}`);
            }
            const initialObs = obsFrames === null || obsFrames === void 0 ? void 0 : obsFrames.get(0);
            if (!initialObs || initialObs.phase !== "initial") {
                incompleteReasonSet.add("initial_missing");
            }
            if (obsFrames) {
                if (isCompactV2) {
                    const observedUpToFrame = [...obsFrames.keys()].filter(f => f <= frame).sort((a, b) => a - b);
                    for (let idx = 0; idx < observedUpToFrame.length; idx++) {
                        const f = observedUpToFrame[idx];
                        const fObs = obsFrames.get(f);
                        if (f > 0 && fObs.previousCheckpointFrame !== null && fObs.previousCheckpointFrame !== undefined) {
                            if (fObs.previousCheckpointFrame < 0
                                || !obsFrames.has(fObs.previousCheckpointFrame)
                                || (idx > 0 && fObs.previousCheckpointFrame !== observedUpToFrame[idx - 1])) {
                                incompleteReasonSet.add(`missing_checkpoint:${obsId}@${fObs.previousCheckpointFrame}`);
                            }
                        }
                        if (!fObs.eventContextComplete) {
                            incompleteReasonSet.add(`event_loss:${obsId}`);
                        }
                        if (fObs.unsupported.length > 0) {
                            hasUnsupportedOrNullCausal = true;
                        }
                        if (fObs.inputSummary) {
                            if (fObs.inputSummary.readErrors > 0) {
                                incompleteReasonSet.add(`input_read_error:${obsId}@${f}`);
                            }
                            if (fObs.inputSummary.unknown > 0) {
                                incompleteReasonSet.add(`input_unknown:${obsId}@${f}`);
                            }
                        }
                    }
                }
                else {
                    // Check contiguous frames 0..frame for v1
                    for (let f = 0; f <= frame; f++) {
                        const fObs = obsFrames.get(f);
                        if (!fObs) {
                            incompleteReasonSet.add(`missing_frame:${obsId}@${f}`);
                            break;
                        }
                        if (!fObs.eventContextComplete) {
                            incompleteReasonSet.add(`event_loss:${obsId}`);
                        }
                        if (fObs.unsupported.length > 0) {
                            hasUnsupportedOrNullCausal = true;
                        }
                        for (const inp of fObs.inputs) {
                            if (inp.command === null) {
                                incompleteReasonSet.add(`unsupported_input_command:${obsId}@${f}`);
                            }
                            if (inp.kind === "Coop" && inp.sourceBattleEpoch === null) {
                                hasUnsupportedOrNullCausal = true;
                            }
                        }
                    }
                }
            }
            // Check client/server gaps for this observer
            for (const gap of (_g = this.gapsByObserver.get(obsId)) !== null && _g !== void 0 ? _g : []) {
                if (gap.battleId !== null && gap.battleId !== timeline.battleId)
                    continue;
                if (gap.battleEpoch !== null && gap.battleEpoch !== timeline.battleEpoch)
                    continue;
                if (gap.fromFrame !== null && gap.fromFrame > frame)
                    continue;
                incompleteReasonSet.add(gap.reason);
            }
            for (const issue of (_h = this.observerIssues.get(obsId)) !== null && _h !== void 0 ? _h : []) {
                incompleteReasonSet.add(issue);
            }
            if (this.observerPendingSeqs.has(obsId)) {
                incompleteReasonSet.add(`pending_fragments_or_seq:${obsId}`);
            }
        }
        // Compute lastEqualFrame across common observed frames < frame
        let lastEqualFrame = null;
        const earlierFrames = [...timeline.observedFrames].filter(f => f < frame).sort((a, b) => b - a);
        for (const f of earlierFrames) {
            const allHaveFrame = completenessTargetObservers.length >= 2
                && completenessTargetObservers.every(obsId => { var _a; return (_a = timeline.framesByObserver.get(obsId)) === null || _a === void 0 ? void 0 : _a.has(f); });
            if (allHaveFrame) {
                lastEqualFrame = f;
                break;
            }
        }
        const incompleteReasons = [...incompleteReasonSet];
        let completeness;
        let status;
        let confirmed;
        if (incompleteReasons.length > 0) {
            completeness = "incomplete";
            status = "candidate_incomplete";
            confirmed = false;
        }
        else if (hasUnsupportedOrNullCausal) {
            completeness = "partial_observed";
            status = "confirmed";
            confirmed = true;
        }
        else {
            completeness = "complete";
            status = "confirmed";
            confirmed = true;
        }
        const eventCursors = {};
        const packetSeqs = {};
        const unsupportedByObserver = {};
        const groupHashesByObserver = {};
        const userInputsByObserver = {};
        const coopInputsByObserver = {};
        const speedEventsByObserver = {};
        const routeEventsByObserver = {};
        const gapsByObserver = {};
        const inputSummaryByObserver = {};
        const routeSummaryByObserver = {};
        const sampleIntervalByObserver = {};
        const previousCheckpointFrameByObserver = {};
        const throttleEventsByObserver = {};
        for (const obsId of allObserverOrder) {
            const obs = obsAtFrame.get(obsId);
            eventCursors[obsId] = obs ? obs.eventCursor : null;
            packetSeqs[obsId] = obs ? obs.seq : null;
            unsupportedByObserver[obsId] = obs ? obs.unsupported : [];
            groupHashesByObserver[obsId] = obs ? obs.groupHashes : {};
            userInputsByObserver[obsId] = (_k = (_j = userSpeedByObserver[obsId]) === null || _j === void 0 ? void 0 : _j.userInputs) !== null && _k !== void 0 ? _k : [];
            coopInputsByObserver[obsId] = (_m = (_l = coopInputByObserver[obsId]) === null || _l === void 0 ? void 0 : _l.coopInputs) !== null && _m !== void 0 ? _m : [];
            speedEventsByObserver[obsId] = [
                ...((_p = (_o = userSpeedByObserver[obsId]) === null || _o === void 0 ? void 0 : _o.speedApplied) !== null && _p !== void 0 ? _p : []),
                ...((_r = (_q = userSpeedByObserver[obsId]) === null || _q === void 0 ? void 0 : _q.speedReceived) !== null && _r !== void 0 ? _r : []),
            ];
            routeEventsByObserver[obsId] = (_t = (_s = userSpeedByObserver[obsId]) === null || _s === void 0 ? void 0 : _s.routeEvents) !== null && _t !== void 0 ? _t : [];
            gapsByObserver[obsId] = ((_u = this.gapsByObserver.get(obsId)) !== null && _u !== void 0 ? _u : []).filter(g => (g.battleId === null || g.battleId === timeline.battleId)
                && (g.battleEpoch === null || g.battleEpoch === timeline.battleEpoch));
            inputSummaryByObserver[obsId] = (_v = obs === null || obs === void 0 ? void 0 : obs.inputSummary) !== null && _v !== void 0 ? _v : null;
            routeSummaryByObserver[obsId] = (_w = obs === null || obs === void 0 ? void 0 : obs.routeSummary) !== null && _w !== void 0 ? _w : null;
            sampleIntervalByObserver[obsId] = (_x = obs === null || obs === void 0 ? void 0 : obs.sampleInterval) !== null && _x !== void 0 ? _x : null;
            previousCheckpointFrameByObserver[obsId] = (_y = obs === null || obs === void 0 ? void 0 : obs.previousCheckpointFrame) !== null && _y !== void 0 ? _y : null;
            throttleEventsByObserver[obsId] = ((_z = this.eventsByObserver.get(obsId)) !== null && _z !== void 0 ? _z : []).filter(ev => ev.stage === "lifecycle"
                && ev.detail.reason === "throttle"
                && (ev.battleId === null || ev.battleId === timeline.battleId)
                && (ev.battleEpoch === null || ev.battleEpoch === timeline.battleEpoch)
                && (ev.targetFrame === null || ev.targetFrame <= frame));
        }
        const valuePairs = allObserverOrder
            .map(obsId => `${obsId}=${formatSummaryValue(primaryDiff.valuesByObserver[obsId])}`)
            .join(",");
        const summary = `${timeline.battleId}@${frame} ${primaryDiff.fieldPath}: ${valuePairs}`;
        const allDiffFields = [
            ...initialDiffs,
            ...userSpeedDiffs,
            ...coopInputDiffs,
            ...stateDiffs,
        ];
        const phase = frame === 0 ? "initial" : "post";
        const contextPayload = {
            userInputsByObserver,
            coopInputsByObserver,
            speedEventsByObserver,
            routeEventsByObserver,
            gapsByObserver,
        };
        if (isCompactV2) {
            contextPayload.inputSummaryByObserver = inputSummaryByObserver;
            contextPayload.routeSummaryByObserver = routeSummaryByObserver;
            contextPayload.sampleIntervalByObserver = sampleIntervalByObserver;
            contextPayload.previousCheckpointFrameByObserver = previousCheckpointFrameByObserver;
            contextPayload.throttleEventsByObserver = throttleEventsByObserver;
            contextPayload.summaryCoverage = {
                note: "compact-v2 top-level summary",
                inputSummary: "top_level_only",
                routeSummary: "top_level_only",
                inputWindowComparable,
            };
        }
        return {
            runId: this.identity.runId,
            roomNumber: this.identity.roomNumber,
            roomInstanceId: this.identity.roomInstanceId,
            battleSessionId: this.identity.battleSessionId,
            generation: this.identity.generation,
            sceneEpoch: this.identity.sceneEpoch,
            schema: this.identity.schema,
            battleId: timeline.battleId,
            battleEpoch: timeline.battleEpoch,
            postFrame: frame,
            frame,
            phase,
            status,
            confirmed,
            completeness,
            complete: completeness === "complete",
            incompleteReasons,
            layer: primaryLayer,
            attribution,
            fieldPath: primaryDiff.fieldPath,
            field: primaryDiff.fieldPath,
            observerValues: primaryDiff.valuesByObserver,
            valuesByObserver: primaryDiff.valuesByObserver,
            summary,
            lastEqualFrame,
            expectedObservers: [...completenessTargetObservers],
            observedObservers: [...observedObservers],
            missingObservers,
            eventCursors,
            packetSeqs,
            unsupportedByObserver,
            groupHashesByObserver,
            allDiffFields,
            layers: {
                initial: {
                    equal: initialDiffs.length === 0,
                    diffs: initialDiffs,
                },
                userSpeed: {
                    equal: userSpeedDiffs.length === 0,
                    diffs: userSpeedDiffs,
                    byObserver: userSpeedByObserver,
                },
                coopInput: {
                    equal: coopInputDiffs.length === 0,
                    diffs: coopInputDiffs,
                    byObserver: coopInputByObserver,
                },
                state: {
                    equal: stateDiffs.length === 0 && (frame > 0 || initialDiffs.length === 0),
                    diffs: frame === 0 ? initialDiffs : stateDiffs,
                },
            },
            context: contextPayload,
        };
    }
}
exports.StateFingerprintComparator = StateFingerprintComparator;
