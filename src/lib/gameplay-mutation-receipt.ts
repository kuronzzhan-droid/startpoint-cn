import { createHash } from "node:crypto"
import { getDb } from "../data/db"
import { getAccountFromPlayerIdSync } from "../data/domains/player"
import { getPlayerOperationReceiptSync, insertPlayerOperationReceiptSync } from "../data/domains/player-operation-receipt"
import { readGameplayMutationIdentitySync } from "./gameplay-request-identity"

export interface GameplayMutationContext {
    headerToken: unknown
    body: { viewer_id?: unknown; api_count?: unknown }
    accountId: number
}

export interface GameplayMutationRequest {
    requestKey: string
    operation: string
    payloadHash: string
    response?: Record<string, any>
}

interface MutationReceipt {
    version: 1
    operation: string
    payloadHash: string
    response: Record<string, any>
}

const receiptOperation = "gameplay_mutation.v1"

function canonicalPayload(value: unknown): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (Array.isArray(value)) return value.map(canonicalPayload)
    if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
            .map(key => [key, canonicalPayload((value as Record<string, unknown>)[key])]))
    }
    throw new TypeError("Gameplay mutation payload must contain JSON values")
}

/** Read after acquiring the existing writer queue and SQLite transaction. A
 * frozen native login/count identifies one operation across all covered routes;
 * a later login may restart its counter without colliding with old receipts. */
export function readGameplayMutationRequestSync(playerId: number, context: GameplayMutationContext,
    operation: string, payload: unknown): GameplayMutationRequest | null {
    const db = getDb()
    if (!db.inTransaction) throw new Error("Gameplay mutation receipt requires a persistence transaction")
    if (getAccountFromPlayerIdSync(playerId)?.id !== context.accountId) return null
    const identity = readGameplayMutationIdentitySync(db, context.headerToken, context.body, context.accountId)
    if (!identity) return null
    const payloadHash = createHash("sha256").update(JSON.stringify(canonicalPayload(payload))).digest("hex")
    const receipt = getPlayerOperationReceiptSync<MutationReceipt>(playerId, receiptOperation, identity.requestKey)
    if (receipt) {
        const previous = receipt.response
        if (!previous || previous.version !== 1 || typeof previous.operation !== "string" || typeof previous.payloadHash !== "string"
            || !previous.response || typeof previous.response !== "object" || Array.isArray(previous.response)) {
            throw new Error("Invalid gameplay mutation receipt")
        }
        if (previous.operation !== operation || previous.payloadHash !== payloadHash) return null
        return { requestKey: identity.requestKey, operation, payloadHash, response: previous.response }
    }
    if (!identity.isCurrent) return null
    return { requestKey: identity.requestKey, operation, payloadHash }
}

/** Save the complete successful data alongside its debit/grant. Failed business
 * validation is not recorded; thrown errors roll both reward and receipt back. */
export function recordGameplayMutationResponseSync(playerId: number, request: GameplayMutationRequest,
    response: Record<string, any>): void {
    if (!getDb().inTransaction) throw new Error("Gameplay mutation receipt requires a persistence transaction")
    insertPlayerOperationReceiptSync<MutationReceipt>({ playerId, operation: receiptOperation, requestKey: request.requestKey,
        response: { version: 1, operation: request.operation, payloadHash: request.payloadHash, response } })
}
