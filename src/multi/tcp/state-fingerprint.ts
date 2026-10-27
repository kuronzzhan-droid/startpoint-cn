import * as fs from "fs"
import * as path from "path"
import type * as net from "net"
import { performance } from "node:perf_hooks"
import { sessionManager, type SessionClient } from "../state/SessionManager"
import { getRoom } from "../room/manager"
import { ensureBattleSessionContract, getBattleSessionContract } from "../state/battle-contract"
import type { MultiRoom } from "../types"
import {
    StateFingerprintComparator,
    canonicalJson,
    computeStateGroupHashes,
    type CompactInputSummary,
    type CompactRouteSummary,
    type DesyncFirstReport,
    type FrozenObserverMember,
    type NormalizedEventEntry,
    type NormalizedGapEntry,
    type NormalizedInputEntry,
    type ReconstructedFrameObservation,
    type RunBucketIdentity,
    type UnsupportedFieldEntry,
} from "./state-fingerprint-compare"

export { canonicalJson, computeStateGroupHashes }

export const FINGERPRINT_KIND = "wf-fp"
export const FINGERPRINT_VERSION = 1
export const FINGERPRINT_SCHEMA = "coop-state-fingerprint-v1"
export const FINGERPRINT_COMPACT_V2_SCHEMA = "coop-state-fingerprint-compact-v2"
export type FingerprintSchema = typeof FINGERPRINT_SCHEMA | typeof FINGERPRINT_COMPACT_V2_SCHEMA
export const ALLOWED_FINGERPRINT_SCHEMAS = new Set<string>([
    FINGERPRINT_SCHEMA,
    FINGERPRINT_COMPACT_V2_SCHEMA,
])

export const MAX_PHYSICAL_PACKET_BYTES = 16384
export const MAX_LOGICAL_BATCH_BYTES = 4194304
export const MAX_BUILD_UTF8_BYTES = 128
export const MAX_PARTS = 512
export const MAX_PENDING_SEQS = 512
export const FRAGMENT_WAIT_TIMEOUT_MS = 5000
export const DEFAULT_MAX_REASSEMBLY_TOTAL_MS = 300000
export const COMPACT_V2_CLIENT_RATE_BYTES_PER_SEC = 20000
export const MAX_VALUE_TREE_DEPTH = 64

export const DEFAULT_RATE_BYTES_PER_SEC = 65536
export const DEFAULT_BUCKET_CAPACITY_BYTES = 16384
export const DEFAULT_BUFFER_LIMIT_BYTES = 4194304

const ALLOWED_UNSUPPORTED_REASONS = new Set([
    "rng_type",
    "enum_variant",
    "field_shape",
    "address_shape",
    "read_error",
])

const ALLOWED_EVENT_STAGES = new Set([
    "route_received",
    "route_decoded",
    "route_rejected",
    "speed_received",
    "speed_applied",
    "lifecycle",
])

const ALLOWED_EVENT_DETAIL_KEYS = new Set([
    "reason",
    "wire",
    "speed",
    "length",
    "targetOtherBattleId",
    "frame",
    "state",
    "previousInterval",
    "interval",
    "elapsedMs",
])

const ALLOWED_GAP_REASONS = new Set([
    "buffer_overflow",
    "oversize",
    "initial_missing",
    "sampling_error",
    "sequence_loss",
    "fragment_loss",
    "event_loss",
    "disabled",
    "connection_closed",
    "epoch_end",
])

const F64_WIRE_REGEX = /^f64:[0-9a-f]{16}$/
const UNPAIRED_SURROGATE_REGEX = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

export function getFingerprintOutputDir(env: NodeJS.ProcessEnv = process.env): string {
    return (env.MULTI_FINGERPRINT_DIR ?? "").trim()
}

export function isStateFingerprintEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return getFingerprintOutputDir(env).length > 0
}

/**
 * Any BattleNotifyMessage tag 5 with extra payload elements (`[5, P]`) is treated
 * as a fingerprint/extended heartbeat marker: it must NEVER fall back to normal
 * Heartbeat ACK or be relayed to peers.
 */
export function isStateFingerprintNotify(notify: unknown): boolean {
    return Array.isArray(notify) && notify[0] === 5 && notify.length > 1
}

export function isStateFingerprintPacket(packet: unknown): boolean {
    return Array.isArray(packet) && packet.length === 2 && packet[0] === 0 && isStateFingerprintNotify(packet[1])
}

export function sanitizeRunFilenamePart(runId: string): string {
    const cleaned = String(runId).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
    return cleaned || "run"
}

export function isI32(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
}

export function isU32(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4294967295
}

export function isNInt(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

/**
 * Strict JSON parser that rejects duplicate object keys at any nesting depth.
 */
export function parseUniqueJson(text: string): unknown {
    if (typeof text !== "string") throw new Error("JSON input must be a string")
    const parsed = JSON.parse(text)
    type Frame = { type: "object"; keys: Set<string>; expectingKey: boolean } | { type: "array" }
    const stack: Frame[] = []
    const len = text.length
    let i = 0
    while (i < len) {
        const ch = text[i]
        if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
            i++
            continue
        }
        if (ch === "{") {
            stack.push({ type: "object", keys: new Set<string>(), expectingKey: true })
            i++
            continue
        }
        if (ch === "}") {
            stack.pop()
            i++
            continue
        }
        if (ch === "[") {
            stack.push({ type: "array" })
            i++
            continue
        }
        if (ch === "]") {
            stack.pop()
            i++
            continue
        }
        if (ch === ":") {
            i++
            continue
        }
        if (ch === ",") {
            const top = stack[stack.length - 1]
            if (top && top.type === "object") top.expectingKey = true
            i++
            continue
        }
        if (ch === '"') {
            const start = i
            i++
            while (i < len) {
                const c = text[i]
                if (c === "\\") {
                    i += 2
                    continue
                }
                if (c === '"') {
                    i++
                    break
                }
                i++
            }
            const top = stack[stack.length - 1]
            if (top && top.type === "object" && top.expectingKey) {
                const key = JSON.parse(text.slice(start, i)) as string
                if (top.keys.has(key)) {
                    throw new Error(`duplicate object key: ${key}`)
                }
                top.keys.add(key)
                top.expectingKey = false
            }
            continue
        }
        while (i < len && !" \t\r\n,}:]".includes(text[i])) i++
    }
    return parsed
}

export function decodeF64Bits(wire: string): {
    wire: string
    bigEndianHex: string
    bytes: Buffer
    float64: number
} {
    if (typeof wire !== "string" || !F64_WIRE_REGEX.test(wire)) {
        throw new Error(`invalid f64 wire value: ${String(wire)}`)
    }
    const bigEndianHex = wire.slice(4)
    const bytes = Buffer.from(bigEndianHex, "hex")
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8)
    const float64 = view.getFloat64(0, false)
    return { wire, bigEndianHex, bytes, float64 }
}

export function encodeF64Bits(value: number | Uint8Array | Buffer): string {
    const bytes = Buffer.alloc(8)
    if (typeof value === "number") {
        const view = new DataView(bytes.buffer, bytes.byteOffset, 8)
        view.setFloat64(0, value, false)
    } else {
        if (value.byteLength !== 8) throw new Error("f64 byte buffer must be 8 bytes")
        Buffer.from(value.buffer, value.byteOffset, 8).copy(bytes)
    }
    return `f64:${bytes.toString("hex")}`
}

export function validateValueTree(value: unknown, depth = 0): void {
    if (depth > MAX_VALUE_TREE_DEPTH) {
        throw new Error(`value tree exceeded max depth ${MAX_VALUE_TREE_DEPTH}`)
    }
    if (value === null || typeof value === "boolean") return
    if (typeof value === "number") {
        if (!isI32(value)) {
            throw new Error(`invalid numeric value in value tree (bare float or out-of-range i32): ${value}`)
        }
        return
    }
    if (typeof value === "string") {
        if (value.startsWith("f64:") && !F64_WIRE_REGEX.test(value)) {
            throw new Error(`invalid f64 string: ${value}`)
        }
        return
    }
    if (Array.isArray(value)) {
        for (const item of value) validateValueTree(item, depth + 1)
        return
    }
    if (isPlainObject(value)) {
        for (const v of Object.values(value)) validateValueTree(v, depth + 1)
        return
    }
    throw new Error(`unsupported value type in value tree: ${typeof value}`)
}

export function validateEnumValue(value: unknown, depth = 0): value is unknown[] {
    if (!Array.isArray(value) || value.length < 1 || !isI32(value[0])) {
        throw new Error("enum value must be [index:i32, ...params]")
    }
    validateValueTree(value, depth)
    return true
}

export function computeCompactSetDigest(
    records: string[],
    includeEntries = false,
): { count: number; hash: string; entries?: string[] } {
    const ordered = [...records].sort()
    const joined = ordered.join("\n")
    let a = 5381 | 0
    let b = 0 | 0
    for (let i = 0; i < joined.length; i++) {
        const c = joined.charCodeAt(i)
        a = (Math.imul(a, 33) ^ c) | 0
        b = (Math.imul(b, 65599) + c) | 0
    }
    const result: { count: number; hash: string; entries?: string[] } = {
        count: ordered.length,
        hash: `d32:${a >>> 0}:${b >>> 0}`,
    }
    if (includeEntries && ordered.length <= 4) {
        result.entries = ordered
    }
    return result
}

export function computeCompactSummaryHash(prevHash: number, value: string | number | null): number {
    const text = value === null ? "null" : typeof value === "string" ? `s:${value}` : `n:${String(value)}`
    let h = (Math.imul(prevHash | 0, 31) ^ text.length) | 0
    for (let i = 0; i < text.length; i++) {
        h = (Math.imul(h, 31) ^ text.charCodeAt(i)) | 0
    }
    return h
}

export function peekPacketSchema(rawOrParsed: string | unknown): FingerprintSchema {
    if (typeof rawOrParsed === "string") {
        if (rawOrParsed.includes(FINGERPRINT_COMPACT_V2_SCHEMA)) {
            return FINGERPRINT_COMPACT_V2_SCHEMA
        }
        return FINGERPRINT_SCHEMA
    }
    if (Array.isArray(rawOrParsed) && Array.isArray(rawOrParsed[1]) && isPlainObject(rawOrParsed[1][1])) {
        if (rawOrParsed[1][1].schema === FINGERPRINT_COMPACT_V2_SCHEMA) {
            return FINGERPRINT_COMPACT_V2_SCHEMA
        }
    }
    return FINGERPRINT_SCHEMA
}

export interface ValidatedPacketEnvelope {
    kind: "wf-fp"
    v: 1
    schema: FingerprintSchema
    build: string
    epoch: number
    seq: number
    part: number
    parts: number
    rows?: unknown[]
    events?: unknown[]
    gaps?: unknown[]
    chunk?: string
    physicalBytes: number
}

export function validateFingerprintPacket(rawOrParsed: string | unknown): ValidatedPacketEnvelope {
    let parsed: unknown
    let physicalBytes: number
    if (typeof rawOrParsed === "string") {
        physicalBytes = Buffer.byteLength(rawOrParsed, "utf8") + 1
        if (physicalBytes > MAX_PHYSICAL_PACKET_BYTES) {
            const err = new Error(`physical packet exceeded ${MAX_PHYSICAL_PACKET_BYTES} bytes (${physicalBytes})`)
            ;(err as Error & { reason?: string }).reason = "oversize"
            throw err
        }
        parsed = parseUniqueJson(rawOrParsed)
    } else {
        parsed = rawOrParsed
        const compact = JSON.stringify(parsed)
        physicalBytes = Buffer.byteLength(compact ?? "", "utf8") + 1
        if (physicalBytes > MAX_PHYSICAL_PACKET_BYTES) {
            const err = new Error(`physical packet exceeded ${MAX_PHYSICAL_PACKET_BYTES} bytes (${physicalBytes})`)
            ;(err as Error & { reason?: string }).reason = "oversize"
            throw err
        }
    }

    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== 0) {
        throw new Error("outer packet must be [0, [5, P]]")
    }
    const notify = parsed[1]
    if (!Array.isArray(notify) || notify.length !== 2 || notify[0] !== 5) {
        throw new Error("inner notify must be [5, P]")
    }
    const p = notify[1]
    if (!isPlainObject(p)) {
        throw new Error("payload P must be a plain object")
    }
    if (p.kind !== FINGERPRINT_KIND) {
        throw new Error(`unsupported kind: ${String(p.kind)}`)
    }
    if (p.v !== FINGERPRINT_VERSION) {
        throw new Error(`unsupported version: ${String(p.v)}`)
    }
    if (typeof p.schema !== "string" || !ALLOWED_FINGERPRINT_SCHEMAS.has(p.schema)) {
        throw new Error(`unsupported schema: ${String(p.schema)}`)
    }
    const schema = p.schema as FingerprintSchema
    if (typeof p.build !== "string" || p.build.length === 0 || Buffer.byteLength(p.build, "utf8") > MAX_BUILD_UTF8_BYTES) {
        throw new Error("invalid build identifier")
    }
    if (!isNInt(p.epoch)) {
        throw new Error("invalid epoch")
    }
    if (!isNInt(p.seq)) {
        throw new Error("invalid seq")
    }
    if (!isNInt(p.part) || !isNInt(p.parts) || p.parts < 1 || p.parts > MAX_PARTS || p.part >= p.parts) {
        throw new Error("invalid part/parts")
    }

    const keys = Object.keys(p)
    if (p.parts === 1) {
        if (p.part !== 0 || "chunk" in p) {
            throw new Error("unfragmented packet must have part=0 and no chunk")
        }
        const allowed = new Set(["kind", "v", "schema", "build", "epoch", "seq", "part", "parts", "rows", "events", "gaps"])
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("invalid envelope keys for parts=1")
        }
        if (!Array.isArray(p.rows) || !Array.isArray(p.events) || !Array.isArray(p.gaps)) {
            throw new Error("rows, events, and gaps must be arrays")
        }
        return {
            kind: FINGERPRINT_KIND,
            v: FINGERPRINT_VERSION,
            schema,
            build: p.build,
            epoch: p.epoch,
            seq: p.seq,
            part: p.part,
            parts: p.parts,
            rows: p.rows,
            events: p.events,
            gaps: p.gaps,
            physicalBytes,
        }
    } else {
        if ("rows" in p || "events" in p || "gaps" in p) {
            throw new Error("fragment packet must not contain rows/events/gaps")
        }
        const allowed = new Set(["kind", "v", "schema", "build", "epoch", "seq", "part", "parts", "chunk"])
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("invalid envelope keys for parts>1")
        }
        if (typeof p.chunk !== "string" || p.chunk.length === 0) {
            throw new Error("fragment chunk must be a non-empty string")
        }
        if (UNPAIRED_SURROGATE_REGEX.test(p.chunk)) {
            throw new Error("fragment chunk split a UTF-16 surrogate pair")
        }
        return {
            kind: FINGERPRINT_KIND,
            v: FINGERPRINT_VERSION,
            schema,
            build: p.build,
            epoch: p.epoch,
            seq: p.seq,
            part: p.part,
            parts: p.parts,
            chunk: p.chunk,
            physicalBytes,
        }
    }
}

export interface LogicalBatchPayload {
    rows: unknown[]
    events: unknown[]
    gaps: unknown[]
}

export function validateLogicalBatchObject(raw: unknown): LogicalBatchPayload {
    if (!isPlainObject(raw)) {
        throw new Error("logical batch L must be an object")
    }
    const keys = Object.keys(raw)
    const allowed = new Set(["rows", "events", "gaps"])
    if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
        throw new Error("logical batch L must have exact keys rows, events, gaps")
    }
    if (!Array.isArray(raw.rows) || !Array.isArray(raw.events) || !Array.isArray(raw.gaps)) {
        throw new Error("logical batch rows, events, gaps must be arrays")
    }
    return {
        rows: raw.rows,
        events: raw.events,
        gaps: raw.gaps,
    }
}

/**
 * Reassembles a fragmented logical batch L from an array of fragment envelopes or packets.
 * Deduplicates identical duplicate parts, rejects conflicting duplicates, checks missing parts,
 * verifies <= 4 MiB UTF-8 byte limit, and parses with duplicate-key rejection.
 */
export function reassembleFragments(packets: Array<ValidatedPacketEnvelope | string | unknown>): LogicalBatchPayload {
    if (!Array.isArray(packets) || packets.length === 0) {
        throw new Error("no packets provided for reassembly")
    }
    const validated: ValidatedPacketEnvelope[] = packets.map(pkt => {
        if (isPlainObject(pkt) && pkt.kind === FINGERPRINT_KIND && typeof pkt.physicalBytes === "number") {
            return pkt as unknown as ValidatedPacketEnvelope
        }
        if (isPlainObject(pkt) && pkt.kind === FINGERPRINT_KIND) {
            return validateFingerprintPacket([0, [5, pkt]])
        }
        return validateFingerprintPacket(pkt)
    })

    const first = validated[0]
    if (first.parts === 1) {
        for (const p of validated) {
            if (p.schema !== first.schema || p.build !== first.build || p.epoch !== first.epoch || p.seq !== first.seq || p.parts !== 1 || p.part !== 0) {
                throw new Error("conflicting envelope metadata")
            }
            if (canonicalJson({ rows: p.rows, events: p.events, gaps: p.gaps }) !==
                canonicalJson({ rows: first.rows, events: first.events, gaps: first.gaps })) {
                throw new Error("conflicting duplicate")
            }
        }
        return { rows: first.rows!, events: first.events!, gaps: first.gaps! }
    }

    const cache = new Map<number, string>()
    for (const p of validated) {
        if (p.schema !== first.schema || p.build !== first.build || p.epoch !== first.epoch || p.seq !== first.seq || p.parts !== first.parts) {
            throw new Error("conflicting envelope metadata")
        }
        if (cache.has(p.part)) {
            if (cache.get(p.part) !== p.chunk) {
                throw new Error("conflicting duplicate")
            }
            continue
        }
        cache.set(p.part, p.chunk!)
    }
    if (cache.size !== first.parts) {
        throw new Error("missing fragment")
    }
    const chunks: string[] = []
    for (let i = 0; i < first.parts; i++) {
        const ch = cache.get(i)
        if (ch === undefined) throw new Error("missing fragment")
        chunks.push(ch)
    }
    const text = chunks.join("")
    if (Buffer.byteLength(text, "utf8") > MAX_LOGICAL_BATCH_BYTES) {
        throw new Error("reassembled logical batch exceeded 4MiB")
    }
    return validateLogicalBatchObject(parseUniqueJson(text))
}

export function validateUnsupportedArray(raw: unknown): UnsupportedFieldEntry[] {
    if (!Array.isArray(raw)) throw new Error("unsupported must be an array")
    const out: UnsupportedFieldEntry[] = []
    let prevPath = ""
    for (const item of raw) {
        if (!isPlainObject(item) || Object.keys(item).length !== 2) {
            throw new Error("unsupported item must have {path, reason}")
        }
        const p = item.path
        const r = item.reason
        if (typeof p !== "string" || !p.startsWith("/")) {
            throw new Error(`invalid unsupported path: ${String(p)}`)
        }
        if (typeof r !== "string" || !ALLOWED_UNSUPPORTED_REASONS.has(r)) {
            throw new Error(`invalid unsupported reason: ${String(r)}`)
        }
        if (out.length > 0 && p < prevPath) {
            throw new Error("unsupported array must be sorted by path")
        }
        prevPath = p
        out.push({ path: p, reason: r as UnsupportedFieldEntry["reason"] })
    }
    return out
}

export function validateInputsArray(
    raw: unknown,
    battleId: string,
    battleEpoch: number,
    postFrame: number,
    unsupported: UnsupportedFieldEntry[],
): NormalizedInputEntry[] {
    if (!Array.isArray(raw)) throw new Error("inputs must be an array")
    const unsupportedPaths = new Set(unsupported.map(u => u.path))
    const out: NormalizedInputEntry[] = []
    for (let ordinal = 0; ordinal < raw.length; ordinal++) {
        const item = raw[ordinal]
        if (!isPlainObject(item)) throw new Error("input entry must be an object")
        const keys = Object.keys(item)
        const allowed = new Set([
            "ordinal",
            "kind",
            "sourceBattleId",
            "sourceBattleEpoch",
            "sourceFrame",
            "targetBattleId",
            "battleEpoch",
            "applyTargetFrame",
            "command",
        ])
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("input entry has invalid keys")
        }
        if (item.ordinal !== ordinal) {
            throw new Error(`input ordinal mismatch: expected ${ordinal}, got ${String(item.ordinal)}`)
        }
        if (item.kind !== "User" && item.kind !== "Coop") {
            throw new Error(`invalid input kind: ${String(item.kind)}`)
        }
        if (typeof item.sourceBattleId !== "string" || item.sourceBattleId.length === 0) {
            throw new Error("invalid input sourceBattleId")
        }
        if (item.kind === "User" && item.sourceBattleId !== battleId) {
            throw new Error("User input sourceBattleId must equal targetBattleId")
        }
        if (item.sourceBattleEpoch !== null && !isNInt(item.sourceBattleEpoch)) {
            throw new Error("invalid input sourceBattleEpoch")
        }
        if (item.sourceFrame !== null && !isI32(item.sourceFrame)) {
            throw new Error("invalid input sourceFrame")
        }
        if (item.targetBattleId !== battleId) {
            throw new Error("input targetBattleId must equal row.battleId")
        }
        if (item.battleEpoch !== battleEpoch) {
            throw new Error("input battleEpoch must equal row.battleEpoch")
        }
        if (item.applyTargetFrame !== postFrame - 1) {
            throw new Error("input applyTargetFrame must equal row.postFrame - 1")
        }
        if (item.command === null) {
            if (!unsupportedPaths.has(`/inputs/${ordinal}/command`)) {
                throw new Error(`null input command at ordinal ${ordinal} must be listed in row.unsupported`)
            }
        } else {
            validateEnumValue(item.command)
        }
        out.push({
            ordinal,
            kind: item.kind,
            sourceBattleId: item.sourceBattleId,
            sourceBattleEpoch: item.sourceBattleEpoch as number | null,
            sourceFrame: item.sourceFrame as number | null,
            targetBattleId: item.targetBattleId,
            battleEpoch: item.battleEpoch,
            applyTargetFrame: item.applyTargetFrame,
            command: item.command as unknown[] | null,
        })
    }
    return out
}

export function validateEventEntry(raw: unknown): NormalizedEventEntry {
    if (!isPlainObject(raw)) throw new Error("event entry must be an object")
    const keys = Object.keys(raw)
    const allowed = new Set([
        "eventId",
        "stage",
        "battleId",
        "battleEpoch",
        "targetFrame",
        "sourceBattleId",
        "sourceBattleEpoch",
        "sourceFrame",
        "command",
        "detail",
    ])
    if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
        throw new Error("event entry has invalid keys")
    }
    if (!isNInt(raw.eventId)) throw new Error("invalid eventId")
    if (typeof raw.stage !== "string" || !ALLOWED_EVENT_STAGES.has(raw.stage)) {
        throw new Error(`invalid event stage: ${String(raw.stage)}`)
    }
    if (raw.battleId !== null && (typeof raw.battleId !== "string" || raw.battleId.length === 0)) {
        throw new Error("invalid event battleId")
    }
    if (raw.battleEpoch !== null && !isNInt(raw.battleEpoch)) {
        throw new Error("invalid event battleEpoch")
    }
    if (raw.targetFrame !== null && !isNInt(raw.targetFrame)) {
        throw new Error("invalid event targetFrame")
    }
    if (raw.stage === "speed_applied" && raw.targetFrame === null) {
        throw new Error("speed_applied event requires non-null targetFrame")
    }
    if (raw.sourceBattleId !== null && (typeof raw.sourceBattleId !== "string" || raw.sourceBattleId.length === 0)) {
        throw new Error("invalid event sourceBattleId")
    }
    if (raw.sourceBattleEpoch !== null && !isNInt(raw.sourceBattleEpoch)) {
        throw new Error("invalid event sourceBattleEpoch")
    }
    if (raw.sourceFrame !== null && !isI32(raw.sourceFrame)) {
        throw new Error("invalid event sourceFrame")
    }
    if (raw.command !== null) {
        validateEnumValue(raw.command)
    }
    if (!isPlainObject(raw.detail)) {
        throw new Error("event detail must be a plain object")
    }
    for (const [dk, dv] of Object.entries(raw.detail)) {
        if (!ALLOWED_EVENT_DETAIL_KEYS.has(dk)) {
            throw new Error(`disallowed event detail key: ${dk}`)
        }
        if ((dk === "reason" || dk === "wire" || dk === "targetOtherBattleId") && typeof dv !== "string") {
            throw new Error(`event detail ${dk} must be string`)
        }
        if ((dk === "speed" || dk === "frame" || dk === "state" || dk === "previousInterval" || dk === "interval" || dk === "elapsedMs") && !isI32(dv)) {
            throw new Error(`event detail ${dk} must be i32`)
        }
        if (dk === "length" && !isI32(dv) && !isNInt(dv)) {
            throw new Error("event detail length must be i32 or nint")
        }
    }
    return {
        eventId: raw.eventId,
        stage: raw.stage as NormalizedEventEntry["stage"],
        battleId: raw.battleId as string | null,
        battleEpoch: raw.battleEpoch as number | null,
        targetFrame: raw.targetFrame as number | null,
        sourceBattleId: raw.sourceBattleId as string | null,
        sourceBattleEpoch: raw.sourceBattleEpoch as number | null,
        sourceFrame: raw.sourceFrame as number | null,
        command: raw.command as unknown[] | null,
        detail: { ...raw.detail },
    }
}

export function validateCompactInputSummary(raw: unknown): CompactInputSummary {
    if (!isPlainObject(raw)) {
        throw new Error("row.inputSummary must be a plain object")
    }
    const allowed = new Set([
        "count",
        "user",
        "coop",
        "unknown",
        "readErrors",
        "kinds",
        "orderedHash",
        "firstFrame",
        "lastFrame",
        "coverage",
    ])
    const keys = Object.keys(raw)
    if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
        throw new Error("row.inputSummary has invalid keys")
    }
    for (const ck of ["count", "user", "coop", "unknown", "readErrors"] as const) {
        if (!isNInt(raw[ck]) || !isI32(raw[ck])) {
            throw new Error(`row.inputSummary.${ck} must be non-negative i32`)
        }
    }
    if (!isI32(raw.orderedHash)) {
        throw new Error("row.inputSummary.orderedHash must be i32")
    }
    if (raw.firstFrame !== null && !isI32(raw.firstFrame)) {
        throw new Error("row.inputSummary.firstFrame must be i32 or null")
    }
    if (raw.lastFrame !== null && !isI32(raw.lastFrame)) {
        throw new Error("row.inputSummary.lastFrame must be i32 or null")
    }
    if (raw.coverage !== "top_level_only") {
        throw new Error(`invalid row.inputSummary.coverage: ${String(raw.coverage)}`)
    }
    if (!isPlainObject(raw.kinds)) {
        throw new Error("row.inputSummary.kinds must be a plain object")
    }
    const kinds: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw.kinds)) {
        if (k.length === 0) {
            throw new Error("row.inputSummary.kinds key must be non-empty")
        }
        if (!isNInt(v) || !isI32(v) || v < 1) {
            throw new Error(`row.inputSummary.kinds[${k}] must be positive i32`)
        }
        kinds[k] = v
    }
    return {
        count: raw.count as number,
        user: raw.user as number,
        coop: raw.coop as number,
        unknown: raw.unknown as number,
        readErrors: raw.readErrors as number,
        kinds,
        orderedHash: raw.orderedHash as number,
        firstFrame: raw.firstFrame as number | null,
        lastFrame: raw.lastFrame as number | null,
        coverage: "top_level_only",
    }
}

export function validateCompactRouteSummary(raw: unknown): CompactRouteSummary | null {
    if (raw === null) return null
    if (!isPlainObject(raw)) {
        throw new Error("row.routeSummary must be a plain object or null")
    }
    const allowed = new Set([
        "count",
        "unknown",
        "readErrors",
        "route_received",
        "route_decoded",
        "route_rejected",
        "speed_received",
        "speed_applied",
        "kinds",
        "orderedHash",
        "firstFrame",
        "lastFrame",
        "coverage",
    ])
    const keys = Object.keys(raw)
    if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
        throw new Error("row.routeSummary has invalid keys")
    }
    for (const ck of [
        "count",
        "unknown",
        "readErrors",
        "route_received",
        "route_decoded",
        "route_rejected",
        "speed_received",
        "speed_applied",
    ] as const) {
        if (!isNInt(raw[ck]) || !isI32(raw[ck])) {
            throw new Error(`row.routeSummary.${ck} must be non-negative i32`)
        }
    }
    if (!isI32(raw.orderedHash)) {
        throw new Error("row.routeSummary.orderedHash must be i32")
    }
    if (raw.firstFrame !== null && !isI32(raw.firstFrame)) {
        throw new Error("row.routeSummary.firstFrame must be i32 or null")
    }
    if (raw.lastFrame !== null && !isI32(raw.lastFrame)) {
        throw new Error("row.routeSummary.lastFrame must be i32 or null")
    }
    if (raw.coverage !== "top_level_only") {
        throw new Error(`invalid row.routeSummary.coverage: ${String(raw.coverage)}`)
    }
    if (!isPlainObject(raw.kinds)) {
        throw new Error("row.routeSummary.kinds must be a plain object")
    }
    const kinds: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw.kinds)) {
        if (k.length === 0) {
            throw new Error("row.routeSummary.kinds key must be non-empty")
        }
        if (!isNInt(v) || !isI32(v) || v < 1) {
            throw new Error(`row.routeSummary.kinds[${k}] must be positive i32`)
        }
        kinds[k] = v
    }
    return {
        count: raw.count as number,
        unknown: raw.unknown as number,
        readErrors: raw.readErrors as number,
        route_received: raw.route_received as number,
        route_decoded: raw.route_decoded as number,
        route_rejected: raw.route_rejected as number,
        speed_received: raw.speed_received as number,
        speed_applied: raw.speed_applied as number,
        kinds,
        orderedHash: raw.orderedHash as number,
        firstFrame: raw.firstFrame as number | null,
        lastFrame: raw.lastFrame as number | null,
        coverage: "top_level_only",
    }
}

export function validateGapEntry(raw: unknown): NormalizedGapEntry {
    if (!isPlainObject(raw)) throw new Error("gap entry must be an object")
    const keys = Object.keys(raw)
    const allowed = new Set([
        "reason",
        "battleId",
        "battleEpoch",
        "fromFrame",
        "toFrame",
        "fromSeq",
        "toSeq",
        "fromEventId",
        "toEventId",
    ])
    if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
        throw new Error("gap entry has invalid keys")
    }
    if (typeof raw.reason !== "string" || !ALLOWED_GAP_REASONS.has(raw.reason)) {
        throw new Error(`invalid gap reason: ${String(raw.reason)}`)
    }
    if (raw.battleId !== null && (typeof raw.battleId !== "string" || raw.battleId.length === 0)) {
        throw new Error("invalid gap battleId")
    }
    if (raw.battleEpoch !== null && !isNInt(raw.battleEpoch)) {
        throw new Error("invalid gap battleEpoch")
    }
    for (const rk of ["fromFrame", "toFrame", "fromSeq", "toSeq", "fromEventId", "toEventId"] as const) {
        if (raw[rk] !== null && !isNInt(raw[rk])) {
            throw new Error(`invalid gap ${rk}`)
        }
    }
    return {
        reason: raw.reason,
        battleId: raw.battleId as string | null,
        battleEpoch: raw.battleEpoch as number | null,
        fromFrame: raw.fromFrame as number | null,
        toFrame: raw.toFrame as number | null,
        fromSeq: raw.fromSeq as number | null,
        toSeq: raw.toSeq as number | null,
        fromEventId: raw.fromEventId as number | null,
        toEventId: raw.toEventId as number | null,
        source: "client",
    }
}

export function applyRowToState(
    previousState: Map<string, unknown> | null,
    previousFrame: number | null,
    rawRow: unknown,
    schema?: string,
): {
    battleId: string
    battleEpoch: number
    postFrame: number
    phase: "initial" | "post"
    zone: number | null
    floor: number
    mode: "full" | "delta"
    baseFrame: number | null
    eventCursor: number | null
    inputs: NormalizedInputEntry[]
    unsupported: UnsupportedFieldEntry[]
    inputSummary?: CompactInputSummary | null
    routeSummary?: CompactRouteSummary | null
    sampleInterval?: number | null
    previousCheckpointFrame?: number | null
    state: Map<string, unknown>
} {
    if (!isPlainObject(rawRow)) throw new Error("row must be a plain object")
    const battleId = rawRow.battleId
    if (typeof battleId !== "string" || battleId.length === 0) {
        throw new Error("row.battleId must be a non-empty string")
    }
    if (!isNInt(rawRow.battleEpoch)) throw new Error("row.battleEpoch must be nint")
    if (!isNInt(rawRow.postFrame) || !isI32(rawRow.postFrame)) {
        throw new Error("row.postFrame must be non-negative i32/nint")
    }
    const battleEpoch = rawRow.battleEpoch
    const postFrame = rawRow.postFrame
    const phase = rawRow.phase
    if (phase !== "initial" && phase !== "post") {
        throw new Error(`invalid row.phase: ${String(phase)}`)
    }
    if (phase === "initial" && postFrame !== 0) {
        throw new Error("initial row must have postFrame=0")
    }
    if (phase === "post" && postFrame < 1) {
        throw new Error("post row must have postFrame>=1")
    }
    if (rawRow.zone !== null && !isI32(rawRow.zone)) {
        throw new Error("row.zone must be i32 or null")
    }
    if (!isI32(rawRow.floor)) {
        throw new Error("row.floor must be i32")
    }
    if (rawRow.eventCursor !== null && !isNInt(rawRow.eventCursor)) {
        throw new Error("row.eventCursor must be nint or null")
    }
    const unsupported = validateUnsupportedArray(rawRow.unsupported)

    const effectiveSchema = schema
        ?? (("inputSummary" in rawRow || "sampleInterval" in rawRow || "previousCheckpointFrame" in rawRow)
            ? FINGERPRINT_COMPACT_V2_SCHEMA
            : FINGERPRINT_SCHEMA)
    const isCompactV2 = effectiveSchema === FINGERPRINT_COMPACT_V2_SCHEMA

    const keys = Object.keys(rawRow)
    const mode = rawRow.mode

    if (isCompactV2) {
        if (mode !== "full") {
            throw new Error(`compact-v2 row must use mode=full, got: ${String(mode)}`)
        }
        const allowed = new Set([
            "battleId",
            "battleEpoch",
            "postFrame",
            "phase",
            "zone",
            "floor",
            "mode",
            "values",
            "unsupported",
            "inputSummary",
            "routeSummary",
            "sampleInterval",
            "previousCheckpointFrame",
            "eventCursor",
        ])
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("compact-v2 row has invalid keys")
        }
        if (!isI32(rawRow.sampleInterval) || rawRow.sampleInterval < 30 || rawRow.sampleInterval > 300) {
            throw new Error(`invalid compact-v2 row.sampleInterval: ${String(rawRow.sampleInterval)}`)
        }
        if (!isI32(rawRow.previousCheckpointFrame) || rawRow.previousCheckpointFrame < -1) {
            throw new Error(`invalid compact-v2 row.previousCheckpointFrame: ${String(rawRow.previousCheckpointFrame)}`)
        }
        if (phase === "initial" && rawRow.previousCheckpointFrame !== -1) {
            throw new Error("compact-v2 initial row must have previousCheckpointFrame=-1")
        }
        if (phase === "post" && rawRow.previousCheckpointFrame >= postFrame) {
            throw new Error(`compact-v2 post row previousCheckpointFrame (${rawRow.previousCheckpointFrame}) must be < postFrame (${postFrame})`)
        }
        const inputSummary = validateCompactInputSummary(rawRow.inputSummary)
        const routeSummary = validateCompactRouteSummary(rawRow.routeSummary)
        if (!isPlainObject(rawRow.values)) {
            throw new Error("compact-v2 row.values must be a plain object")
        }
        const state = new Map<string, unknown>()
        for (const [k, v] of Object.entries(rawRow.values)) {
            if (!k.startsWith("/")) throw new Error(`invalid field path: ${k}`)
            validateValueTree(v)
            state.set(k, v)
        }
        if (state.has("/battle/currentFrame") && state.get("/battle/currentFrame") !== postFrame) {
            throw new Error(`/battle/currentFrame (${String(state.get("/battle/currentFrame"))}) must equal postFrame (${postFrame})`)
        }
        if (state.has("/battle/id") && state.get("/battle/id") !== battleId) {
            throw new Error(`/battle/id (${String(state.get("/battle/id"))}) must equal row.battleId (${battleId})`)
        }
        return {
            battleId,
            battleEpoch,
            postFrame,
            phase,
            zone: rawRow.zone as number | null,
            floor: rawRow.floor,
            mode: "full",
            baseFrame: null,
            eventCursor: rawRow.eventCursor as number | null,
            inputs: [],
            unsupported,
            inputSummary,
            routeSummary,
            sampleInterval: rawRow.sampleInterval as number,
            previousCheckpointFrame: rawRow.previousCheckpointFrame as number,
            state,
        }
    }

    const inputs = validateInputsArray(rawRow.inputs, battleId, battleEpoch, postFrame, unsupported)
    if (phase === "initial" && inputs.length !== 0) {
        throw new Error("initial row must have empty inputs")
    }

    if (mode !== "full" && mode !== "delta") {
        throw new Error(`invalid row.mode: ${String(mode)}`)
    }

    let state: Map<string, unknown>
    let baseFrame: number | null = null

    if (mode === "full") {
        if ("baseFrame" in rawRow || "set" in rawRow || "unset" in rawRow) {
            throw new Error("full row must not contain baseFrame, set, or unset")
        }
        const allowed = new Set([
            "battleId",
            "battleEpoch",
            "postFrame",
            "phase",
            "zone",
            "floor",
            "mode",
            "inputs",
            "unsupported",
            "eventCursor",
            "values",
        ])
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("full row has invalid keys")
        }
        if (!isPlainObject(rawRow.values)) {
            throw new Error("full row.values must be a plain object")
        }
        state = new Map<string, unknown>()
        for (const [k, v] of Object.entries(rawRow.values)) {
            if (!k.startsWith("/")) throw new Error(`invalid field path: ${k}`)
            validateValueTree(v)
            state.set(k, v)
        }
    } else {
        if (phase === "initial") {
            throw new Error("initial row must use mode=full")
        }
        if ("values" in rawRow) {
            throw new Error("delta row must not contain values")
        }
        const allowed = new Set([
            "battleId",
            "battleEpoch",
            "postFrame",
            "phase",
            "zone",
            "floor",
            "mode",
            "inputs",
            "unsupported",
            "eventCursor",
            "baseFrame",
            "set",
            "unset",
        ])
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("delta row has invalid keys")
        }
        if (!isNInt(rawRow.baseFrame) || rawRow.baseFrame !== postFrame - 1) {
            const err = new Error(`delta row baseFrame (${String(rawRow.baseFrame)}) must equal postFrame - 1 (${postFrame - 1})`)
            ;(err as Error & { reason?: string }).reason = "broken_delta_chain"
            throw err
        }
        if (!previousState || previousFrame !== rawRow.baseFrame) {
            const err = new Error(`missing delta baseline at frame ${rawRow.baseFrame} for postFrame ${postFrame}`)
            ;(err as Error & { reason?: string }).reason = "broken_delta_chain"
            throw err
        }
        baseFrame = rawRow.baseFrame
        if (!isPlainObject(rawRow.set) || !Array.isArray(rawRow.unset)) {
            throw new Error("delta row requires set object and unset array")
        }
        const setObj = rawRow.set
        const unsetArr = rawRow.unset
        const unsetSet = new Set<string>()
        for (const item of unsetArr) {
            if (typeof item !== "string" || !item.startsWith("/")) {
                throw new Error(`invalid unset path: ${String(item)}`)
            }
            if (unsetSet.has(item)) {
                throw new Error(`duplicate path in unset: ${item}`)
            }
            if (Object.prototype.hasOwnProperty.call(setObj, item)) {
                throw new Error(`set and unset overlap on path: ${item}`)
            }
            unsetSet.add(item)
        }
        state = new Map<string, unknown>(previousState)
        for (const key of unsetSet) {
            if (!state.has(key)) {
                const err = new Error(`unset path does not exist in baseline state: ${key}`)
                ;(err as Error & { reason?: string }).reason = "broken_delta_chain"
                throw err
            }
            state.delete(key)
        }
        for (const [k, v] of Object.entries(setObj)) {
            if (!k.startsWith("/")) throw new Error(`invalid set path: ${k}`)
            validateValueTree(v)
            state.set(k, v)
        }
    }

    if (state.get("/battle/currentFrame") !== postFrame) {
        throw new Error(`/battle/currentFrame (${String(state.get("/battle/currentFrame"))}) must equal postFrame (${postFrame})`)
    }
    if (state.has("/battle/id") && state.get("/battle/id") !== battleId) {
        throw new Error(`/battle/id (${String(state.get("/battle/id"))}) must equal row.battleId (${battleId})`)
    }

    return {
        battleId,
        battleEpoch,
        postFrame,
        phase,
        zone: rawRow.zone as number | null,
        floor: rawRow.floor,
        mode,
        baseFrame,
        eventCursor: rawRow.eventCursor as number | null,
        inputs,
        unsupported,
        state,
    }
}

interface PendingFragmentSet {
    schema: string
    build: string
    epoch: number
    seq: number
    parts: number
    createdAtMs: number
    lastProgressAtMs: number
    wireBytesReceived: number
    chunks: Map<number, string>
    bufferedBytes: number
}

interface ReadyBatchItem {
    schema: string
    build: string
    epoch: number
    seq: number
    parts: number
    createdAtMs: number
    batch: LogicalBatchPayload
    bufferedBytes: number
}

interface BattleBaselineState {
    lastFrame: number | null
    state: Map<string, unknown> | null
    seenFrames: Set<number>
    hasInitialOrGap: boolean
}

interface EpochStreamState {
    epoch: number
    nextSeq: number
    maxSeenSeq: number
    nextExpectedEventId: number
    contiguousEventWaterMark: number
    eventGapDetected: boolean
    partialSeqs: Map<number, PendingFragmentSet>
    readySeqs: Map<number, ReadyBatchItem>
    completedSeqPartSignatures: Map<string, string>
    poisonedSeqs: Set<number>
    baselines: Map<string, BattleBaselineState>
}

interface ConnectionStreamState {
    connectionKey: string
    observerId: string
    viewerId: number
    connectionId: string
    connectionGeneration: number
    tokens: number
    lastRefillMs: number
    bufferedBytes: number
    activeEpoch: number | null
    epochs: Map<number, EpochStreamState>
}

interface RunBucketState {
    identity: RunBucketIdentity
    comparator: StateFingerprintComparator
    connections: Map<string, ConnectionStreamState>
    observerActiveEpoch: Map<string, { connectionKey: string; clientEpoch: number }>
    jsonlFilePath: string
    desyncFilePath: string
}

export interface ObserverContextInput {
    observerId?: string
    viewerId: number
    connectionId: string
    connectionGeneration?: number
    roomNumber: string
    roomInstanceId?: string
    battleSessionId?: string
    generation?: number
    sceneEpoch?: number
    expectedMembers?: FrozenObserverMember[]
}

export interface StateFingerprintOptions {
    outputDir?: string
    nowMs?: () => number
    rateBytesPerSec?: number
    bucketCapacityBytes?: number
    bufferLimitBytes?: number
    fragmentWaitTimeoutMs?: number
    maxReassemblyTotalMs?: number
    maxPendingSeqs?: number
    stderrWrite?: (line: string) => void
}

export class StateFingerprintService {
    private readonly runs = new Map<string, RunBucketState>()
    private readonly trackedSockets = new WeakSet<net.Socket>()
    public diagnostics = {
        packetsReceived: 0,
        packetsAccepted: 0,
        packetsRejected: 0,
        duplicatesIgnored: 0,
        rateLimited: 0,
        writeErrors: 0,
        desyncReports: 0,
    }

    constructor(private readonly options: StateFingerprintOptions = {}) {}

    private now(): number {
        return this.options.nowMs ? this.options.nowMs() : performance.now()
    }

    private resolveOutputDir(): string {
        if (this.options.outputDir !== undefined) return this.options.outputDir.trim()
        return getFingerprintOutputDir()
    }

    isEnabled(): boolean {
        return this.resolveOutputDir().length > 0
    }

    reset(): void {
        this.runs.clear()
        this.diagnostics = {
            packetsReceived: 0,
            packetsAccepted: 0,
            packetsRejected: 0,
            duplicatesIgnored: 0,
            rateLimited: 0,
            writeErrors: 0,
            desyncReports: 0,
        }
    }

    getRunComparator(runKeyOrId: string): StateFingerprintComparator | undefined {
        const direct = this.runs.get(runKeyOrId)
        if (direct) return direct.comparator
        for (const run of this.runs.values()) {
            if (run.identity.runId === runKeyOrId || run.identity.battleSessionId === runKeyOrId || run.identity.roomNumber === runKeyOrId) {
                return run.comparator
            }
        }
        return undefined
    }

    getAllRuns(): RunBucketState[] {
        return [...this.runs.values()]
    }

    private ensureRunBucket(context: ObserverContextInput, schema = FINGERPRINT_SCHEMA): RunBucketState {
        const roomInstanceId = context.roomInstanceId || `room-inst-${context.roomNumber}`
        const battleSessionId = context.battleSessionId || `battle-${context.roomNumber}-g${context.generation ?? 0}`
        const generation = context.generation ?? 0
        const sceneEpoch = context.sceneEpoch ?? 0
        const bucketKey = `${roomInstanceId}|${battleSessionId}|e${sceneEpoch}|${schema}`
        let bucket = this.runs.get(bucketKey)
        if (!bucket) {
            const rawRunId = sceneEpoch > 0
                ? `${context.roomNumber}-g${generation}-s${sceneEpoch}-${battleSessionId}`
                : `${context.roomNumber}-g${generation}-${battleSessionId}`
            const safeRun = sanitizeRunFilenamePart(rawRunId)
            const outDir = this.resolveOutputDir()
            const jsonlFilePath = outDir ? path.join(outDir, `fingerprint-${safeRun}.jsonl`) : ""
            const desyncFilePath = outDir ? path.join(outDir, `desync-first-${safeRun}.json`) : ""
            const identity: RunBucketIdentity = {
                runId: safeRun,
                roomNumber: context.roomNumber,
                roomInstanceId,
                battleSessionId,
                generation,
                sceneEpoch,
                schema,
            }
            const comparator = new StateFingerprintComparator(
                identity,
                context.expectedMembers ?? [],
                (report, isFirstForBattle) => {
                    this.writeDesyncReport(bucket!, report, isFirstForBattle)
                },
            )
            bucket = {
                identity,
                comparator,
                connections: new Map(),
                observerActiveEpoch: new Map(),
                jsonlFilePath,
                desyncFilePath,
            }
            this.runs.set(bucketKey, bucket)
        } else if (context.expectedMembers && context.expectedMembers.length > 0) {
            bucket.comparator.freezeExpectedMembers(context.expectedMembers)
        }
        return bucket
    }

    private appendJsonl(bucket: RunBucketState, record: Record<string, unknown>): void {
        const outDir = this.resolveOutputDir()
        if (!outDir || !bucket.jsonlFilePath) return
        try {
            fs.mkdirSync(outDir, { recursive: true })
            fs.appendFileSync(bucket.jsonlFilePath, JSON.stringify(record) + "\n", "utf8")
        } catch {
            this.diagnostics.writeErrors++
        }
    }

    private writeDesyncReport(bucket: RunBucketState, report: DesyncFirstReport, isFirstForBattle: boolean): void {
        this.diagnostics.desyncReports++
        const outDir = this.resolveOutputDir()
        if (outDir && bucket.desyncFilePath) {
            try {
                fs.mkdirSync(outDir, { recursive: true })
                fs.writeFileSync(bucket.desyncFilePath, JSON.stringify(report, null, 2) + "\n", "utf8")
            } catch {
                this.diagnostics.writeErrors++
            }
        }
        if (isFirstForBattle) {
            const line = `[DESYNC-FIRST] room=${report.roomNumber} battle=${report.battleId} frame=${report.postFrame} field=${report.fieldPath} layer=${report.layer} completeness=${report.completeness} lastEqualFrame=${report.lastEqualFrame ?? "null"} summary="${report.summary}"`
            if (this.options.stderrWrite) {
                this.options.stderrWrite(line)
            } else {
                process.stderr.write(line + "\n")
            }
        }
    }

    private recordServerGap(
        bucket: RunBucketState,
        observerId: string,
        gap: NormalizedGapEntry,
    ): void {
        const normalized: NormalizedGapEntry = { ...gap, source: "server" }
        bucket.comparator.addGap(observerId, normalized)
        this.appendJsonl(bucket, {
            type: "gap",
            ts: Date.now(),
            runId: bucket.identity.runId,
            roomNumber: bucket.identity.roomNumber,
            battleSessionId: bucket.identity.battleSessionId,
            sceneEpoch: bucket.identity.sceneEpoch,
            observerId,
            gap: normalized,
        })
    }

    private getOrCreateConnectionState(
        bucket: RunBucketState,
        observerId: string,
        context: ObserverContextInput,
    ): ConnectionStreamState {
        const connGen = context.connectionGeneration ?? 0
        const connectionKey = `${observerId}#cg${connGen}`
        let conn = bucket.connections.get(connectionKey)
        if (!conn) {
            const capacity = this.options.bucketCapacityBytes
                ?? (Number.parseInt(process.env.MULTI_FINGERPRINT_BUCKET_BYTES ?? "", 10) || DEFAULT_BUCKET_CAPACITY_BYTES)
            conn = {
                connectionKey,
                observerId,
                viewerId: context.viewerId,
                connectionId: context.connectionId,
                connectionGeneration: connGen,
                tokens: capacity,
                lastRefillMs: this.now(),
                bufferedBytes: 0,
                activeEpoch: null,
                epochs: new Map(),
            }
            bucket.connections.set(connectionKey, conn)
        }
        return conn
    }

    private consumeRateLimitTokens(conn: ConnectionStreamState, bytes: number): boolean {
        const now = this.now()
        const rate = this.options.rateBytesPerSec
            ?? (Number.parseInt(process.env.MULTI_FINGERPRINT_RATE_BYTES_PER_SEC ?? "", 10) || DEFAULT_RATE_BYTES_PER_SEC)
        const capacity = this.options.bucketCapacityBytes
            ?? (Number.parseInt(process.env.MULTI_FINGERPRINT_BUCKET_BYTES ?? "", 10) || DEFAULT_BUCKET_CAPACITY_BYTES)

        if (now < conn.lastRefillMs) {
            // Monotonic timer wraparound safety: reset timer without amplifying tokens
            conn.lastRefillMs = now
        } else {
            const elapsedSec = (now - conn.lastRefillMs) / 1000
            if (elapsedSec > 0) {
                conn.tokens = Math.min(capacity, conn.tokens + elapsedSec * rate)
                conn.lastRefillMs = now
            }
        }
        if (bytes > conn.tokens) {
            return false
        }
        conn.tokens -= bytes
        return true
    }

    private getOrCreateEpochState(
        bucket: RunBucketState,
        conn: ConnectionStreamState,
        clientEpoch: number,
    ): EpochStreamState {
        const existingBinding = bucket.observerActiveEpoch.get(conn.observerId)
        if (!existingBinding) {
            bucket.observerActiveEpoch.set(conn.observerId, {
                connectionKey: conn.connectionKey,
                clientEpoch,
            })
        } else if (existingBinding.connectionKey !== conn.connectionKey || existingBinding.clientEpoch !== clientEpoch) {
            // Observer switched connection or clientEpoch mid-scene without LevelNext.
            // Do not splice baselines across epochs; mark epoch_end gap.
            const prevConn = bucket.connections.get(existingBinding.connectionKey)
            const prevEpochState = prevConn?.epochs.get(existingBinding.clientEpoch)
            if (prevEpochState) {
                for (const baseline of prevEpochState.baselines.values()) {
                    baseline.state = null
                    baseline.lastFrame = null
                }
            }
            bucket.observerActiveEpoch.set(conn.observerId, {
                connectionKey: conn.connectionKey,
                clientEpoch,
            })
            this.recordServerGap(bucket, conn.observerId, {
                reason: existingBinding.connectionKey !== conn.connectionKey ? "connection_closed" : "epoch_end",
                battleId: null,
                battleEpoch: null,
                fromFrame: null,
                toFrame: null,
                fromSeq: null,
                toSeq: null,
                fromEventId: null,
                toEventId: null,
                detail: `observer epoch changed from ${existingBinding.connectionKey}:e${existingBinding.clientEpoch} to ${conn.connectionKey}:e${clientEpoch}`,
            })
        }

        conn.activeEpoch = clientEpoch
        let epochState = conn.epochs.get(clientEpoch)
        if (!epochState) {
            epochState = {
                epoch: clientEpoch,
                nextSeq: 0,
                maxSeenSeq: -1,
                nextExpectedEventId: 0,
                contiguousEventWaterMark: -1,
                eventGapDetected: false,
                partialSeqs: new Map(),
                readySeqs: new Map(),
                completedSeqPartSignatures: new Map(),
                poisonedSeqs: new Set(),
                baselines: new Map(),
            }
            conn.epochs.set(clientEpoch, epochState)
        }
        return epochState
    }

    private invalidateEpochBaselines(epochState: EpochStreamState, battleId: string | null = null, battleEpoch: number | null = null): void {
        for (const [key, baseline] of epochState.baselines.entries()) {
            if (battleId !== null) {
                const [bId, bEp] = key.split("#")
                if (bId !== battleId) continue
                if (battleEpoch !== null && Number(bEp) !== battleEpoch) continue
            }
            baseline.state = null
            baseline.lastFrame = null
        }
    }

    /**
     * Main entry point for receiving a fingerprint packet (raw JSON string or parsed array)
     * for a server-authenticated observer context.
     */
    receivePacket(context: ObserverContextInput, rawOrParsed: string | unknown): {
        accepted: boolean
        duplicate?: boolean
        reason?: string
        report?: DesyncFirstReport | null
    } {
        if (!this.isEnabled()) {
            return { accepted: false, reason: "disabled" }
        }
        this.diagnostics.packetsReceived++

        const packetSchema = peekPacketSchema(rawOrParsed) ?? FINGERPRINT_SCHEMA
        const bucket = this.ensureRunBucket(context, packetSchema)
        const candidateMember: FrozenObserverMember = {
            observerId: context.observerId || context.connectionId || `viewer:${context.viewerId}`,
            viewerId: context.viewerId,
            connectionId: context.connectionId,
        }

        // Verify observer belongs to frozen Start members when frozen members are specified
        const allowedByContext = !context.expectedMembers || context.expectedMembers.length === 0 || context.expectedMembers.some(
            m => (m.viewerId > 0 && m.viewerId === context.viewerId)
                || (m.connectionId && m.connectionId === context.connectionId)
                || (m.observerId && m.observerId === candidateMember.observerId),
        )
        if (!allowedByContext || !bucket.comparator.isAuthorizedMember(candidateMember)) {
            this.diagnostics.packetsRejected++
            this.appendJsonl(bucket, {
                type: "diagnostic",
                ts: Date.now(),
                runId: bucket.identity.runId,
                observerId: candidateMember.observerId,
                error: "unauthorized_observer",
            })
            return { accepted: false, reason: "unauthorized_observer" }
        }

        const observerId = bucket.comparator.registerExpectedMember(candidateMember)

        const conn = this.getOrCreateConnectionState(bucket, observerId, context)

        let envelope: ValidatedPacketEnvelope
        try {
            envelope = validateFingerprintPacket(rawOrParsed)
        } catch (error) {
            this.diagnostics.packetsRejected++
            const errReason = (error as Error & { reason?: string }).reason ?? "invalid_packet"
            const gapReason = errReason === "oversize" ? "oversize" : "sampling_error"
            if (conn.activeEpoch !== null) {
                const epState = conn.epochs.get(conn.activeEpoch)
                if (epState) this.invalidateEpochBaselines(epState)
            }
            this.recordServerGap(bucket, observerId, {
                reason: gapReason,
                battleId: null,
                battleEpoch: null,
                fromFrame: null,
                toFrame: null,
                fromSeq: null,
                toSeq: null,
                fromEventId: null,
                toEventId: null,
                detail: (error as Error).message,
            })
            return { accepted: false, reason: errReason }
        }

        // Per-connection rate limit check (physical packet UTF-8 + NUL bytes)
        if (!this.consumeRateLimitTokens(conn, envelope.physicalBytes)) {
            this.diagnostics.rateLimited++
            this.diagnostics.packetsRejected++
            const epState = this.getOrCreateEpochState(bucket, conn, envelope.epoch)
            epState.poisonedSeqs.add(envelope.seq)
            this.invalidateEpochBaselines(epState)
            this.recordServerGap(bucket, observerId, {
                reason: "buffer_overflow",
                battleId: null,
                battleEpoch: null,
                fromFrame: null,
                toFrame: null,
                fromSeq: envelope.seq,
                toSeq: envelope.seq,
                fromEventId: null,
                toEventId: null,
                detail: "rate_limit_exceeded",
            })
            return { accepted: false, reason: "rate_limit_exceeded" }
        }

        const epochState = this.getOrCreateEpochState(bucket, conn, envelope.epoch)

        // Expire any already timed-out pending sequences before processing duplicates or new fragments
        // so that duplicate fragments or late packets cannot extend or bypass an already-expired sequence.
        this.drainEpochReadyBatches(bucket, conn, epochState, false)

        if (envelope.seq > epochState.maxSeenSeq) {
            epochState.maxSeenSeq = envelope.seq
        }

        const partKey = `${envelope.seq}:${envelope.part}`
        const partSignature = envelope.parts === 1
            ? canonicalJson({
                schema: envelope.schema,
                build: envelope.build,
                epoch: envelope.epoch,
                seq: envelope.seq,
                parts: 1,
                rows: envelope.rows,
                events: envelope.events,
                gaps: envelope.gaps,
            })
            : canonicalJson({
                schema: envelope.schema,
                build: envelope.build,
                epoch: envelope.epoch,
                seq: envelope.seq,
                parts: envelope.parts,
                chunk: envelope.chunk,
            })

        // Check against already seen/completed (seq, part) or conflicting metadata for the same seq
        const prevSig = epochState.completedSeqPartSignatures.get(partKey)
        const seqMetaKey = `${envelope.seq}:meta`
        const seqMetaSig = canonicalJson({
            schema: envelope.schema,
            build: envelope.build,
            epoch: envelope.epoch,
            seq: envelope.seq,
            parts: envelope.parts,
        })
        const prevMetaSig = epochState.completedSeqPartSignatures.get(seqMetaKey)

        if (prevMetaSig !== undefined && prevMetaSig !== seqMetaSig) {
            return this.rejectConflictingSeq(bucket, conn, epochState, envelope.seq, "conflicting_seq_metadata")
        }
        if (prevSig !== undefined) {
            if (prevSig === partSignature) {
                this.diagnostics.duplicatesIgnored++
                return { accepted: true, duplicate: true, report: bucket.comparator.getFirstReport() }
            }
            return this.rejectConflictingSeq(bucket, conn, epochState, envelope.seq, "conflicting_duplicate_part")
        }

        if (epochState.poisonedSeqs.has(envelope.seq)) {
            this.diagnostics.packetsRejected++
            return { accepted: false, reason: "seq_already_poisoned" }
        }

        epochState.completedSeqPartSignatures.set(seqMetaKey, seqMetaSig)
        epochState.completedSeqPartSignatures.set(partKey, partSignature)

        const bufferLimit = this.options.bufferLimitBytes ?? DEFAULT_BUFFER_LIMIT_BYTES
        const now = this.now()

        if (envelope.parts === 1) {
            const batch: LogicalBatchPayload = {
                rows: envelope.rows!,
                events: envelope.events!,
                gaps: envelope.gaps!,
            }
            if (conn.bufferedBytes + envelope.physicalBytes > bufferLimit) {
                epochState.poisonedSeqs.add(envelope.seq)
                this.invalidateEpochBaselines(epochState)
                this.recordServerGap(bucket, observerId, {
                    reason: "buffer_overflow",
                    battleId: null,
                    battleEpoch: null,
                    fromFrame: null,
                    toFrame: null,
                    fromSeq: envelope.seq,
                    toSeq: envelope.seq,
                    fromEventId: null,
                    toEventId: null,
                    detail: "connection_buffer_limit_exceeded",
                })
                this.diagnostics.packetsRejected++
                return { accepted: false, reason: "buffer_overflow" }
            }
            conn.bufferedBytes += envelope.physicalBytes
            epochState.readySeqs.set(envelope.seq, {
                schema: envelope.schema,
                build: envelope.build,
                epoch: envelope.epoch,
                seq: envelope.seq,
                parts: 1,
                createdAtMs: now,
                batch,
                bufferedBytes: envelope.physicalBytes,
            })
        } else {
            let pending = epochState.partialSeqs.get(envelope.seq)
            if (!pending) {
                pending = {
                    schema: envelope.schema,
                    build: envelope.build,
                    epoch: envelope.epoch,
                    seq: envelope.seq,
                    parts: envelope.parts,
                    createdAtMs: now,
                    lastProgressAtMs: now,
                    wireBytesReceived: 0,
                    chunks: new Map(),
                    bufferedBytes: 0,
                }
                epochState.partialSeqs.set(envelope.seq, pending)
            }
            const chunkBytes = Buffer.byteLength(envelope.chunk!, "utf8")
            if (conn.bufferedBytes + chunkBytes > bufferLimit) {
                conn.bufferedBytes -= pending.bufferedBytes
                epochState.partialSeqs.delete(envelope.seq)
                epochState.poisonedSeqs.add(envelope.seq)
                this.invalidateEpochBaselines(epochState)
                this.recordServerGap(bucket, observerId, {
                    reason: "buffer_overflow",
                    battleId: null,
                    battleEpoch: null,
                    fromFrame: null,
                    toFrame: null,
                    fromSeq: envelope.seq,
                    toSeq: envelope.seq,
                    fromEventId: null,
                    toEventId: null,
                    detail: "fragment_buffer_overflow",
                })
                this.diagnostics.packetsRejected++
                return { accepted: false, reason: "buffer_overflow" }
            }
            pending.chunks.set(envelope.part, envelope.chunk!)
            pending.lastProgressAtMs = now
            pending.wireBytesReceived += envelope.physicalBytes
            pending.bufferedBytes += chunkBytes
            conn.bufferedBytes += chunkBytes

            if (pending.chunks.size === pending.parts) {
                epochState.partialSeqs.delete(envelope.seq)
                const orderedChunks: string[] = []
                for (let i = 0; i < pending.parts; i++) {
                    const ch = pending.chunks.get(i)
                    if (ch === undefined) {
                        conn.bufferedBytes -= pending.bufferedBytes
                        return this.rejectConflictingSeq(bucket, conn, epochState, envelope.seq, "missing_fragment_part")
                    }
                    orderedChunks.push(ch)
                }
                const fullText = orderedChunks.join("")
                const fullBytes = Buffer.byteLength(fullText, "utf8")
                if (fullBytes > MAX_LOGICAL_BATCH_BYTES) {
                    conn.bufferedBytes -= pending.bufferedBytes
                    epochState.poisonedSeqs.add(envelope.seq)
                    this.invalidateEpochBaselines(epochState)
                    this.recordServerGap(bucket, observerId, {
                        reason: "oversize",
                        battleId: null,
                        battleEpoch: null,
                        fromFrame: null,
                        toFrame: null,
                        fromSeq: envelope.seq,
                        toSeq: envelope.seq,
                        fromEventId: null,
                        toEventId: null,
                        detail: `reassembled batch exceeded ${MAX_LOGICAL_BATCH_BYTES} bytes (${fullBytes})`,
                    })
                    this.diagnostics.packetsRejected++
                    return { accepted: false, reason: "oversize" }
                }
                let batch: LogicalBatchPayload
                try {
                    const parsedBatch = parseUniqueJson(fullText)
                    batch = validateLogicalBatchObject(parsedBatch)
                } catch (error) {
                    conn.bufferedBytes -= pending.bufferedBytes
                    epochState.poisonedSeqs.add(envelope.seq)
                    this.invalidateEpochBaselines(epochState)
                    this.recordServerGap(bucket, observerId, {
                        reason: "fragment_loss",
                        battleId: null,
                        battleEpoch: null,
                        fromFrame: null,
                        toFrame: null,
                        fromSeq: envelope.seq,
                        toSeq: envelope.seq,
                        fromEventId: null,
                        toEventId: null,
                        detail: `reassembled batch parse failed: ${(error as Error).message}`,
                    })
                    this.diagnostics.packetsRejected++
                    return { accepted: false, reason: "reassembly_parse_failed" }
                }
                epochState.readySeqs.set(envelope.seq, {
                    schema: pending.schema,
                    build: pending.build,
                    epoch: pending.epoch,
                    seq: pending.seq,
                    parts: pending.parts,
                    createdAtMs: pending.createdAtMs,
                    batch,
                    bufferedBytes: pending.bufferedBytes,
                })
            }
        }

        this.diagnostics.packetsAccepted++
        this.drainEpochReadyBatches(bucket, conn, epochState, false)
        return { accepted: true, report: bucket.comparator.getFirstReport() }
    }

    private rejectConflictingSeq(
        bucket: RunBucketState,
        conn: ConnectionStreamState,
        epochState: EpochStreamState,
        seq: number,
        detail: string,
    ): { accepted: false; reason: string } {
        this.diagnostics.packetsRejected++
        const pending = epochState.partialSeqs.get(seq)
        if (pending) {
            conn.bufferedBytes -= pending.bufferedBytes
            epochState.partialSeqs.delete(seq)
        }
        const ready = epochState.readySeqs.get(seq)
        if (ready) {
            conn.bufferedBytes -= ready.bufferedBytes
            epochState.readySeqs.delete(seq)
        }
        epochState.poisonedSeqs.add(seq)
        this.invalidateEpochBaselines(epochState)
        this.recordServerGap(bucket, conn.observerId, {
            reason: "fragment_loss",
            battleId: null,
            battleEpoch: null,
            fromFrame: null,
            toFrame: null,
            fromSeq: seq,
            toSeq: seq,
            fromEventId: null,
            toEventId: null,
            detail,
        })
        this.drainEpochReadyBatches(bucket, conn, epochState, false)
        return { accepted: false, reason: detail }
    }

    private resolveEffectiveRateBytesPerSec(schema: string): number {
        const configured = this.options.rateBytesPerSec
            ?? (Number.parseInt(process.env.MULTI_FINGERPRINT_RATE_BYTES_PER_SEC ?? "", 10) || DEFAULT_RATE_BYTES_PER_SEC)
        if (schema === FINGERPRINT_COMPACT_V2_SCHEMA) {
            return Math.max(1, Math.min(configured, COMPACT_V2_CLIENT_RATE_BYTES_PER_SEC))
        }
        return Math.max(1, configured)
    }

    private drainEpochReadyBatches(
        bucket: RunBucketState,
        conn: ConnectionStreamState,
        epochState: EpochStreamState,
        forceFlushMissing: boolean,
    ): void {
        const now = this.now()
        const maxPending = this.options.maxPendingSeqs ?? MAX_PENDING_SEQS
        const waitTimeoutMs = this.options.fragmentWaitTimeoutMs ?? FRAGMENT_WAIT_TIMEOUT_MS
        const maxTotalCapMs = this.options.maxReassemblyTotalMs
            ?? (Number.parseInt(process.env.MULTI_FINGERPRINT_MAX_REASSEMBLY_MS ?? "", 10) || DEFAULT_MAX_REASSEMBLY_TOTAL_MS)
        const rate = this.resolveEffectiveRateBytesPerSec(bucket.identity.schema)

        while (true) {
            // 1. Apply any contiguous ready batch at nextSeq
            const ready = epochState.readySeqs.get(epochState.nextSeq)
            if (ready) {
                epochState.readySeqs.delete(epochState.nextSeq)
                conn.bufferedBytes = Math.max(0, conn.bufferedBytes - ready.bufferedBytes)
                this.applyLogicalBatch(bucket, conn, epochState, ready)
                epochState.nextSeq++
                continue
            }

            // 2. If nextSeq is known poisoned, advance past it with gap already recorded
            if (epochState.poisonedSeqs.has(epochState.nextSeq)) {
                this.invalidateEpochBaselines(epochState)
                epochState.nextSeq++
                continue
            }

            // 3. Check if we have later sequences waiting while nextSeq is missing/partial
            const hasLaterOrPartial = epochState.readySeqs.size > 0 || epochState.partialSeqs.size > 0
            if (!hasLaterOrPartial) break

            const pendingSpan = epochState.maxSeenSeq - epochState.nextSeq + 1
            const totalPendingCount = epochState.readySeqs.size + epochState.partialSeqs.size
            const partial = epochState.partialSeqs.get(epochState.nextSeq)

            let shouldExpire = forceFlushMissing || pendingSpan > maxPending || totalPendingCount > maxPending
            if (!shouldExpire) {
                if (partial) {
                    const elapsedSinceCreatedMs = Math.max(0, now - partial.createdAtMs)
                    const idleMs = Math.max(0, now - partial.lastProgressAtMs)
                    const progressDurationMs = Math.max(0, partial.lastProgressAtMs - partial.createdAtMs)
                    const expectedRateTransferMs = Math.ceil((partial.wireBytesReceived / rate) * 1000)
                    const unpaidRateAllowanceMs = Math.max(0, expectedRateTransferMs - progressDurationMs)
                    const effectiveIdleTimeoutMs = waitTimeoutMs + unpaidRateAllowanceMs
                    const effectiveTotalTimeoutMs = Math.min(
                        maxTotalCapMs,
                        Math.max(120000, expectedRateTransferMs + waitTimeoutMs * 2),
                    )
                    if (idleMs >= effectiveIdleTimeoutMs || elapsedSinceCreatedMs >= effectiveTotalTimeoutMs) {
                        shouldExpire = true
                    }
                } else {
                    let earliestLaterCreatedAtMs = Number.POSITIVE_INFINITY
                    for (const [s, item] of epochState.partialSeqs.entries()) {
                        if (s > epochState.nextSeq && item.createdAtMs < earliestLaterCreatedAtMs) {
                            earliestLaterCreatedAtMs = item.createdAtMs
                        }
                    }
                    for (const [s, item] of epochState.readySeqs.entries()) {
                        if (s > epochState.nextSeq && item.createdAtMs < earliestLaterCreatedAtMs) {
                            earliestLaterCreatedAtMs = item.createdAtMs
                        }
                    }
                    if (Number.isFinite(earliestLaterCreatedAtMs)) {
                        const waitMs = Math.max(0, now - earliestLaterCreatedAtMs)
                        const bufferedAllowanceMs = Math.ceil((conn.bufferedBytes / rate) * 1000)
                        const missingEffectiveTimeoutMs = Math.min(maxTotalCapMs, waitTimeoutMs + bufferedAllowanceMs)
                        if (waitMs >= missingEffectiveTimeoutMs) {
                            shouldExpire = true
                        }
                    }
                }
            }

            if (shouldExpire) {
                // Expire missing/partial nextSeq
                if (partial) {
                    conn.bufferedBytes = Math.max(0, conn.bufferedBytes - partial.bufferedBytes)
                    epochState.partialSeqs.delete(epochState.nextSeq)
                    epochState.poisonedSeqs.add(epochState.nextSeq)
                    this.invalidateEpochBaselines(epochState)
                    this.recordServerGap(bucket, conn.observerId, {
                        reason: "fragment_loss",
                        battleId: null,
                        battleEpoch: null,
                        fromFrame: null,
                        toFrame: null,
                        fromSeq: epochState.nextSeq,
                        toSeq: epochState.nextSeq,
                        fromEventId: null,
                        toEventId: null,
                        detail: "incomplete_fragment_timeout_or_overflow",
                    })
                } else {
                    epochState.poisonedSeqs.add(epochState.nextSeq)
                    this.invalidateEpochBaselines(epochState)
                    this.recordServerGap(bucket, conn.observerId, {
                        reason: "sequence_loss",
                        battleId: null,
                        battleEpoch: null,
                        fromFrame: null,
                        toFrame: null,
                        fromSeq: epochState.nextSeq,
                        toSeq: epochState.nextSeq,
                        fromEventId: null,
                        toEventId: null,
                        detail: "missing_seq_timeout_or_overflow",
                    })
                }
                epochState.nextSeq++
                continue
            }

            // Still within waiting window for out-of-order seq / fragment;
            // mark pending status on comparator until all parts/seqs arrive.
            break
        }
        const stillPending = epochState.readySeqs.size > 0 || epochState.partialSeqs.size > 0
        bucket.comparator.setObserverPendingSequences(conn.observerId, stillPending)
    }

    /**
     * Replays a single `relay-records/*.jsonl` frame line into the fingerprint service
     * if it represents a battle_in `wf-fp` packet.
     */
    replayRelayRecordJsonlLine(rawLine: string, expectedMembers?: FrozenObserverMember[]): {
        handled: boolean
        accepted?: boolean
        reason?: string
    } {
        const trimmed = rawLine.trim()
        if (!trimmed) return { handled: false }
        const parsed = JSON.parse(trimmed) as Record<string, unknown>
        if (parsed.type !== "frame" || parsed.channel !== "battle" || parsed.dir !== "in") {
            return { handled: false }
        }
        const rawPayload = typeof parsed.raw === "string" ? parsed.raw : null
        let packetObj: unknown = parsed.parsed
        if (!packetObj && rawPayload) {
            try {
                packetObj = parseUniqueJson(rawPayload)
            } catch {
                return { handled: false }
            }
        }
        if (!isStateFingerprintPacket(packetObj)) {
            return { handled: false }
        }
        const viewerId = Number(parsed.viewerId ?? 0)
        const connectionId = String(parsed.connectionId ?? "")
        const roomNumber = String(parsed.roomNumber ?? "unknown")
        const generation = Number(parsed.generation ?? 0)
        const sceneEpoch = Number(parsed.sceneEpoch ?? 0)
        const roomInstanceId = String(parsed.roomInstanceId ?? `room-inst-${roomNumber}`)
        const battleSessionId = String(parsed.battleSessionId ?? `battle-${roomNumber}-g${generation}`)
        const res = this.receivePacket(
            {
                observerId: connectionId || `viewer:${viewerId}`,
                viewerId,
                connectionId,
                connectionGeneration: Number(parsed.connectionGeneration ?? 0),
                roomNumber,
                roomInstanceId,
                battleSessionId,
                generation,
                sceneEpoch,
                expectedMembers,
            },
            rawPayload ?? packetObj,
        )
        return { handled: true, accepted: res.accepted, reason: res.reason }
    }

    /**
     * Force-flushes any incomplete or out-of-order sequences across all active buckets
     * (e.g. on socket close, scene transition, or test inspection after missing packets).
     */
    flushPending(runKeyOrId?: string): void {
        const targets = runKeyOrId
            ? [...this.runs.values()].filter(
                r => r.identity.runId === runKeyOrId
                    || r.identity.battleSessionId === runKeyOrId
                    || r.identity.roomNumber === runKeyOrId,
            )
            : [...this.runs.values()]
        for (const bucket of targets) {
            for (const conn of bucket.connections.values()) {
                for (const epochState of conn.epochs.values()) {
                    this.drainEpochReadyBatches(bucket, conn, epochState, true)
                }
            }
        }
    }

    noteConnectionClosed(context: ObserverContextInput): void {
        if (!this.isEnabled()) return
        const roomInstanceId = context.roomInstanceId || `room-inst-${context.roomNumber}`
        const battleSessionId = context.battleSessionId || `battle-${context.roomNumber}-g${context.generation ?? 0}`
        const sceneEpoch = context.sceneEpoch ?? 0
        const matchingBuckets = [...this.runs.values()].filter(
            b => b.identity.roomInstanceId === roomInstanceId
                && b.identity.battleSessionId === battleSessionId
                && b.identity.sceneEpoch === sceneEpoch,
        )
        const buckets = matchingBuckets.length > 0 ? matchingBuckets : [this.ensureRunBucket(context)]
        const observerId = context.observerId || context.connectionId || `viewer:${context.viewerId}`
        for (const bucket of buckets) {
            const conn = this.getOrCreateConnectionState(bucket, observerId, context)
            for (const epochState of conn.epochs.values()) {
                this.drainEpochReadyBatches(bucket, conn, epochState, true)
                this.invalidateEpochBaselines(epochState)
            }
            this.recordServerGap(bucket, observerId, {
                reason: "connection_closed",
                battleId: null,
                battleEpoch: null,
                fromFrame: null,
                toFrame: null,
                fromSeq: null,
                toSeq: null,
                fromEventId: null,
                toEventId: null,
            })
        }
    }

    private applyLogicalBatch(
        bucket: RunBucketState,
        conn: ConnectionStreamState,
        epochState: EpochStreamState,
        item: ReadyBatchItem,
    ): void {
        const { batch } = item

        // 1. Validate & apply client-reported gaps first
        for (const rawGap of batch.gaps) {
            try {
                const gap = validateGapEntry(rawGap)
                this.invalidateEpochBaselines(epochState, gap.battleId, gap.battleEpoch)
                bucket.comparator.addGap(conn.observerId, gap)
                this.appendJsonl(bucket, {
                    type: "gap",
                    ts: Date.now(),
                    runId: bucket.identity.runId,
                    roomNumber: bucket.identity.roomNumber,
                    battleSessionId: bucket.identity.battleSessionId,
                    sceneEpoch: bucket.identity.sceneEpoch,
                    observerId: conn.observerId,
                    seq: item.seq,
                    gap,
                })
            } catch (error) {
                this.invalidateEpochBaselines(epochState)
                this.recordServerGap(bucket, conn.observerId, {
                    reason: "sampling_error",
                    battleId: null,
                    battleEpoch: null,
                    fromFrame: null,
                    toFrame: null,
                    fromSeq: item.seq,
                    toSeq: item.seq,
                    fromEventId: null,
                    toEventId: null,
                    detail: `invalid gap entry: ${(error as Error).message}`,
                })
                return
            }
        }

        // 2. Validate & apply batch events
        const normalizedEvents: NormalizedEventEntry[] = []
        for (const rawEvent of batch.events) {
            try {
                const ev = validateEventEntry(rawEvent)
                if (ev.eventId !== epochState.nextExpectedEventId) {
                    epochState.eventGapDetected = true
                    const fromEv = epochState.nextExpectedEventId
                    const toEv = ev.eventId > fromEv ? ev.eventId - 1 : ev.eventId
                    this.recordServerGap(bucket, conn.observerId, {
                        reason: "event_loss",
                        battleId: ev.battleId,
                        battleEpoch: ev.battleEpoch,
                        fromFrame: null,
                        toFrame: null,
                        fromSeq: item.seq,
                        toSeq: item.seq,
                        fromEventId: fromEv,
                        toEventId: toEv,
                        detail: `expected eventId ${fromEv}, got ${ev.eventId}`,
                    })
                    epochState.nextExpectedEventId = ev.eventId + 1
                } else {
                    if (!epochState.eventGapDetected) {
                        epochState.contiguousEventWaterMark = ev.eventId
                    }
                    epochState.nextExpectedEventId = ev.eventId + 1
                }
                normalizedEvents.push(ev)
            } catch (error) {
                epochState.eventGapDetected = true
                this.recordServerGap(bucket, conn.observerId, {
                    reason: "event_loss",
                    battleId: null,
                    battleEpoch: null,
                    fromFrame: null,
                    toFrame: null,
                    fromSeq: item.seq,
                    toSeq: item.seq,
                    fromEventId: null,
                    toEventId: null,
                    detail: `invalid event entry: ${(error as Error).message}`,
                })
                return
            }
        }
        if (normalizedEvents.length > 0) {
            bucket.comparator.addEvents(conn.observerId, normalizedEvents)
            this.appendJsonl(bucket, {
                type: "events",
                ts: Date.now(),
                runId: bucket.identity.runId,
                roomNumber: bucket.identity.roomNumber,
                battleSessionId: bucket.identity.battleSessionId,
                sceneEpoch: bucket.identity.sceneEpoch,
                observerId: conn.observerId,
                epoch: item.epoch,
                seq: item.seq,
                events: normalizedEvents,
            })
        }

        // 3. Validate & apply rows in sampling order
        for (const rawRow of batch.rows) {
            const peekBattleId = isPlainObject(rawRow) && typeof rawRow.battleId === "string" ? rawRow.battleId : null
            const peekBattleEpoch = isPlainObject(rawRow) && isNInt(rawRow.battleEpoch) ? rawRow.battleEpoch : null
            const baselineKey = peekBattleId !== null && peekBattleEpoch !== null
                ? `${peekBattleId}#${peekBattleEpoch}`
                : "__invalid__"
            let baseline = epochState.baselines.get(baselineKey)
            if (!baseline && baselineKey !== "__invalid__") {
                baseline = {
                    lastFrame: null,
                    state: null,
                    seenFrames: new Set(),
                    hasInitialOrGap: batch.gaps.some(
                        g => isPlainObject(g)
                            && g.reason === "initial_missing"
                            && (g.battleId === null || g.battleId === peekBattleId),
                    ),
                }
                epochState.baselines.set(baselineKey, baseline)
            }

            try {
                const applied = applyRowToState(
                    baseline?.state ?? null,
                    baseline?.lastFrame ?? null,
                    rawRow,
                    item.schema,
                )
                const bState = baseline!
                if (bState.seenFrames.has(applied.postFrame)) {
                    throw new Error(`duplicate postFrame ${applied.postFrame} for battle ${applied.battleId}#${applied.battleEpoch}`)
                }
                if (bState.seenFrames.size === 0 && applied.postFrame > 0 && !bState.hasInitialOrGap) {
                    // First observed row is postFrame > 0 without explicit initial_missing gap
                    this.recordServerGap(bucket, conn.observerId, {
                        reason: "initial_missing",
                        battleId: applied.battleId,
                        battleEpoch: applied.battleEpoch,
                        fromFrame: 0,
                        toFrame: applied.postFrame - 1,
                        fromSeq: item.seq,
                        toSeq: item.seq,
                        fromEventId: null,
                        toEventId: null,
                        detail: "first_observed_row_nonzero_without_initial_missing_gap",
                    })
                    bState.hasInitialOrGap = true
                }
                if (applied.postFrame === 0 && applied.phase === "initial") {
                    bState.hasInitialOrGap = true
                }

                bState.seenFrames.add(applied.postFrame)
                bState.lastFrame = applied.postFrame
                bState.state = applied.state

                const eventContextComplete = !epochState.eventGapDetected
                    && (applied.eventCursor === null || epochState.contiguousEventWaterMark >= applied.eventCursor)
                const groupHashes = computeStateGroupHashes(applied.state)
                const sortedValues: Record<string, unknown> = {}
                for (const [k, v] of [...applied.state.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
                    sortedValues[k] = v
                }

                const observation: ReconstructedFrameObservation = {
                    observerId: conn.observerId,
                    viewerId: conn.viewerId,
                    connectionId: conn.connectionId,
                    connectionGeneration: conn.connectionGeneration,
                    clientEpoch: item.epoch,
                    seq: item.seq,
                    parts: item.parts,
                    build: item.build,
                    schema: item.schema,
                    battleId: applied.battleId,
                    battleEpoch: applied.battleEpoch,
                    postFrame: applied.postFrame,
                    phase: applied.phase,
                    zone: applied.zone,
                    floor: applied.floor,
                    mode: applied.mode,
                    baseFrame: applied.baseFrame,
                    eventCursor: applied.eventCursor,
                    eventContextComplete,
                    inputs: applied.inputs,
                    unsupported: applied.unsupported,
                    ...(applied.inputSummary !== undefined ? { inputSummary: applied.inputSummary } : {}),
                    ...(applied.routeSummary !== undefined ? { routeSummary: applied.routeSummary } : {}),
                    ...(applied.sampleInterval !== undefined ? { sampleInterval: applied.sampleInterval } : {}),
                    ...(applied.previousCheckpointFrame !== undefined ? { previousCheckpointFrame: applied.previousCheckpointFrame } : {}),
                    state: applied.state,
                    groupHashes,
                }

                this.appendJsonl(bucket, {
                    type: "row",
                    ts: Date.now(),
                    runId: bucket.identity.runId,
                    roomNumber: bucket.identity.roomNumber,
                    roomInstanceId: bucket.identity.roomInstanceId,
                    battleSessionId: bucket.identity.battleSessionId,
                    generation: bucket.identity.generation,
                    sceneEpoch: bucket.identity.sceneEpoch,
                    observer: {
                        id: conn.observerId,
                        viewerId: conn.viewerId,
                        connectionId: conn.connectionId,
                        connectionGeneration: conn.connectionGeneration,
                    },
                    build: item.build,
                    schema: item.schema,
                    epoch: item.epoch,
                    seq: item.seq,
                    parts: item.parts,
                    battleId: applied.battleId,
                    battleEpoch: applied.battleEpoch,
                    postFrame: applied.postFrame,
                    phase: applied.phase,
                    zone: applied.zone,
                    floor: applied.floor,
                    mode: applied.mode,
                    baseFrame: applied.baseFrame,
                    eventCursor: applied.eventCursor,
                    eventContextComplete,
                    inputs: applied.inputs,
                    unsupported: applied.unsupported,
                    ...(applied.inputSummary !== undefined ? { inputSummary: applied.inputSummary } : {}),
                    ...(applied.routeSummary !== undefined ? { routeSummary: applied.routeSummary } : {}),
                    ...(applied.sampleInterval !== undefined ? { sampleInterval: applied.sampleInterval } : {}),
                    ...(applied.previousCheckpointFrame !== undefined ? { previousCheckpointFrame: applied.previousCheckpointFrame } : {}),
                    groupHashes,
                    values: sortedValues,
                })

                bucket.comparator.addFrameObservation(observation)
            } catch (error) {
                if (baseline) {
                    baseline.state = null
                    baseline.lastFrame = null
                }
                const errReason = (error as Error & { reason?: string }).reason ?? "sampling_error"
                this.recordServerGap(bucket, conn.observerId, {
                    reason: errReason === "broken_delta_chain" ? "sampling_error" : errReason,
                    battleId: peekBattleId,
                    battleEpoch: peekBattleEpoch,
                    fromFrame: isPlainObject(rawRow) && isNInt(rawRow.postFrame) ? rawRow.postFrame : null,
                    toFrame: isPlainObject(rawRow) && isNInt(rawRow.postFrame) ? rawRow.postFrame : null,
                    fromSeq: item.seq,
                    toSeq: item.seq,
                    fromEventId: null,
                    toEventId: null,
                    detail: (error as Error).message,
                })
                if (errReason === "broken_delta_chain") {
                    bucket.comparator.noteObserverIssue(conn.observerId, "broken_delta_chain")
                }
            }
        }
    }
}

export const stateFingerprintService = new StateFingerprintService()

function resolveFrozenExpectedMembers(client: SessionClient, room: MultiRoom | undefined): FrozenObserverMember[] {
    const members: FrozenObserverMember[] = []
    const seenViewerIds = new Set<number>()
    const seenConnectionIds = new Set<string>()

    const addMember = (viewerId: number, connectionId: string) => {
        if (viewerId > 0 && seenViewerIds.has(viewerId)) return
        if (connectionId && seenConnectionIds.has(connectionId)) return
        if (viewerId > 0) seenViewerIds.add(viewerId)
        if (connectionId) seenConnectionIds.add(connectionId)
        const observerId = connectionId || `viewer:${viewerId}`
        members.push({ observerId, viewerId, connectionId })
    }

    if (room) {
        const contract = getBattleSessionContract(room, client.battleSessionId ?? room.lifecycle?.battleSessionId)
            ?? ensureBattleSessionContract(room)
        if (contract) {
            for (const viewerId of contract.viewerIds) {
                const binding = contract.members.get(viewerId)
                const frozenFiveBossCid = (room.five_boss_runtime?.battleIdentityByViewerId as Record<string, { connectionId?: string }> | undefined)?.[String(viewerId)]?.connectionId
                const lobbyCid = sessionManager.getClient(viewerId, client.roomNumber)?.connectionId
                const cid = (viewerId === client.viewerId ? client.connectionId : "")
                    || binding?.connectionId
                    || frozenFiveBossCid
                    || lobbyCid
                    || ""
                addMember(viewerId, cid)
            }
        } else {
            const viewerIds = room.expected_real_viewer_ids?.length > 0
                ? room.expected_real_viewer_ids
                : room.member_viewer_ids ?? []
            for (const viewerId of viewerIds) {
                const frozenFiveBossCid = (room.five_boss_runtime?.battleIdentityByViewerId as Record<string, { connectionId?: string }> | undefined)?.[String(viewerId)]?.connectionId
                const lobbyCid = sessionManager.getClient(viewerId, client.roomNumber)?.connectionId
                const cid = (viewerId === client.viewerId ? client.connectionId : "")
                    || frozenFiveBossCid
                    || lobbyCid
                    || ""
                addMember(viewerId, cid)
            }
        }
    }

    if (members.length === 0 && Array.isArray(client.mates) && client.mates.length > 0) {
        for (const mate of client.mates) {
            if (!mate || mate.comId) continue
            const vId = Number(mate.viewerId ?? mate.viewer_id ?? 0)
            const cId = String(mate.connectionId ?? mate.connection_id ?? "")
            if (vId > 0 || cId) addMember(vId, cId)
        }
    }

    return members
}

/**
 * Called by `battle.ts` when a Heartbeat Notify (`tag === 5`) carries an extension (`[5, P]`).
 * Never relays and never sends a Heartbeat ACK.
 * When `MULTI_FINGERPRINT_DIR` is not set, exits immediately with zero overhead.
 */
export function handleBattleFingerprintNotify(
    socket: net.Socket,
    notifyData: unknown[],
    indexedClient?: SessionClient,
): void {
    if (!stateFingerprintService.isEnabled()) return
    const client = indexedClient ?? sessionManager.findClientBySocket(socket)
    if (!client || !client.isBattle || !sessionManager.isCurrentBattleClient(client)) return

    const room = getRoom(client.roomNumber)
    const expectedMembers = resolveFrozenExpectedMembers(client, room)
    const context: ObserverContextInput = {
        observerId: client.connectionId || `viewer:${client.viewerId}`,
        viewerId: client.viewerId,
        connectionId: client.connectionId,
        connectionGeneration: client.connectionGeneration ?? 0,
        roomNumber: client.roomNumber,
        roomInstanceId: client.roomInstanceId ?? room?.lifecycle?.instanceId ?? `room-inst-${client.roomNumber}`,
        battleSessionId: client.battleSessionId ?? room?.lifecycle?.battleSessionId ?? `battle-${client.roomNumber}-g${client.roomGeneration}`,
        generation: client.roomGeneration ?? room?.lobby_generation ?? 0,
        sceneEpoch: client.sceneEpoch ?? room?.lifecycle?.sceneEpoch ?? 0,
        expectedMembers,
    }

    if (!stateFingerprintService["trackedSockets"].has(socket)) {
        stateFingerprintService["trackedSockets"].add(socket)
        socket.once("close", () => {
            if (stateFingerprintService.isEnabled()) {
                stateFingerprintService.noteConnectionClosed(context)
            }
        })
    }

    stateFingerprintService.receivePacket(context, [0, notifyData])
}
