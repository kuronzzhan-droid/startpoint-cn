"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearMultiSettlementSnapshot = exports.mergeMultiSettlementResults = void 0;
const memory_diagnostics_1 = require("../lib/memory-diagnostics");
const snapshots = new Map();
// A teammate can finish minutes after the first member (it keeps fighting
// while the room waits for it). Keep self-reported results long enough that a
// late finisher sees the earlier members' authoritative scores.
const SNAPSHOT_RETENTION_MS = (() => {
    const parsed = parseInt(process.env.MULTI_SETTLEMENT_SNAPSHOT_RETENTION_MS || "", 10);
    return Number.isFinite(parsed) ? Math.max(120000, parsed) : 900000;
})();
(0, memory_diagnostics_1.registerMemoryCounters)("settlementBarriers", () => ({ entries: snapshots.size }));
function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function normalizeResult(value) {
    const viewerId = finiteNumber(value === null || value === void 0 ? void 0 : value.viewer_id, 0);
    if (viewerId <= 0)
        return null;
    return {
        viewer_id: viewerId,
        com_id: finiteNumber(value === null || value === void 0 ? void 0 : value.com_id, 0),
        score: finiteNumber(value === null || value === void 0 ? void 0 : value.score, 0),
        contribution_score: finiteNumber(value === null || value === void 0 ? void 0 : value.contribution_score, 0),
    };
}
function mergeParticipants(current, incoming) {
    const merged = new Map();
    for (const participant of [...current, ...incoming]) {
        const viewerId = finiteNumber(participant === null || participant === void 0 ? void 0 : participant.viewerId, 0);
        if (viewerId <= 0)
            continue;
        const comId = finiteNumber(participant === null || participant === void 0 ? void 0 : participant.comId, 0);
        const previous = merged.get(viewerId);
        merged.set(viewerId, {
            viewerId,
            comId: (previous === null || previous === void 0 ? void 0 : previous.comId) || comId,
        });
    }
    return [...merged.values()];
}
function createSnapshot(key, participants, expectedRealViewerIds) {
    const expected = expectedRealViewerIds
        .map(viewerId => finiteNumber(viewerId, 0))
        .filter(viewerId => viewerId > 0);
    const mergedParticipants = mergeParticipants(participants, expected.map(viewerId => ({ viewerId, comId: 0 })));
    const snapshot = {
        participants: mergedParticipants,
        expectedRealViewerIds: new Set(expected),
        results: new Map(),
        selfReportedViewerIds: new Set(),
        waiters: new Set(),
        cleanupTimer: setTimeout(() => { }, 1),
    };
    clearTimeout(snapshot.cleanupTimer);
    snapshot.cleanupTimer = setTimeout(() => {
        if (snapshots.get(key) === snapshot)
            snapshots.delete(key);
    }, SNAPSHOT_RETENTION_MS);
    snapshot.cleanupTimer.unref();
    snapshots.set(key, snapshot);
    return snapshot;
}
function isComplete(snapshot) {
    if (snapshot.expectedRealViewerIds.size <= 1)
        return true;
    for (const viewerId of snapshot.expectedRealViewerIds) {
        if (!snapshot.selfReportedViewerIds.has(viewerId))
            return false;
    }
    return true;
}
function releaseWaiters(snapshot) {
    if (!isComplete(snapshot))
        return;
    for (const resolve of snapshot.waiters)
        resolve();
    snapshot.waiters.clear();
}
function waitForPeers(snapshot, waitMs) {
    return __awaiter(this, void 0, void 0, function* () {
        if (isComplete(snapshot) || waitMs <= 0)
            return;
        yield new Promise(resolve => {
            let completed = false;
            const finish = () => {
                if (completed)
                    return;
                completed = true;
                clearTimeout(timer);
                snapshot.waiters.delete(finish);
                resolve();
            };
            const timer = setTimeout(finish, waitMs);
            timer.unref();
            snapshot.waiters.add(finish);
        });
    });
}
/**
 * Builds one server-authoritative settlement roster for every client in a
 * battle. Clients are still allowed to provide score/contribution data, but a
 * locally missing mate can no longer disappear from the result screen.
 */
function mergeMultiSettlementResults(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const viewerId = finiteNumber(input.viewerId, 0);
        let snapshot = snapshots.get(input.key);
        if (!snapshot) {
            snapshot = createSnapshot(input.key, input.participants, input.expectedRealViewerIds);
        }
        else {
            snapshot.participants = mergeParticipants(snapshot.participants, input.participants);
            for (const expectedViewerId of input.expectedRealViewerIds) {
                const normalized = finiteNumber(expectedViewerId, 0);
                if (normalized > 0) {
                    snapshot.expectedRealViewerIds.add(normalized);
                    if (!snapshot.participants.some(participant => participant.viewerId === normalized)) {
                        snapshot.participants.push({ viewerId: normalized, comId: 0 });
                    }
                }
            }
        }
        if (!snapshot.participants.some(participant => participant.viewerId === viewerId)) {
            snapshot.participants.push({ viewerId, comId: 0 });
        }
        if (viewerId > 0 && viewerId < 900000000) {
            snapshot.expectedRealViewerIds.add(viewerId);
        }
        for (const rawResult of Array.isArray(input.mateResults) ? input.mateResults : []) {
            const result = normalizeResult(rawResult);
            if (!result)
                continue;
            const previous = snapshot.results.get(result.viewer_id);
            if (snapshot.selfReportedViewerIds.has(result.viewer_id)) {
                if (previous && previous.com_id === 0 && result.com_id !== 0) {
                    previous.com_id = result.com_id;
                }
                continue;
            }
            snapshot.results.set(result.viewer_id, result);
            if (!snapshot.participants.some(participant => participant.viewerId === result.viewer_id)) {
                snapshot.participants.push({ viewerId: result.viewer_id, comId: result.com_id });
            }
        }
        const existingSelf = snapshot.results.get(viewerId);
        const participant = snapshot.participants.find(candidate => candidate.viewerId === viewerId);
        snapshot.results.set(viewerId, {
            viewer_id: viewerId,
            com_id: (existingSelf === null || existingSelf === void 0 ? void 0 : existingSelf.com_id) || (participant === null || participant === void 0 ? void 0 : participant.comId) || 0,
            score: finiteNumber(input.ownScore, 0),
            contribution_score: finiteNumber(input.ownContributionScore, 0),
        });
        snapshot.selfReportedViewerIds.add(viewerId);
        releaseWaiters(snapshot);
        // Return immediately once every real participant has submitted.  The
        // compatibility delay below is only an upper bound for a missing peer.
        // The repaired CN flow originally used a 1.2 second upper bound.  Keep
        // that compatibility window: complete rosters still return immediately,
        // while a missing peer cannot hold every client for five seconds.
        const waitMs = Math.max(0, Math.min(1200, finiteNumber(input.waitMs, 1200)));
        yield waitForPeers(snapshot, waitMs);
        const synthesizedViewerIds = [];
        const mateResults = [];
        for (const participantEntry of snapshot.participants) {
            if (participantEntry.viewerId === viewerId)
                continue;
            const result = snapshot.results.get(participantEntry.viewerId);
            if (result) {
                mateResults.push(Object.assign(Object.assign({}, result), { com_id: result.com_id || participantEntry.comId || 0 }));
            }
            else {
                synthesizedViewerIds.push(participantEntry.viewerId);
                mateResults.push({
                    viewer_id: participantEntry.viewerId,
                    com_id: participantEntry.comId || 0,
                    score: 0,
                    contribution_score: 0,
                });
            }
        }
        return {
            mateResults,
            synthesizedViewerIds,
            submittedCount: snapshot.selfReportedViewerIds.size,
            expectedCount: snapshot.expectedRealViewerIds.size,
        };
    });
}
exports.mergeMultiSettlementResults = mergeMultiSettlementResults;
function clearMultiSettlementSnapshot(key) {
    const snapshot = snapshots.get(key);
    if (!snapshot)
        return;
    clearTimeout(snapshot.cleanupTimer);
    for (const resolve of snapshot.waiters)
        resolve();
    snapshot.waiters.clear();
    snapshots.delete(key);
}
exports.clearMultiSettlementSnapshot = clearMultiSettlementSnapshot;
