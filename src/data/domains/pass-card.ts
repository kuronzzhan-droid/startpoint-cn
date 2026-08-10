import { getDb } from "../db"

export interface PlayerPassCardState {
    eventId: number
    point: number
    isBuy: boolean
    loginBaseline?: number
}

export interface PlayerPassCardRewardRecord {
    rewardId: number
    isReceived1: number
    isReceived2: number
}

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`)
    }
    return value
}

function storedBoolean(value: unknown, name: string): boolean {
    if (value !== 0 && value !== 1) {
        throw new TypeError(`${name} must be stored as 0 or 1`)
    }
    return value === 1
}

export function getPlayerPassCardStateSync(
    playerId: number,
    eventId: number,
): PlayerPassCardState {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validEventId = positiveSafeInteger(eventId, "eventId")
    const row = getDb().prepare(`
        SELECT event_id, point, is_buy, login_baseline
        FROM players_pass_cards
        WHERE player_id = ? AND event_id = ?
    `).get(validPlayerId, validEventId) as {
        event_id: unknown
        point: unknown
        is_buy: unknown
        login_baseline: unknown
    } | undefined
    if (row === undefined) return { eventId: validEventId, point: 0, isBuy: false }

    positiveSafeInteger(row.event_id, "stored eventId")
    const state: PlayerPassCardState = {
        eventId: validEventId,
        point: nonNegativeSafeInteger(row.point, "stored point"),
        isBuy: storedBoolean(row.is_buy, "stored isBuy"),
    }
    if (row.login_baseline !== null) {
        state.loginBaseline = nonNegativeSafeInteger(row.login_baseline, "stored loginBaseline")
    }
    return state
}

export function ensurePlayerPassCardLoginProgressSync(
    playerId: number,
    eventId: number,
    totalLoginDays: number,
): number {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validEventId = positiveSafeInteger(eventId, "eventId")
    const validLoginDays = nonNegativeSafeInteger(totalLoginDays, "totalLoginDays")
    const initialBaseline = Math.max(0, validLoginDays - 1)
    const row = getDb().prepare(`
        INSERT INTO players_pass_cards (player_id, event_id, point, is_buy, login_baseline)
        VALUES (?, ?, 0, 0, ?)
        ON CONFLICT(player_id, event_id) DO UPDATE SET
            login_baseline = COALESCE(login_baseline, excluded.login_baseline)
        RETURNING login_baseline
    `).get(validPlayerId, validEventId, initialBaseline) as { login_baseline: unknown } | undefined
    if (row === undefined) throw new Error("pass-card login baseline write returned no row")
    const baseline = nonNegativeSafeInteger(row.login_baseline, "stored loginBaseline")
    return Math.max(0, validLoginDays - baseline)
}

export function addPlayerPassCardPointSync(
    playerId: number,
    eventId: number,
    amount: number,
    maxPoint: number = Number.MAX_SAFE_INTEGER,
): number {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validEventId = positiveSafeInteger(eventId, "eventId")
    const validAmount = nonNegativeSafeInteger(amount, "amount")
    const validMaxPoint = nonNegativeSafeInteger(maxPoint, "maxPoint")
    const cappedAmount = Math.min(validAmount, validMaxPoint)
    const row = getDb().prepare(`
        INSERT INTO players_pass_cards (player_id, event_id, point, is_buy, login_baseline)
        VALUES (?, ?, ?, 0, NULL)
        ON CONFLICT(player_id, event_id) DO UPDATE SET point = CASE
            WHEN point >= ? THEN point
            WHEN excluded.point > ? - point THEN ?
            ELSE point + excluded.point
        END
        WHERE typeof(point) = 'integer'
          AND point BETWEEN 0 AND ?
        RETURNING point
    `).get(
        validPlayerId,
        validEventId,
        cappedAmount,
        validMaxPoint,
        validMaxPoint,
        validMaxPoint,
        Number.MAX_SAFE_INTEGER,
    ) as { point: unknown } | undefined
    if (row === undefined) {
        throw new RangeError("pass-card point cannot be updated safely")
    }
    return nonNegativeSafeInteger(row.point, "stored point")
}

export function getPlayerPassCardRewardRecordsSync(
    playerId: number,
    eventId: number,
): PlayerPassCardRewardRecord[] {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validEventId = positiveSafeInteger(eventId, "eventId")
    const rows = getDb().prepare(`
        SELECT reward_id, is_received_1, is_received_2
        FROM players_pass_card_rewards
        WHERE player_id = ? AND event_id = ?
        ORDER BY reward_id
    `).all(validPlayerId, validEventId) as Array<{
        reward_id: unknown
        is_received_1: unknown
        is_received_2: unknown
    }>
    return rows.map(row => ({
        rewardId: positiveSafeInteger(row.reward_id, "stored rewardId"),
        isReceived1: storedBoolean(row.is_received_1, "stored isReceived1") ? 1 : 0,
        isReceived2: storedBoolean(row.is_received_2, "stored isReceived2") ? 1 : 0,
    }))
}

export function setPlayerPassCardRewardReceivedSync(
    playerId: number,
    eventId: number,
    rewardId: number,
    receive1: boolean,
    receive2: boolean,
): void {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validEventId = positiveSafeInteger(eventId, "eventId")
    const validRewardId = positiveSafeInteger(rewardId, "rewardId")
    if (typeof receive1 !== "boolean" || typeof receive2 !== "boolean") {
        throw new TypeError("reward receipt flags must be booleans")
    }
    const result = getDb().prepare(`
        INSERT INTO players_pass_card_rewards (
            player_id, event_id, reward_id, is_received_1, is_received_2
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(player_id, event_id, reward_id) DO UPDATE SET
            is_received_1 = MAX(is_received_1, excluded.is_received_1),
            is_received_2 = MAX(is_received_2, excluded.is_received_2)
        WHERE is_received_1 IN (0, 1) AND is_received_2 IN (0, 1)
    `).run(
        validPlayerId,
        validEventId,
        validRewardId,
        receive1 ? 1 : 0,
        receive2 ? 1 : 0,
    )
    if (result.changes !== 1) {
        throw new TypeError("stored reward receipt flags are invalid")
    }
}
