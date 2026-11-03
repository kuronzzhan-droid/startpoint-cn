import { getDb } from "../db"

export interface PlayerOperationReceipt<T = unknown> {
    playerId: number
    operation: string
    requestKey: string
    response: T
}

interface RawPlayerOperationReceipt {
    player_id: number
    operation: string
    request_key: string
    response_json: string
}

export function getPlayerOperationReceiptSync<T = unknown>(
    playerId: number,
    operation: string,
    requestKey: string,
): PlayerOperationReceipt<T> | null {
    const row = getDb().prepare(`
        SELECT player_id, operation, request_key, response_json
        FROM player_operation_receipts
        WHERE player_id = ? AND operation = ? AND request_key = ?
    `).get(playerId, operation, requestKey) as RawPlayerOperationReceipt | undefined
    if (!row) return null
    try {
        return {
            playerId: row.player_id,
            operation: row.operation,
            requestKey: row.request_key,
            response: JSON.parse(row.response_json) as T,
        }
    } catch {
        throw new Error(`持久化请求回执损坏：${operation}/${requestKey}`)
    }
}

export function insertPlayerOperationReceiptSync<T>(
    receipt: PlayerOperationReceipt<T>,
    createdAtMs = Date.now(),
): void {
    if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) throw new TypeError("Invalid receipt creation time.")
    const responseJson = JSON.stringify(receipt.response)
    if (responseJson === undefined) throw new Error(`持久化请求回执不可序列化：${receipt.operation}`)
    getDb().prepare(`
        INSERT INTO player_operation_receipts (
            player_id, operation, request_key, response_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
    `).run(
        receipt.playerId,
        receipt.operation,
        receipt.requestKey,
        responseJson,
        createdAtMs,
    )
}
