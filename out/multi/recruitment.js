"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.takeRandomRecruitments = exports.wasRandomRecruitmentAcceptedBy = exports.validateRandomRecruitmentAttention = exports.acceptRandomRecruitmentForViewer = exports.suppressRandomRecruitmentForViewer = exports.wasStoppedRandomRecruitmentDeliveredTo = exports.wasRandomRecruitmentDeliveredTo = exports.isRandomRecruiting = exports.stopRandomRecruitment = exports.publishRandomRecruitment = void 0;
const crypto_1 = require("crypto");
// The client's multi_attention_lifetime_seconds=30 describes one displayed
// rescue notice, not the lifetime of the host's recruitment state. Once the
// host enables random recruitment it remains active until battle/disband.
const NOTICE_REDELIVERY_MS = Math.max(5000, parseInt(process.env.MULTI_RECRUITMENT_LIFETIME_MS || "30000", 10));
const NOTICE_REDELIVERY_LIMIT = Math.max(1, parseInt(process.env.MULTI_RECRUITMENT_REDELIVERY_LIMIT || "20", 10));
const STOPPED_NOTICE_GRACE_MS = Math.max(30000, parseInt(process.env.MULTI_RECRUITMENT_LIFETIME_MS || "30000", 10));
const recruitments = new Map();
const stoppedNoticeViewers = new Map();
function publishRandomRecruitment(roomNumber) {
    const now = Date.now();
    stoppedNoticeViewers.delete(roomNumber);
    const existing = recruitments.get(roomNumber);
    if (existing) {
        existing.publishedAt = now;
        return existing;
    }
    const recruitment = {
        roomNumber,
        attentionKey: `multi-${roomNumber}-${(0, crypto_1.randomBytes)(6).toString("hex")}`,
        publishedAt: now,
        deliveredTo: new Map(),
        suppressedViewers: new Set(),
        acceptedViewers: new Set(),
    };
    recruitments.set(roomNumber, recruitment);
    return recruitment;
}
exports.publishRandomRecruitment = publishRandomRecruitment;
function stopRandomRecruitment(roomNumber) {
    try {
        // Lazy require avoids a load-time cycle: ai-fill loads the room
        // manager, while this module is loaded by the HTTP/room layer.
        const { cancelAiFallback } = require("./ai-fill");
        cancelAiFallback(roomNumber);
    }
    catch (_a) { }
    const recruitment = recruitments.get(roomNumber);
    if (recruitment && recruitment.deliveredTo.size > 0) {
        const stoppedNotice = {
            viewers: new Set(recruitment.deliveredTo.keys()),
            acceptedViewers: new Set(recruitment.acceptedViewers),
            attentionKey: recruitment.attentionKey,
            expiresAt: Date.now() + STOPPED_NOTICE_GRACE_MS,
        };
        stoppedNoticeViewers.set(roomNumber, stoppedNotice);
        const timer = setTimeout(() => {
            if (stoppedNoticeViewers.get(roomNumber) === stoppedNotice) {
                stoppedNoticeViewers.delete(roomNumber);
            }
        }, STOPPED_NOTICE_GRACE_MS);
        timer.unref();
    }
    recruitments.delete(roomNumber);
}
exports.stopRandomRecruitment = stopRandomRecruitment;
function isRandomRecruiting(roomNumber) {
    return recruitments.has(roomNumber);
}
exports.isRandomRecruiting = isRandomRecruiting;
function wasRandomRecruitmentDeliveredTo(roomNumber, viewerId) {
    var _a, _b, _c, _d;
    return ((_b = (_a = recruitments.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.deliveredTo.has(viewerId)) !== null && _b !== void 0 ? _b : false)
        || ((_d = (_c = stoppedNoticeViewers.get(roomNumber)) === null || _c === void 0 ? void 0 : _c.viewers.has(viewerId)) !== null && _d !== void 0 ? _d : false);
}
exports.wasRandomRecruitmentDeliveredTo = wasRandomRecruitmentDeliveredTo;
function wasStoppedRandomRecruitmentDeliveredTo(roomNumber, viewerId) {
    const stoppedNotice = stoppedNoticeViewers.get(roomNumber);
    if (!stoppedNotice)
        return false;
    if (stoppedNotice.expiresAt <= Date.now()) {
        stoppedNoticeViewers.delete(roomNumber);
        return false;
    }
    return stoppedNotice.viewers.has(viewerId);
}
exports.wasStoppedRandomRecruitmentDeliveredTo = wasStoppedRandomRecruitmentDeliveredTo;
function suppressRandomRecruitmentForViewer(roomNumber, viewerId) {
    const recruitment = recruitments.get(roomNumber);
    if (!recruitment)
        return;
    recruitment.suppressedViewers.add(viewerId);
}
exports.suppressRandomRecruitmentForViewer = suppressRandomRecruitmentForViewer;
function acceptRandomRecruitmentForViewer(roomNumber, viewerId) {
    const recruitment = recruitments.get(roomNumber);
    if (!recruitment || !recruitment.deliveredTo.has(viewerId))
        return false;
    recruitment.acceptedViewers.add(viewerId);
    recruitment.suppressedViewers.add(viewerId);
    return true;
}
exports.acceptRandomRecruitmentForViewer = acceptRandomRecruitmentForViewer;
function validateRandomRecruitmentAttention(roomNumber, viewerId, attentionKey) {
    const recruitment = recruitments.get(roomNumber);
    if (recruitment
        && recruitment.attentionKey === attentionKey
        && recruitment.deliveredTo.has(viewerId)) {
        recruitment.acceptedViewers.add(viewerId);
        recruitment.suppressedViewers.add(viewerId);
        return true;
    }
    const stoppedNotice = stoppedNoticeViewers.get(roomNumber);
    if (!stoppedNotice)
        return false;
    if (stoppedNotice.expiresAt <= Date.now()) {
        stoppedNoticeViewers.delete(roomNumber);
        return false;
    }
    if (stoppedNotice.attentionKey !== attentionKey || !stoppedNotice.viewers.has(viewerId)) {
        return false;
    }
    stoppedNotice.acceptedViewers.add(viewerId);
    return true;
}
exports.validateRandomRecruitmentAttention = validateRandomRecruitmentAttention;
function wasRandomRecruitmentAcceptedBy(roomNumber, viewerId) {
    var _a, _b, _c, _d;
    return (_d = (_b = (_a = recruitments.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.acceptedViewers.has(viewerId)) !== null && _b !== void 0 ? _b : (_c = stoppedNoticeViewers.get(roomNumber)) === null || _c === void 0 ? void 0 : _c.acceptedViewers.has(viewerId)) !== null && _d !== void 0 ? _d : false;
}
exports.wasRandomRecruitmentAcceptedBy = wasRandomRecruitmentAcceptedBy;
function takeRandomRecruitments(viewerId, limit, isAvailable) {
    var _a;
    if (limit <= 0)
        return [];
    const now = Date.now();
    const selected = [...recruitments.values()]
        .filter(recruitment => !recruitment.suppressedViewers.has(viewerId))
        .filter(recruitment => {
        const delivery = recruitment.deliveredTo.get(viewerId);
        if (!delivery)
            return true;
        return delivery.deliveryCount < NOTICE_REDELIVERY_LIMIT
            && now - delivery.lastDeliveredAt >= NOTICE_REDELIVERY_MS;
    })
        .filter(isAvailable)
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, limit);
    for (const recruitment of selected) {
        const delivery = recruitment.deliveredTo.get(viewerId);
        recruitment.deliveredTo.set(viewerId, {
            lastDeliveredAt: now,
            deliveryCount: ((_a = delivery === null || delivery === void 0 ? void 0 : delivery.deliveryCount) !== null && _a !== void 0 ? _a : 0) + 1,
        });
    }
    return selected;
}
exports.takeRandomRecruitments = takeRandomRecruitments;
