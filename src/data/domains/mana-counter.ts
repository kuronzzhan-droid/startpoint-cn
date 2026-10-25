import { getDb } from "../db"
import { CoalescedDiagnostics } from "../../lib/coalesced-diagnostics"

const maximum = Number.MAX_SAFE_INTEGER
const maximumExact = BigInt(maximum)
const diagnostics = new CoalescedDiagnostics("[MANA-COUNTER-COMPAT]")

export class ManaCounterError extends Error {
    readonly code = "INVALID_MANA_COUNTER"
    constructor(message: string) { super(message); this.name = "ManaCounterError" }
}

export function isManaCounterError(error: unknown): error is ManaCounterError {
    return typeof error === "object" && error !== null
        && (error as { code?: unknown }).code === "INVALID_MANA_COUNTER"
}

interface StoredCounter { value: bigint | number; storageType: string }

function readCounter(playerId: number): StoredCounter {
    if (!Number.isSafeInteger(playerId) || playerId <= 0) throw new ManaCounterError("Invalid Mana counter player.")
    const row = getDb().prepare(`SELECT total_mana_obtained AS value, typeof(total_mana_obtained) AS storageType
        FROM players WHERE id=?`).safeIntegers().get(playerId) as StoredCounter | undefined
    if (!row) throw new ManaCounterError("Mana counter player does not exist.")
    return row
}

function validStorage(row: StoredCounter): boolean {
    return row.storageType === "integer" && typeof row.value === "bigint" && row.value >= BigInt(0)
        || row.storageType === "real" && typeof row.value === "number" && Number.isFinite(row.value)
            && Number.isInteger(row.value) && row.value >= 0
}

function assertStorage(row: StoredCounter): void {
    if (!validStorage(row)) throw new ManaCounterError("Stored Mana counter must be a finite non-negative whole number.")
}

function outsideSafeRange(row: StoredCounter): boolean {
    return typeof row.value === "bigint" ? row.value > maximumExact : row.value > maximum
}

function report(playerId: number, row: StoredCounter, reason: string, amount?: number): void {
    diagnostics.report(`${playerId}:${reason}`, () => `[MANA-COUNTER-COMPAT] ${JSON.stringify({
        playerId, reason, action: "preserve_raw_counter", storageType: row.storageType,
        rawValue: String(row.value), ...(amount === undefined ? {} : { amount }),
    })}`)
}

/** A SET assignment for the caller's same wallet UPDATE. Never writes a projected old value back. */
export function prepareManaCounterIncrementSync(playerId: number, amount: unknown): { sql: string; values: number[] } | null {
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
        throw new ManaCounterError("Mana counter increment must be a non-negative safe integer.")
    }
    if (amount === 0) return null
    const row = readCounter(playerId)
    assertStorage(row)
    if (outsideSafeRange(row)) report(playerId, row, "legacy_outside_safe_range", amount)
    else if (amount > maximum - Number(row.value)) report(playerId, row, "increment_would_exceed_safe_range", amount)
    // The SQL guard rechecks the execution-time cell, including storage type and integrality.
    return { sql: `total_mana_obtained = CASE
        WHEN typeof(total_mana_obtained) IN ('integer','real') AND total_mana_obtained >= 0
            AND total_mana_obtained <= ? - ? AND total_mana_obtained = CAST(total_mana_obtained AS INTEGER)
        THEN total_mana_obtained + ? ELSE total_mana_obtained END`, values: [maximum, amount, amount] }
}

/** Preserve legacy raw cells when a full Player object merely carries its numeric projection back. */
export function allowManaCounterAbsoluteWriteSync(playerId: number, value: unknown): boolean {
    const row = readCounter(playerId)
    if (validStorage(row) && outsideSafeRange(row)
        && typeof value === "number" && value === Number(row.value)) {
        report(playerId, row, "projected_absolute_write")
        return false
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new ManaCounterError("Absolute Mana counter must be a non-negative safe integer.")
    }
    return true
}

/** Compatibility accepts legacy wide INTEGER/REAL whole values without normalizing the persisted cell. */
export function assertManaCounterStorageSync(playerId: number): void {
    assertStorage(readCounter(playerId))
}
