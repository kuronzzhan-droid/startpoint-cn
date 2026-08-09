import { randomBytes } from "crypto"

export interface RandomRecruitment {
    roomNumber: string
    attentionKey: string
    publishedAt: number
    deliveredTo: Map<number, {
        lastDeliveredAt: number
        deliveryCount: number
    }>
    suppressedViewers: Set<number>
}

// The client's multi_attention_lifetime_seconds=30 describes one displayed
// rescue notice, not the lifetime of the host's recruitment state. Once the
// host enables random recruitment it remains active until battle/disband.
const NOTICE_REDELIVERY_MS = Math.max(
    5_000,
    parseInt(process.env.MULTI_RECRUITMENT_LIFETIME_MS || "30000", 10),
)
const NOTICE_REDELIVERY_LIMIT = Math.max(
    1,
    parseInt(process.env.MULTI_RECRUITMENT_REDELIVERY_LIMIT || "20", 10),
)
const STOPPED_NOTICE_GRACE_MS = Math.max(
    30_000,
    parseInt(process.env.MULTI_RECRUITMENT_LIFETIME_MS || "30000", 10),
)

const recruitments = new Map<string, RandomRecruitment>()
const stoppedNoticeViewers = new Map<string, {
    viewers: Set<number>
    expiresAt: number
}>()

export function publishRandomRecruitment(roomNumber: string): RandomRecruitment {
    const now = Date.now()
    stoppedNoticeViewers.delete(roomNumber)

    const existing = recruitments.get(roomNumber)
    if (existing) {
        existing.publishedAt = now
        return existing
    }

    const recruitment: RandomRecruitment = {
        roomNumber,
        attentionKey: `multi-${roomNumber}-${randomBytes(6).toString("hex")}`,
        publishedAt: now,
        deliveredTo: new Map(),
        suppressedViewers: new Set(),
    }
    recruitments.set(roomNumber, recruitment)
    return recruitment
}

export function stopRandomRecruitment(roomNumber: string): void {
    const recruitment = recruitments.get(roomNumber)
    if (recruitment && recruitment.deliveredTo.size > 0) {
        const stoppedNotice = {
            viewers: new Set(recruitment.deliveredTo.keys()),
            expiresAt: Date.now() + STOPPED_NOTICE_GRACE_MS,
        }
        stoppedNoticeViewers.set(roomNumber, stoppedNotice)
        const timer = setTimeout(() => {
            if (stoppedNoticeViewers.get(roomNumber) === stoppedNotice) {
                stoppedNoticeViewers.delete(roomNumber)
            }
        }, STOPPED_NOTICE_GRACE_MS)
        timer.unref()
    }
    recruitments.delete(roomNumber)
}

export function isRandomRecruiting(roomNumber: string): boolean {
    return recruitments.has(roomNumber)
}

export function wasRandomRecruitmentDeliveredTo(roomNumber: string, viewerId: number): boolean {
    return (recruitments.get(roomNumber)?.deliveredTo.has(viewerId) ?? false)
        || (stoppedNoticeViewers.get(roomNumber)?.viewers.has(viewerId) ?? false)
}

export function wasStoppedRandomRecruitmentDeliveredTo(roomNumber: string, viewerId: number): boolean {
    const stoppedNotice = stoppedNoticeViewers.get(roomNumber)
    if (!stoppedNotice) return false
    if (stoppedNotice.expiresAt <= Date.now()) {
        stoppedNoticeViewers.delete(roomNumber)
        return false
    }
    return stoppedNotice.viewers.has(viewerId)
}

export function suppressRandomRecruitmentForViewer(roomNumber: string, viewerId: number): void {
    const recruitment = recruitments.get(roomNumber)
    if (!recruitment) return
    recruitment.suppressedViewers.add(viewerId)
}

export function takeRandomRecruitments(
    viewerId: number,
    limit: number,
    isAvailable: (recruitment: RandomRecruitment) => boolean,
): RandomRecruitment[] {
    if (limit <= 0) return []

    const now = Date.now()
    const selected = [...recruitments.values()]
        .filter(recruitment => !recruitment.suppressedViewers.has(viewerId))
        .filter(recruitment => {
            const delivery = recruitment.deliveredTo.get(viewerId)
            if (!delivery) return true
            return delivery.deliveryCount < NOTICE_REDELIVERY_LIMIT
                && now - delivery.lastDeliveredAt >= NOTICE_REDELIVERY_MS
        })
        .filter(isAvailable)
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, limit)

    for (const recruitment of selected) {
        const delivery = recruitment.deliveredTo.get(viewerId)
        recruitment.deliveredTo.set(viewerId, {
            lastDeliveredAt: now,
            deliveryCount: (delivery?.deliveryCount ?? 0) + 1,
        })
    }
    return selected
}
