import { randomUUID, createHash } from "crypto"

export type CommandJson = null | boolean | number | string | CommandJson[] | { [key: string]: CommandJson }

export interface RoomCommandExpectedIdentity {
    roomNumber?: string
    instanceId?: string
    battleSessionId?: string | null
    generation?: number
    sceneEpoch?: number
    version?: number
}

/** Only relative duration crosses the wire; each end owns its monotonic deadline. */
export interface RoomCommandEnvelope {
    protocol: 1
    commandId: string
    kind: string
    payload: CommandJson
    expectedIdentity?: RoomCommandExpectedIdentity
    expectedOwnerEpoch?: string
    timeoutMs: number
}

export interface RoomCommandResult {
    commandId: string
    ownerEpoch: string
    status: "pending" | "completed" | "rejected" | "failed" | "unknown"
    /** False means completed, or definitively rejected before the handler started. */
    outcomeUnknown: boolean
    value?: CommandJson
    code?: string
    reason?: string
}

/** submit resolves on application result, never on a transport send callback. */
export interface RoomCommandTransport {
    readonly ownerEpoch?: string
    submit(command: RoomCommandEnvelope): Promise<RoomCommandResult>
    queryResult(commandId: string): Promise<RoomCommandResult>
}

export class RoomCommandError extends Error {
    constructor(public readonly code: string, message: string,
        public readonly commandId: string, public readonly outcomeUnknown: boolean) {
        super(message)
        this.name = "RoomCommandError"
    }
}

/** IDs cannot be refreshed after retention expiry. Scope is one owner epoch, not durable exactly-once. */
export function createRoomCommandId(issuedAtUnixMs = Date.now()): string {
    if (!Number.isSafeInteger(issuedAtUnixMs) || issuedAtUnixMs < 0) throw new Error("Invalid command issue time")
    return `rc1.${issuedAtUnixMs}.${randomUUID()}`
}

export function roomCommandIssuedAt(commandId: string): number | undefined {
    const match = /^rc1\.(\d{1,16})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(commandId)
    if (!match) return undefined
    const value = Number(match[1])
    return Number.isSafeInteger(value) ? value : undefined
}

/** Strict JSON, with bounded traversal. No getters, prototypes, closures, or silently lost values. */
export function cloneCommandJson<T>(value: T): T {
    let nodes = 0
    const seen = new Set<object>()
    const check = (item: unknown, depth: number): void => {
        if (++nodes > 65536 || depth > 64) throw new Error("Command JSON complexity limit")
        if (item === null || typeof item === "string" || typeof item === "boolean") return
        if (typeof item === "number" && Number.isFinite(item)) return
        if (typeof item !== "object") throw new Error("Command values must be finite JSON")
        if (seen.has(item)) throw new Error("Command JSON cycle")
        seen.add(item)
        if (Array.isArray(item)) {
            if (Reflect.ownKeys(item).length !== item.length + 1) throw new Error("Command array must be dense JSON")
            for (let i = 0; i < item.length; i++) {
                const descriptor = Object.getOwnPropertyDescriptor(item, String(i))
                if (!descriptor || !("value" in descriptor)) throw new Error("Command array accessor")
                check(descriptor.value, depth + 1)
            }
        } else {
            const prototype = Object.getPrototypeOf(item)
            if (prototype !== Object.prototype && prototype !== null) throw new Error("Command object must be plain JSON")
            for (const key of Reflect.ownKeys(item)) {
                if (typeof key !== "string") throw new Error("Command symbol key")
                const descriptor = Object.getOwnPropertyDescriptor(item, key)!
                if (!descriptor.enumerable || !("value" in descriptor)) throw new Error("Command object accessor/non-enumerable")
                check(descriptor.value, depth + 1)
            }
        }
        seen.delete(item)
    }
    check(value, 0)
    return JSON.parse(JSON.stringify(value)) as T
}

export function commandJsonBytes(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), "utf8")
}

export function roomCommandFingerprint(command: RoomCommandEnvelope): string {
    const canonical = (value: unknown): string => {
        if (value === null || typeof value !== "object") return JSON.stringify(value)
        if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
        const item = value as Record<string, unknown>
        return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`
    }
    // A retry's wait budget is not its business identity.
    return createHash("sha256").update(canonical({ kind: command.kind, payload: command.payload,
        expectedIdentity: command.expectedIdentity ?? null })).digest("hex")
}
