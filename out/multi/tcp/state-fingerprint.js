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
exports.handleBattleFingerprintNotify = exports.stateFingerprintService = exports.StateFingerprintService = exports.applyRowToState = exports.validateGapEntry = exports.validateCompactRouteSummary = exports.validateCompactInputSummary = exports.validateEventEntry = exports.validateInputsArray = exports.validateUnsupportedArray = exports.reassembleFragments = exports.validateLogicalBatchObject = exports.validateFingerprintPacket = exports.peekPacketSchema = exports.computeCompactSummaryHash = exports.computeCompactSetDigest = exports.validateEnumValue = exports.validateValueTree = exports.encodeF64Bits = exports.decodeF64Bits = exports.parseUniqueJson = exports.isPlainObject = exports.isNInt = exports.isU32 = exports.isI32 = exports.sanitizeRunFilenamePart = exports.isStateFingerprintPacket = exports.isStateFingerprintNotify = exports.isStateFingerprintEnabled = exports.getFingerprintOutputDir = exports.DEFAULT_BUFFER_LIMIT_BYTES = exports.DEFAULT_BUCKET_CAPACITY_BYTES = exports.DEFAULT_RATE_BYTES_PER_SEC = exports.MAX_VALUE_TREE_DEPTH = exports.COMPACT_V2_CLIENT_RATE_BYTES_PER_SEC = exports.DEFAULT_MAX_REASSEMBLY_TOTAL_MS = exports.FRAGMENT_WAIT_TIMEOUT_MS = exports.MAX_PENDING_SEQS = exports.MAX_PARTS = exports.MAX_BUILD_UTF8_BYTES = exports.MAX_LOGICAL_BATCH_BYTES = exports.MAX_PHYSICAL_PACKET_BYTES = exports.ALLOWED_FINGERPRINT_SCHEMAS = exports.FINGERPRINT_COMPACT_V2_SCHEMA = exports.FINGERPRINT_SCHEMA = exports.FINGERPRINT_VERSION = exports.FINGERPRINT_KIND = exports.computeStateGroupHashes = exports.canonicalJson = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const node_perf_hooks_1 = require("node:perf_hooks");
const SessionManager_1 = require("../state/SessionManager");
const manager_1 = require("../room/manager");
const battle_contract_1 = require("../state/battle-contract");
const state_fingerprint_compare_1 = require("./state-fingerprint-compare");
Object.defineProperty(exports, "canonicalJson", { enumerable: true, get: function () { return state_fingerprint_compare_1.canonicalJson; } });
Object.defineProperty(exports, "computeStateGroupHashes", { enumerable: true, get: function () { return state_fingerprint_compare_1.computeStateGroupHashes; } });
exports.FINGERPRINT_KIND = "wf-fp";
exports.FINGERPRINT_VERSION = 1;
exports.FINGERPRINT_SCHEMA = "coop-state-fingerprint-v1";
exports.FINGERPRINT_COMPACT_V2_SCHEMA = "coop-state-fingerprint-compact-v2";
exports.ALLOWED_FINGERPRINT_SCHEMAS = new Set([
    exports.FINGERPRINT_SCHEMA,
    exports.FINGERPRINT_COMPACT_V2_SCHEMA,
]);
exports.MAX_PHYSICAL_PACKET_BYTES = 16384;
exports.MAX_LOGICAL_BATCH_BYTES = 4194304;
exports.MAX_BUILD_UTF8_BYTES = 128;
exports.MAX_PARTS = 512;
exports.MAX_PENDING_SEQS = 512;
exports.FRAGMENT_WAIT_TIMEOUT_MS = 5000;
exports.DEFAULT_MAX_REASSEMBLY_TOTAL_MS = 300000;
exports.COMPACT_V2_CLIENT_RATE_BYTES_PER_SEC = 20000;
exports.MAX_VALUE_TREE_DEPTH = 64;
exports.DEFAULT_RATE_BYTES_PER_SEC = 65536;
exports.DEFAULT_BUCKET_CAPACITY_BYTES = 16384;
exports.DEFAULT_BUFFER_LIMIT_BYTES = 4194304;
const ALLOWED_UNSUPPORTED_REASONS = new Set([
    "rng_type",
    "enum_variant",
    "field_shape",
    "address_shape",
    "read_error",
]);
const ALLOWED_EVENT_STAGES = new Set([
    "route_received",
    "route_decoded",
    "route_rejected",
    "speed_received",
    "speed_applied",
    "lifecycle",
]);
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
]);
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
]);
const F64_WIRE_REGEX = /^f64:[0-9a-f]{16}$/;
const UNPAIRED_SURROGATE_REGEX = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function getFingerprintOutputDir(env = process.env) {
    var _a;
    return ((_a = env.MULTI_FINGERPRINT_DIR) !== null && _a !== void 0 ? _a : "").trim();
}
exports.getFingerprintOutputDir = getFingerprintOutputDir;
function isStateFingerprintEnabled(env = process.env) {
    return getFingerprintOutputDir(env).length > 0;
}
exports.isStateFingerprintEnabled = isStateFingerprintEnabled;
/**
 * Any BattleNotifyMessage tag 5 with extra payload elements (`[5, P]`) is treated
 * as a fingerprint/extended heartbeat marker: it must NEVER fall back to normal
 * Heartbeat ACK or be relayed to peers.
 */
function isStateFingerprintNotify(notify) {
    return Array.isArray(notify) && notify[0] === 5 && notify.length > 1;
}
exports.isStateFingerprintNotify = isStateFingerprintNotify;
function isStateFingerprintPacket(packet) {
    return Array.isArray(packet) && packet.length === 2 && packet[0] === 0 && isStateFingerprintNotify(packet[1]);
}
exports.isStateFingerprintPacket = isStateFingerprintPacket;
function sanitizeRunFilenamePart(runId) {
    const cleaned = String(runId).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || "run";
}
exports.sanitizeRunFilenamePart = sanitizeRunFilenamePart;
function isI32(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}
exports.isI32 = isI32;
function isU32(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4294967295;
}
exports.isU32 = isU32;
function isNInt(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
exports.isNInt = isNInt;
function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
exports.isPlainObject = isPlainObject;
/**
 * Strict JSON parser that rejects duplicate object keys at any nesting depth.
 */
function parseUniqueJson(text) {
    if (typeof text !== "string")
        throw new Error("JSON input must be a string");
    const parsed = JSON.parse(text);
    const stack = [];
    const len = text.length;
    let i = 0;
    while (i < len) {
        const ch = text[i];
        if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
            i++;
            continue;
        }
        if (ch === "{") {
            stack.push({ type: "object", keys: new Set(), expectingKey: true });
            i++;
            continue;
        }
        if (ch === "}") {
            stack.pop();
            i++;
            continue;
        }
        if (ch === "[") {
            stack.push({ type: "array" });
            i++;
            continue;
        }
        if (ch === "]") {
            stack.pop();
            i++;
            continue;
        }
        if (ch === ":") {
            i++;
            continue;
        }
        if (ch === ",") {
            const top = stack[stack.length - 1];
            if (top && top.type === "object")
                top.expectingKey = true;
            i++;
            continue;
        }
        if (ch === '"') {
            const start = i;
            i++;
            while (i < len) {
                const c = text[i];
                if (c === "\\") {
                    i += 2;
                    continue;
                }
                if (c === '"') {
                    i++;
                    break;
                }
                i++;
            }
            const top = stack[stack.length - 1];
            if (top && top.type === "object" && top.expectingKey) {
                const key = JSON.parse(text.slice(start, i));
                if (top.keys.has(key)) {
                    throw new Error(`duplicate object key: ${key}`);
                }
                top.keys.add(key);
                top.expectingKey = false;
            }
            continue;
        }
        while (i < len && !" \t\r\n,}:]".includes(text[i]))
            i++;
    }
    return parsed;
}
exports.parseUniqueJson = parseUniqueJson;
function decodeF64Bits(wire) {
    if (typeof wire !== "string" || !F64_WIRE_REGEX.test(wire)) {
        throw new Error(`invalid f64 wire value: ${String(wire)}`);
    }
    const bigEndianHex = wire.slice(4);
    const bytes = Buffer.from(bigEndianHex, "hex");
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
    const float64 = view.getFloat64(0, false);
    return { wire, bigEndianHex, bytes, float64 };
}
exports.decodeF64Bits = decodeF64Bits;
function encodeF64Bits(value) {
    const bytes = Buffer.alloc(8);
    if (typeof value === "number") {
        const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
        view.setFloat64(0, value, false);
    }
    else {
        if (value.byteLength !== 8)
            throw new Error("f64 byte buffer must be 8 bytes");
        Buffer.from(value.buffer, value.byteOffset, 8).copy(bytes);
    }
    return `f64:${bytes.toString("hex")}`;
}
exports.encodeF64Bits = encodeF64Bits;
function validateValueTree(value, depth = 0) {
    if (depth > exports.MAX_VALUE_TREE_DEPTH) {
        throw new Error(`value tree exceeded max depth ${exports.MAX_VALUE_TREE_DEPTH}`);
    }
    if (value === null || typeof value === "boolean")
        return;
    if (typeof value === "number") {
        if (!isI32(value)) {
            throw new Error(`invalid numeric value in value tree (bare float or out-of-range i32): ${value}`);
        }
        return;
    }
    if (typeof value === "string") {
        if (value.startsWith("f64:") && !F64_WIRE_REGEX.test(value)) {
            throw new Error(`invalid f64 string: ${value}`);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            validateValueTree(item, depth + 1);
        return;
    }
    if (isPlainObject(value)) {
        for (const v of Object.values(value))
            validateValueTree(v, depth + 1);
        return;
    }
    throw new Error(`unsupported value type in value tree: ${typeof value}`);
}
exports.validateValueTree = validateValueTree;
function validateEnumValue(value, depth = 0) {
    if (!Array.isArray(value) || value.length < 1 || !isI32(value[0])) {
        throw new Error("enum value must be [index:i32, ...params]");
    }
    validateValueTree(value, depth);
    return true;
}
exports.validateEnumValue = validateEnumValue;
function computeCompactSetDigest(records, includeEntries = false) {
    const ordered = [...records].sort();
    const joined = ordered.join("\n");
    let a = 5381 | 0;
    let b = 0 | 0;
    for (let i = 0; i < joined.length; i++) {
        const c = joined.charCodeAt(i);
        a = (Math.imul(a, 33) ^ c) | 0;
        b = (Math.imul(b, 65599) + c) | 0;
    }
    const result = {
        count: ordered.length,
        hash: `d32:${a >>> 0}:${b >>> 0}`,
    };
    if (includeEntries && ordered.length <= 4) {
        result.entries = ordered;
    }
    return result;
}
exports.computeCompactSetDigest = computeCompactSetDigest;
function computeCompactSummaryHash(prevHash, value) {
    const text = value === null ? "null" : typeof value === "string" ? `s:${value}` : `n:${String(value)}`;
    let h = (Math.imul(prevHash | 0, 31) ^ text.length) | 0;
    for (let i = 0; i < text.length; i++) {
        h = (Math.imul(h, 31) ^ text.charCodeAt(i)) | 0;
    }
    return h;
}
exports.computeCompactSummaryHash = computeCompactSummaryHash;
function peekPacketSchema(rawOrParsed) {
    if (typeof rawOrParsed === "string") {
        if (rawOrParsed.includes(exports.FINGERPRINT_COMPACT_V2_SCHEMA)) {
            return exports.FINGERPRINT_COMPACT_V2_SCHEMA;
        }
        return exports.FINGERPRINT_SCHEMA;
    }
    if (Array.isArray(rawOrParsed) && Array.isArray(rawOrParsed[1]) && isPlainObject(rawOrParsed[1][1])) {
        if (rawOrParsed[1][1].schema === exports.FINGERPRINT_COMPACT_V2_SCHEMA) {
            return exports.FINGERPRINT_COMPACT_V2_SCHEMA;
        }
    }
    return exports.FINGERPRINT_SCHEMA;
}
exports.peekPacketSchema = peekPacketSchema;
function validateFingerprintPacket(rawOrParsed) {
    let parsed;
    let physicalBytes;
    if (typeof rawOrParsed === "string") {
        physicalBytes = Buffer.byteLength(rawOrParsed, "utf8") + 1;
        if (physicalBytes > exports.MAX_PHYSICAL_PACKET_BYTES) {
            const err = new Error(`physical packet exceeded ${exports.MAX_PHYSICAL_PACKET_BYTES} bytes (${physicalBytes})`);
            err.reason = "oversize";
            throw err;
        }
        parsed = parseUniqueJson(rawOrParsed);
    }
    else {
        parsed = rawOrParsed;
        const compact = JSON.stringify(parsed);
        physicalBytes = Buffer.byteLength(compact !== null && compact !== void 0 ? compact : "", "utf8") + 1;
        if (physicalBytes > exports.MAX_PHYSICAL_PACKET_BYTES) {
            const err = new Error(`physical packet exceeded ${exports.MAX_PHYSICAL_PACKET_BYTES} bytes (${physicalBytes})`);
            err.reason = "oversize";
            throw err;
        }
    }
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== 0) {
        throw new Error("outer packet must be [0, [5, P]]");
    }
    const notify = parsed[1];
    if (!Array.isArray(notify) || notify.length !== 2 || notify[0] !== 5) {
        throw new Error("inner notify must be [5, P]");
    }
    const p = notify[1];
    if (!isPlainObject(p)) {
        throw new Error("payload P must be a plain object");
    }
    if (p.kind !== exports.FINGERPRINT_KIND) {
        throw new Error(`unsupported kind: ${String(p.kind)}`);
    }
    if (p.v !== exports.FINGERPRINT_VERSION) {
        throw new Error(`unsupported version: ${String(p.v)}`);
    }
    if (typeof p.schema !== "string" || !exports.ALLOWED_FINGERPRINT_SCHEMAS.has(p.schema)) {
        throw new Error(`unsupported schema: ${String(p.schema)}`);
    }
    const schema = p.schema;
    if (typeof p.build !== "string" || p.build.length === 0 || Buffer.byteLength(p.build, "utf8") > exports.MAX_BUILD_UTF8_BYTES) {
        throw new Error("invalid build identifier");
    }
    if (!isNInt(p.epoch)) {
        throw new Error("invalid epoch");
    }
    if (!isNInt(p.seq)) {
        throw new Error("invalid seq");
    }
    if (!isNInt(p.part) || !isNInt(p.parts) || p.parts < 1 || p.parts > exports.MAX_PARTS || p.part >= p.parts) {
        throw new Error("invalid part/parts");
    }
    const keys = Object.keys(p);
    if (p.parts === 1) {
        if (p.part !== 0 || "chunk" in p) {
            throw new Error("unfragmented packet must have part=0 and no chunk");
        }
        const allowed = new Set(["kind", "v", "schema", "build", "epoch", "seq", "part", "parts", "rows", "events", "gaps"]);
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("invalid envelope keys for parts=1");
        }
        if (!Array.isArray(p.rows) || !Array.isArray(p.events) || !Array.isArray(p.gaps)) {
            throw new Error("rows, events, and gaps must be arrays");
        }
        return {
            kind: exports.FINGERPRINT_KIND,
            v: exports.FINGERPRINT_VERSION,
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
        };
    }
    else {
        if ("rows" in p || "events" in p || "gaps" in p) {
            throw new Error("fragment packet must not contain rows/events/gaps");
        }
        const allowed = new Set(["kind", "v", "schema", "build", "epoch", "seq", "part", "parts", "chunk"]);
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("invalid envelope keys for parts>1");
        }
        if (typeof p.chunk !== "string" || p.chunk.length === 0) {
            throw new Error("fragment chunk must be a non-empty string");
        }
        if (UNPAIRED_SURROGATE_REGEX.test(p.chunk)) {
            throw new Error("fragment chunk split a UTF-16 surrogate pair");
        }
        return {
            kind: exports.FINGERPRINT_KIND,
            v: exports.FINGERPRINT_VERSION,
            schema,
            build: p.build,
            epoch: p.epoch,
            seq: p.seq,
            part: p.part,
            parts: p.parts,
            chunk: p.chunk,
            physicalBytes,
        };
    }
}
exports.validateFingerprintPacket = validateFingerprintPacket;
function validateLogicalBatchObject(raw) {
    if (!isPlainObject(raw)) {
        throw new Error("logical batch L must be an object");
    }
    const keys = Object.keys(raw);
    const allowed = new Set(["rows", "events", "gaps"]);
    if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
        throw new Error("logical batch L must have exact keys rows, events, gaps");
    }
    if (!Array.isArray(raw.rows) || !Array.isArray(raw.events) || !Array.isArray(raw.gaps)) {
        throw new Error("logical batch rows, events, gaps must be arrays");
    }
    return {
        rows: raw.rows,
        events: raw.events,
        gaps: raw.gaps,
    };
}
exports.validateLogicalBatchObject = validateLogicalBatchObject;
/**
 * Reassembles a fragmented logical batch L from an array of fragment envelopes or packets.
 * Deduplicates identical duplicate parts, rejects conflicting duplicates, checks missing parts,
 * verifies <= 4 MiB UTF-8 byte limit, and parses with duplicate-key rejection.
 */
function reassembleFragments(packets) {
    if (!Array.isArray(packets) || packets.length === 0) {
        throw new Error("no packets provided for reassembly");
    }
    const validated = packets.map(pkt => {
        if (isPlainObject(pkt) && pkt.kind === exports.FINGERPRINT_KIND && typeof pkt.physicalBytes === "number") {
            return pkt;
        }
        if (isPlainObject(pkt) && pkt.kind === exports.FINGERPRINT_KIND) {
            return validateFingerprintPacket([0, [5, pkt]]);
        }
        return validateFingerprintPacket(pkt);
    });
    const first = validated[0];
    if (first.parts === 1) {
        for (const p of validated) {
            if (p.schema !== first.schema || p.build !== first.build || p.epoch !== first.epoch || p.seq !== first.seq || p.parts !== 1 || p.part !== 0) {
                throw new Error("conflicting envelope metadata");
            }
            if ((0, state_fingerprint_compare_1.canonicalJson)({ rows: p.rows, events: p.events, gaps: p.gaps }) !==
                (0, state_fingerprint_compare_1.canonicalJson)({ rows: first.rows, events: first.events, gaps: first.gaps })) {
                throw new Error("conflicting duplicate");
            }
        }
        return { rows: first.rows, events: first.events, gaps: first.gaps };
    }
    const cache = new Map();
    for (const p of validated) {
        if (p.schema !== first.schema || p.build !== first.build || p.epoch !== first.epoch || p.seq !== first.seq || p.parts !== first.parts) {
            throw new Error("conflicting envelope metadata");
        }
        if (cache.has(p.part)) {
            if (cache.get(p.part) !== p.chunk) {
                throw new Error("conflicting duplicate");
            }
            continue;
        }
        cache.set(p.part, p.chunk);
    }
    if (cache.size !== first.parts) {
        throw new Error("missing fragment");
    }
    const chunks = [];
    for (let i = 0; i < first.parts; i++) {
        const ch = cache.get(i);
        if (ch === undefined)
            throw new Error("missing fragment");
        chunks.push(ch);
    }
    const text = chunks.join("");
    if (Buffer.byteLength(text, "utf8") > exports.MAX_LOGICAL_BATCH_BYTES) {
        throw new Error("reassembled logical batch exceeded 4MiB");
    }
    return validateLogicalBatchObject(parseUniqueJson(text));
}
exports.reassembleFragments = reassembleFragments;
function validateUnsupportedArray(raw) {
    if (!Array.isArray(raw))
        throw new Error("unsupported must be an array");
    const out = [];
    let prevPath = "";
    for (const item of raw) {
        if (!isPlainObject(item) || Object.keys(item).length !== 2) {
            throw new Error("unsupported item must have {path, reason}");
        }
        const p = item.path;
        const r = item.reason;
        if (typeof p !== "string" || !p.startsWith("/")) {
            throw new Error(`invalid unsupported path: ${String(p)}`);
        }
        if (typeof r !== "string" || !ALLOWED_UNSUPPORTED_REASONS.has(r)) {
            throw new Error(`invalid unsupported reason: ${String(r)}`);
        }
        if (out.length > 0 && p < prevPath) {
            throw new Error("unsupported array must be sorted by path");
        }
        prevPath = p;
        out.push({ path: p, reason: r });
    }
    return out;
}
exports.validateUnsupportedArray = validateUnsupportedArray;
function validateInputsArray(raw, battleId, battleEpoch, postFrame, unsupported) {
    if (!Array.isArray(raw))
        throw new Error("inputs must be an array");
    const unsupportedPaths = new Set(unsupported.map(u => u.path));
    const out = [];
    for (let ordinal = 0; ordinal < raw.length; ordinal++) {
        const item = raw[ordinal];
        if (!isPlainObject(item))
            throw new Error("input entry must be an object");
        const keys = Object.keys(item);
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
        ]);
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("input entry has invalid keys");
        }
        if (item.ordinal !== ordinal) {
            throw new Error(`input ordinal mismatch: expected ${ordinal}, got ${String(item.ordinal)}`);
        }
        if (item.kind !== "User" && item.kind !== "Coop") {
            throw new Error(`invalid input kind: ${String(item.kind)}`);
        }
        if (typeof item.sourceBattleId !== "string" || item.sourceBattleId.length === 0) {
            throw new Error("invalid input sourceBattleId");
        }
        if (item.kind === "User" && item.sourceBattleId !== battleId) {
            throw new Error("User input sourceBattleId must equal targetBattleId");
        }
        if (item.sourceBattleEpoch !== null && !isNInt(item.sourceBattleEpoch)) {
            throw new Error("invalid input sourceBattleEpoch");
        }
        if (item.sourceFrame !== null && !isI32(item.sourceFrame)) {
            throw new Error("invalid input sourceFrame");
        }
        if (item.targetBattleId !== battleId) {
            throw new Error("input targetBattleId must equal row.battleId");
        }
        if (item.battleEpoch !== battleEpoch) {
            throw new Error("input battleEpoch must equal row.battleEpoch");
        }
        if (item.applyTargetFrame !== postFrame - 1) {
            throw new Error("input applyTargetFrame must equal row.postFrame - 1");
        }
        if (item.command === null) {
            if (!unsupportedPaths.has(`/inputs/${ordinal}/command`)) {
                throw new Error(`null input command at ordinal ${ordinal} must be listed in row.unsupported`);
            }
        }
        else {
            validateEnumValue(item.command);
        }
        out.push({
            ordinal,
            kind: item.kind,
            sourceBattleId: item.sourceBattleId,
            sourceBattleEpoch: item.sourceBattleEpoch,
            sourceFrame: item.sourceFrame,
            targetBattleId: item.targetBattleId,
            battleEpoch: item.battleEpoch,
            applyTargetFrame: item.applyTargetFrame,
            command: item.command,
        });
    }
    return out;
}
exports.validateInputsArray = validateInputsArray;
function validateEventEntry(raw) {
    if (!isPlainObject(raw))
        throw new Error("event entry must be an object");
    const keys = Object.keys(raw);
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
    ]);
    if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
        throw new Error("event entry has invalid keys");
    }
    if (!isNInt(raw.eventId))
        throw new Error("invalid eventId");
    if (typeof raw.stage !== "string" || !ALLOWED_EVENT_STAGES.has(raw.stage)) {
        throw new Error(`invalid event stage: ${String(raw.stage)}`);
    }
    if (raw.battleId !== null && (typeof raw.battleId !== "string" || raw.battleId.length === 0)) {
        throw new Error("invalid event battleId");
    }
    if (raw.battleEpoch !== null && !isNInt(raw.battleEpoch)) {
        throw new Error("invalid event battleEpoch");
    }
    if (raw.targetFrame !== null && !isNInt(raw.targetFrame)) {
        throw new Error("invalid event targetFrame");
    }
    if (raw.stage === "speed_applied" && raw.targetFrame === null) {
        throw new Error("speed_applied event requires non-null targetFrame");
    }
    if (raw.sourceBattleId !== null && (typeof raw.sourceBattleId !== "string" || raw.sourceBattleId.length === 0)) {
        throw new Error("invalid event sourceBattleId");
    }
    if (raw.sourceBattleEpoch !== null && !isNInt(raw.sourceBattleEpoch)) {
        throw new Error("invalid event sourceBattleEpoch");
    }
    if (raw.sourceFrame !== null && !isI32(raw.sourceFrame)) {
        throw new Error("invalid event sourceFrame");
    }
    if (raw.command !== null) {
        validateEnumValue(raw.command);
    }
    if (!isPlainObject(raw.detail)) {
        throw new Error("event detail must be a plain object");
    }
    for (const [dk, dv] of Object.entries(raw.detail)) {
        if (!ALLOWED_EVENT_DETAIL_KEYS.has(dk)) {
            throw new Error(`disallowed event detail key: ${dk}`);
        }
        if ((dk === "reason" || dk === "wire" || dk === "targetOtherBattleId") && typeof dv !== "string") {
            throw new Error(`event detail ${dk} must be string`);
        }
        if ((dk === "speed" || dk === "frame" || dk === "state" || dk === "previousInterval" || dk === "interval" || dk === "elapsedMs") && !isI32(dv)) {
            throw new Error(`event detail ${dk} must be i32`);
        }
        if (dk === "length" && !isI32(dv) && !isNInt(dv)) {
            throw new Error("event detail length must be i32 or nint");
        }
    }
    return {
        eventId: raw.eventId,
        stage: raw.stage,
        battleId: raw.battleId,
        battleEpoch: raw.battleEpoch,
        targetFrame: raw.targetFrame,
        sourceBattleId: raw.sourceBattleId,
        sourceBattleEpoch: raw.sourceBattleEpoch,
        sourceFrame: raw.sourceFrame,
        command: raw.command,
        detail: Object.assign({}, raw.detail),
    };
}
exports.validateEventEntry = validateEventEntry;
function validateCompactInputSummary(raw) {
    if (!isPlainObject(raw)) {
        throw new Error("row.inputSummary must be a plain object");
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
    ]);
    const keys = Object.keys(raw);
    if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
        throw new Error("row.inputSummary has invalid keys");
    }
    for (const ck of ["count", "user", "coop", "unknown", "readErrors"]) {
        if (!isNInt(raw[ck]) || !isI32(raw[ck])) {
            throw new Error(`row.inputSummary.${ck} must be non-negative i32`);
        }
    }
    if (!isI32(raw.orderedHash)) {
        throw new Error("row.inputSummary.orderedHash must be i32");
    }
    if (raw.firstFrame !== null && !isI32(raw.firstFrame)) {
        throw new Error("row.inputSummary.firstFrame must be i32 or null");
    }
    if (raw.lastFrame !== null && !isI32(raw.lastFrame)) {
        throw new Error("row.inputSummary.lastFrame must be i32 or null");
    }
    if (raw.coverage !== "top_level_only") {
        throw new Error(`invalid row.inputSummary.coverage: ${String(raw.coverage)}`);
    }
    if (!isPlainObject(raw.kinds)) {
        throw new Error("row.inputSummary.kinds must be a plain object");
    }
    const kinds = {};
    for (const [k, v] of Object.entries(raw.kinds)) {
        if (k.length === 0) {
            throw new Error("row.inputSummary.kinds key must be non-empty");
        }
        if (!isNInt(v) || !isI32(v) || v < 1) {
            throw new Error(`row.inputSummary.kinds[${k}] must be positive i32`);
        }
        kinds[k] = v;
    }
    return {
        count: raw.count,
        user: raw.user,
        coop: raw.coop,
        unknown: raw.unknown,
        readErrors: raw.readErrors,
        kinds,
        orderedHash: raw.orderedHash,
        firstFrame: raw.firstFrame,
        lastFrame: raw.lastFrame,
        coverage: "top_level_only",
    };
}
exports.validateCompactInputSummary = validateCompactInputSummary;
function validateCompactRouteSummary(raw) {
    if (raw === null)
        return null;
    if (!isPlainObject(raw)) {
        throw new Error("row.routeSummary must be a plain object or null");
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
    ]);
    const keys = Object.keys(raw);
    if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
        throw new Error("row.routeSummary has invalid keys");
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
    ]) {
        if (!isNInt(raw[ck]) || !isI32(raw[ck])) {
            throw new Error(`row.routeSummary.${ck} must be non-negative i32`);
        }
    }
    if (!isI32(raw.orderedHash)) {
        throw new Error("row.routeSummary.orderedHash must be i32");
    }
    if (raw.firstFrame !== null && !isI32(raw.firstFrame)) {
        throw new Error("row.routeSummary.firstFrame must be i32 or null");
    }
    if (raw.lastFrame !== null && !isI32(raw.lastFrame)) {
        throw new Error("row.routeSummary.lastFrame must be i32 or null");
    }
    if (raw.coverage !== "top_level_only") {
        throw new Error(`invalid row.routeSummary.coverage: ${String(raw.coverage)}`);
    }
    if (!isPlainObject(raw.kinds)) {
        throw new Error("row.routeSummary.kinds must be a plain object");
    }
    const kinds = {};
    for (const [k, v] of Object.entries(raw.kinds)) {
        if (k.length === 0) {
            throw new Error("row.routeSummary.kinds key must be non-empty");
        }
        if (!isNInt(v) || !isI32(v) || v < 1) {
            throw new Error(`row.routeSummary.kinds[${k}] must be positive i32`);
        }
        kinds[k] = v;
    }
    return {
        count: raw.count,
        unknown: raw.unknown,
        readErrors: raw.readErrors,
        route_received: raw.route_received,
        route_decoded: raw.route_decoded,
        route_rejected: raw.route_rejected,
        speed_received: raw.speed_received,
        speed_applied: raw.speed_applied,
        kinds,
        orderedHash: raw.orderedHash,
        firstFrame: raw.firstFrame,
        lastFrame: raw.lastFrame,
        coverage: "top_level_only",
    };
}
exports.validateCompactRouteSummary = validateCompactRouteSummary;
function validateGapEntry(raw) {
    if (!isPlainObject(raw))
        throw new Error("gap entry must be an object");
    const keys = Object.keys(raw);
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
    ]);
    if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
        throw new Error("gap entry has invalid keys");
    }
    if (typeof raw.reason !== "string" || !ALLOWED_GAP_REASONS.has(raw.reason)) {
        throw new Error(`invalid gap reason: ${String(raw.reason)}`);
    }
    if (raw.battleId !== null && (typeof raw.battleId !== "string" || raw.battleId.length === 0)) {
        throw new Error("invalid gap battleId");
    }
    if (raw.battleEpoch !== null && !isNInt(raw.battleEpoch)) {
        throw new Error("invalid gap battleEpoch");
    }
    for (const rk of ["fromFrame", "toFrame", "fromSeq", "toSeq", "fromEventId", "toEventId"]) {
        if (raw[rk] !== null && !isNInt(raw[rk])) {
            throw new Error(`invalid gap ${rk}`);
        }
    }
    return {
        reason: raw.reason,
        battleId: raw.battleId,
        battleEpoch: raw.battleEpoch,
        fromFrame: raw.fromFrame,
        toFrame: raw.toFrame,
        fromSeq: raw.fromSeq,
        toSeq: raw.toSeq,
        fromEventId: raw.fromEventId,
        toEventId: raw.toEventId,
        source: "client",
    };
}
exports.validateGapEntry = validateGapEntry;
function applyRowToState(previousState, previousFrame, rawRow, schema) {
    if (!isPlainObject(rawRow))
        throw new Error("row must be a plain object");
    const battleId = rawRow.battleId;
    if (typeof battleId !== "string" || battleId.length === 0) {
        throw new Error("row.battleId must be a non-empty string");
    }
    if (!isNInt(rawRow.battleEpoch))
        throw new Error("row.battleEpoch must be nint");
    if (!isNInt(rawRow.postFrame) || !isI32(rawRow.postFrame)) {
        throw new Error("row.postFrame must be non-negative i32/nint");
    }
    const battleEpoch = rawRow.battleEpoch;
    const postFrame = rawRow.postFrame;
    const phase = rawRow.phase;
    if (phase !== "initial" && phase !== "post") {
        throw new Error(`invalid row.phase: ${String(phase)}`);
    }
    if (phase === "initial" && postFrame !== 0) {
        throw new Error("initial row must have postFrame=0");
    }
    if (phase === "post" && postFrame < 1) {
        throw new Error("post row must have postFrame>=1");
    }
    if (rawRow.zone !== null && !isI32(rawRow.zone)) {
        throw new Error("row.zone must be i32 or null");
    }
    if (!isI32(rawRow.floor)) {
        throw new Error("row.floor must be i32");
    }
    if (rawRow.eventCursor !== null && !isNInt(rawRow.eventCursor)) {
        throw new Error("row.eventCursor must be nint or null");
    }
    const unsupported = validateUnsupportedArray(rawRow.unsupported);
    const effectiveSchema = schema !== null && schema !== void 0 ? schema : (("inputSummary" in rawRow || "sampleInterval" in rawRow || "previousCheckpointFrame" in rawRow)
        ? exports.FINGERPRINT_COMPACT_V2_SCHEMA
        : exports.FINGERPRINT_SCHEMA);
    const isCompactV2 = effectiveSchema === exports.FINGERPRINT_COMPACT_V2_SCHEMA;
    const keys = Object.keys(rawRow);
    const mode = rawRow.mode;
    if (isCompactV2) {
        if (mode !== "full") {
            throw new Error(`compact-v2 row must use mode=full, got: ${String(mode)}`);
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
        ]);
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("compact-v2 row has invalid keys");
        }
        if (!isI32(rawRow.sampleInterval) || rawRow.sampleInterval < 30 || rawRow.sampleInterval > 300) {
            throw new Error(`invalid compact-v2 row.sampleInterval: ${String(rawRow.sampleInterval)}`);
        }
        if (!isI32(rawRow.previousCheckpointFrame) || rawRow.previousCheckpointFrame < -1) {
            throw new Error(`invalid compact-v2 row.previousCheckpointFrame: ${String(rawRow.previousCheckpointFrame)}`);
        }
        if (phase === "initial" && rawRow.previousCheckpointFrame !== -1) {
            throw new Error("compact-v2 initial row must have previousCheckpointFrame=-1");
        }
        if (phase === "post" && rawRow.previousCheckpointFrame >= postFrame) {
            throw new Error(`compact-v2 post row previousCheckpointFrame (${rawRow.previousCheckpointFrame}) must be < postFrame (${postFrame})`);
        }
        const inputSummary = validateCompactInputSummary(rawRow.inputSummary);
        const routeSummary = validateCompactRouteSummary(rawRow.routeSummary);
        if (!isPlainObject(rawRow.values)) {
            throw new Error("compact-v2 row.values must be a plain object");
        }
        const state = new Map();
        for (const [k, v] of Object.entries(rawRow.values)) {
            if (!k.startsWith("/"))
                throw new Error(`invalid field path: ${k}`);
            validateValueTree(v);
            state.set(k, v);
        }
        if (state.has("/battle/currentFrame") && state.get("/battle/currentFrame") !== postFrame) {
            throw new Error(`/battle/currentFrame (${String(state.get("/battle/currentFrame"))}) must equal postFrame (${postFrame})`);
        }
        if (state.has("/battle/id") && state.get("/battle/id") !== battleId) {
            throw new Error(`/battle/id (${String(state.get("/battle/id"))}) must equal row.battleId (${battleId})`);
        }
        return {
            battleId,
            battleEpoch,
            postFrame,
            phase,
            zone: rawRow.zone,
            floor: rawRow.floor,
            mode: "full",
            baseFrame: null,
            eventCursor: rawRow.eventCursor,
            inputs: [],
            unsupported,
            inputSummary,
            routeSummary,
            sampleInterval: rawRow.sampleInterval,
            previousCheckpointFrame: rawRow.previousCheckpointFrame,
            state,
        };
    }
    const inputs = validateInputsArray(rawRow.inputs, battleId, battleEpoch, postFrame, unsupported);
    if (phase === "initial" && inputs.length !== 0) {
        throw new Error("initial row must have empty inputs");
    }
    if (mode !== "full" && mode !== "delta") {
        throw new Error(`invalid row.mode: ${String(mode)}`);
    }
    let state;
    let baseFrame = null;
    if (mode === "full") {
        if ("baseFrame" in rawRow || "set" in rawRow || "unset" in rawRow) {
            throw new Error("full row must not contain baseFrame, set, or unset");
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
        ]);
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("full row has invalid keys");
        }
        if (!isPlainObject(rawRow.values)) {
            throw new Error("full row.values must be a plain object");
        }
        state = new Map();
        for (const [k, v] of Object.entries(rawRow.values)) {
            if (!k.startsWith("/"))
                throw new Error(`invalid field path: ${k}`);
            validateValueTree(v);
            state.set(k, v);
        }
    }
    else {
        if (phase === "initial") {
            throw new Error("initial row must use mode=full");
        }
        if ("values" in rawRow) {
            throw new Error("delta row must not contain values");
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
        ]);
        if (keys.length !== allowed.size || keys.some(k => !allowed.has(k))) {
            throw new Error("delta row has invalid keys");
        }
        if (!isNInt(rawRow.baseFrame) || rawRow.baseFrame !== postFrame - 1) {
            const err = new Error(`delta row baseFrame (${String(rawRow.baseFrame)}) must equal postFrame - 1 (${postFrame - 1})`);
            err.reason = "broken_delta_chain";
            throw err;
        }
        if (!previousState || previousFrame !== rawRow.baseFrame) {
            const err = new Error(`missing delta baseline at frame ${rawRow.baseFrame} for postFrame ${postFrame}`);
            err.reason = "broken_delta_chain";
            throw err;
        }
        baseFrame = rawRow.baseFrame;
        if (!isPlainObject(rawRow.set) || !Array.isArray(rawRow.unset)) {
            throw new Error("delta row requires set object and unset array");
        }
        const setObj = rawRow.set;
        const unsetArr = rawRow.unset;
        const unsetSet = new Set();
        for (const item of unsetArr) {
            if (typeof item !== "string" || !item.startsWith("/")) {
                throw new Error(`invalid unset path: ${String(item)}`);
            }
            if (unsetSet.has(item)) {
                throw new Error(`duplicate path in unset: ${item}`);
            }
            if (Object.prototype.hasOwnProperty.call(setObj, item)) {
                throw new Error(`set and unset overlap on path: ${item}`);
            }
            unsetSet.add(item);
        }
        state = new Map(previousState);
        for (const key of unsetSet) {
            if (!state.has(key)) {
                const err = new Error(`unset path does not exist in baseline state: ${key}`);
                err.reason = "broken_delta_chain";
                throw err;
            }
            state.delete(key);
        }
        for (const [k, v] of Object.entries(setObj)) {
            if (!k.startsWith("/"))
                throw new Error(`invalid set path: ${k}`);
            validateValueTree(v);
            state.set(k, v);
        }
    }
    if (state.get("/battle/currentFrame") !== postFrame) {
        throw new Error(`/battle/currentFrame (${String(state.get("/battle/currentFrame"))}) must equal postFrame (${postFrame})`);
    }
    if (state.has("/battle/id") && state.get("/battle/id") !== battleId) {
        throw new Error(`/battle/id (${String(state.get("/battle/id"))}) must equal row.battleId (${battleId})`);
    }
    return {
        battleId,
        battleEpoch,
        postFrame,
        phase,
        zone: rawRow.zone,
        floor: rawRow.floor,
        mode,
        baseFrame,
        eventCursor: rawRow.eventCursor,
        inputs,
        unsupported,
        state,
    };
}
exports.applyRowToState = applyRowToState;
class StateFingerprintService {
    constructor(options = {}) {
        this.options = options;
        this.runs = new Map();
        this.trackedSockets = new WeakSet();
        this.diagnostics = {
            packetsReceived: 0,
            packetsAccepted: 0,
            packetsRejected: 0,
            duplicatesIgnored: 0,
            rateLimited: 0,
            writeErrors: 0,
            desyncReports: 0,
        };
    }
    now() {
        return this.options.nowMs ? this.options.nowMs() : node_perf_hooks_1.performance.now();
    }
    resolveOutputDir() {
        if (this.options.outputDir !== undefined)
            return this.options.outputDir.trim();
        return getFingerprintOutputDir();
    }
    isEnabled() {
        return this.resolveOutputDir().length > 0;
    }
    reset() {
        this.runs.clear();
        this.diagnostics = {
            packetsReceived: 0,
            packetsAccepted: 0,
            packetsRejected: 0,
            duplicatesIgnored: 0,
            rateLimited: 0,
            writeErrors: 0,
            desyncReports: 0,
        };
    }
    getRunComparator(runKeyOrId) {
        const direct = this.runs.get(runKeyOrId);
        if (direct)
            return direct.comparator;
        for (const run of this.runs.values()) {
            if (run.identity.runId === runKeyOrId || run.identity.battleSessionId === runKeyOrId || run.identity.roomNumber === runKeyOrId) {
                return run.comparator;
            }
        }
        return undefined;
    }
    getAllRuns() {
        return [...this.runs.values()];
    }
    ensureRunBucket(context, schema = exports.FINGERPRINT_SCHEMA) {
        var _a, _b, _c, _d;
        const roomInstanceId = context.roomInstanceId || `room-inst-${context.roomNumber}`;
        const battleSessionId = context.battleSessionId || `battle-${context.roomNumber}-g${(_a = context.generation) !== null && _a !== void 0 ? _a : 0}`;
        const generation = (_b = context.generation) !== null && _b !== void 0 ? _b : 0;
        const sceneEpoch = (_c = context.sceneEpoch) !== null && _c !== void 0 ? _c : 0;
        const bucketKey = `${roomInstanceId}|${battleSessionId}|e${sceneEpoch}|${schema}`;
        let bucket = this.runs.get(bucketKey);
        if (!bucket) {
            const rawRunId = sceneEpoch > 0
                ? `${context.roomNumber}-g${generation}-s${sceneEpoch}-${battleSessionId}`
                : `${context.roomNumber}-g${generation}-${battleSessionId}`;
            const safeRun = sanitizeRunFilenamePart(rawRunId);
            const outDir = this.resolveOutputDir();
            const jsonlFilePath = outDir ? path.join(outDir, `fingerprint-${safeRun}.jsonl`) : "";
            const desyncFilePath = outDir ? path.join(outDir, `desync-first-${safeRun}.json`) : "";
            const identity = {
                runId: safeRun,
                roomNumber: context.roomNumber,
                roomInstanceId,
                battleSessionId,
                generation,
                sceneEpoch,
                schema,
            };
            const comparator = new state_fingerprint_compare_1.StateFingerprintComparator(identity, (_d = context.expectedMembers) !== null && _d !== void 0 ? _d : [], (report, isFirstForBattle) => {
                this.writeDesyncReport(bucket, report, isFirstForBattle);
            });
            bucket = {
                identity,
                comparator,
                connections: new Map(),
                observerActiveEpoch: new Map(),
                jsonlFilePath,
                desyncFilePath,
            };
            this.runs.set(bucketKey, bucket);
        }
        else if (context.expectedMembers && context.expectedMembers.length > 0) {
            bucket.comparator.freezeExpectedMembers(context.expectedMembers);
        }
        return bucket;
    }
    appendJsonl(bucket, record) {
        const outDir = this.resolveOutputDir();
        if (!outDir || !bucket.jsonlFilePath)
            return;
        try {
            fs.mkdirSync(outDir, { recursive: true });
            fs.appendFileSync(bucket.jsonlFilePath, JSON.stringify(record) + "\n", "utf8");
        }
        catch (_a) {
            this.diagnostics.writeErrors++;
        }
    }
    writeDesyncReport(bucket, report, isFirstForBattle) {
        var _a;
        this.diagnostics.desyncReports++;
        const outDir = this.resolveOutputDir();
        if (outDir && bucket.desyncFilePath) {
            try {
                fs.mkdirSync(outDir, { recursive: true });
                fs.writeFileSync(bucket.desyncFilePath, JSON.stringify(report, null, 2) + "\n", "utf8");
            }
            catch (_b) {
                this.diagnostics.writeErrors++;
            }
        }
        if (isFirstForBattle) {
            const line = `[DESYNC-FIRST] room=${report.roomNumber} battle=${report.battleId} frame=${report.postFrame} field=${report.fieldPath} layer=${report.layer} completeness=${report.completeness} lastEqualFrame=${(_a = report.lastEqualFrame) !== null && _a !== void 0 ? _a : "null"} summary="${report.summary}"`;
            if (this.options.stderrWrite) {
                this.options.stderrWrite(line);
            }
            else {
                process.stderr.write(line + "\n");
            }
        }
    }
    recordServerGap(bucket, observerId, gap) {
        const normalized = Object.assign(Object.assign({}, gap), { source: "server" });
        bucket.comparator.addGap(observerId, normalized);
        this.appendJsonl(bucket, {
            type: "gap",
            ts: Date.now(),
            runId: bucket.identity.runId,
            roomNumber: bucket.identity.roomNumber,
            battleSessionId: bucket.identity.battleSessionId,
            sceneEpoch: bucket.identity.sceneEpoch,
            observerId,
            gap: normalized,
        });
    }
    getOrCreateConnectionState(bucket, observerId, context) {
        var _a, _b, _c;
        const connGen = (_a = context.connectionGeneration) !== null && _a !== void 0 ? _a : 0;
        const connectionKey = `${observerId}#cg${connGen}`;
        let conn = bucket.connections.get(connectionKey);
        if (!conn) {
            const capacity = (_b = this.options.bucketCapacityBytes) !== null && _b !== void 0 ? _b : (Number.parseInt((_c = process.env.MULTI_FINGERPRINT_BUCKET_BYTES) !== null && _c !== void 0 ? _c : "", 10) || exports.DEFAULT_BUCKET_CAPACITY_BYTES);
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
            };
            bucket.connections.set(connectionKey, conn);
        }
        return conn;
    }
    consumeRateLimitTokens(conn, bytes) {
        var _a, _b, _c, _d;
        const now = this.now();
        const rate = (_a = this.options.rateBytesPerSec) !== null && _a !== void 0 ? _a : (Number.parseInt((_b = process.env.MULTI_FINGERPRINT_RATE_BYTES_PER_SEC) !== null && _b !== void 0 ? _b : "", 10) || exports.DEFAULT_RATE_BYTES_PER_SEC);
        const capacity = (_c = this.options.bucketCapacityBytes) !== null && _c !== void 0 ? _c : (Number.parseInt((_d = process.env.MULTI_FINGERPRINT_BUCKET_BYTES) !== null && _d !== void 0 ? _d : "", 10) || exports.DEFAULT_BUCKET_CAPACITY_BYTES);
        if (now < conn.lastRefillMs) {
            // Monotonic timer wraparound safety: reset timer without amplifying tokens
            conn.lastRefillMs = now;
        }
        else {
            const elapsedSec = (now - conn.lastRefillMs) / 1000;
            if (elapsedSec > 0) {
                conn.tokens = Math.min(capacity, conn.tokens + elapsedSec * rate);
                conn.lastRefillMs = now;
            }
        }
        if (bytes > conn.tokens) {
            return false;
        }
        conn.tokens -= bytes;
        return true;
    }
    getOrCreateEpochState(bucket, conn, clientEpoch) {
        const existingBinding = bucket.observerActiveEpoch.get(conn.observerId);
        if (!existingBinding) {
            bucket.observerActiveEpoch.set(conn.observerId, {
                connectionKey: conn.connectionKey,
                clientEpoch,
            });
        }
        else if (existingBinding.connectionKey !== conn.connectionKey || existingBinding.clientEpoch !== clientEpoch) {
            // Observer switched connection or clientEpoch mid-scene without LevelNext.
            // Do not splice baselines across epochs; mark epoch_end gap.
            const prevConn = bucket.connections.get(existingBinding.connectionKey);
            const prevEpochState = prevConn === null || prevConn === void 0 ? void 0 : prevConn.epochs.get(existingBinding.clientEpoch);
            if (prevEpochState) {
                for (const baseline of prevEpochState.baselines.values()) {
                    baseline.state = null;
                    baseline.lastFrame = null;
                }
            }
            bucket.observerActiveEpoch.set(conn.observerId, {
                connectionKey: conn.connectionKey,
                clientEpoch,
            });
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
            });
        }
        conn.activeEpoch = clientEpoch;
        let epochState = conn.epochs.get(clientEpoch);
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
            };
            conn.epochs.set(clientEpoch, epochState);
        }
        return epochState;
    }
    invalidateEpochBaselines(epochState, battleId = null, battleEpoch = null) {
        for (const [key, baseline] of epochState.baselines.entries()) {
            if (battleId !== null) {
                const [bId, bEp] = key.split("#");
                if (bId !== battleId)
                    continue;
                if (battleEpoch !== null && Number(bEp) !== battleEpoch)
                    continue;
            }
            baseline.state = null;
            baseline.lastFrame = null;
        }
    }
    /**
     * Main entry point for receiving a fingerprint packet (raw JSON string or parsed array)
     * for a server-authenticated observer context.
     */
    receivePacket(context, rawOrParsed) {
        var _a, _b, _c;
        if (!this.isEnabled()) {
            return { accepted: false, reason: "disabled" };
        }
        this.diagnostics.packetsReceived++;
        const packetSchema = (_a = peekPacketSchema(rawOrParsed)) !== null && _a !== void 0 ? _a : exports.FINGERPRINT_SCHEMA;
        const bucket = this.ensureRunBucket(context, packetSchema);
        const candidateMember = {
            observerId: context.observerId || context.connectionId || `viewer:${context.viewerId}`,
            viewerId: context.viewerId,
            connectionId: context.connectionId,
        };
        // Verify observer belongs to frozen Start members when frozen members are specified
        const allowedByContext = !context.expectedMembers || context.expectedMembers.length === 0 || context.expectedMembers.some(m => (m.viewerId > 0 && m.viewerId === context.viewerId)
            || (m.connectionId && m.connectionId === context.connectionId)
            || (m.observerId && m.observerId === candidateMember.observerId));
        if (!allowedByContext || !bucket.comparator.isAuthorizedMember(candidateMember)) {
            this.diagnostics.packetsRejected++;
            this.appendJsonl(bucket, {
                type: "diagnostic",
                ts: Date.now(),
                runId: bucket.identity.runId,
                observerId: candidateMember.observerId,
                error: "unauthorized_observer",
            });
            return { accepted: false, reason: "unauthorized_observer" };
        }
        const observerId = bucket.comparator.registerExpectedMember(candidateMember);
        const conn = this.getOrCreateConnectionState(bucket, observerId, context);
        let envelope;
        try {
            envelope = validateFingerprintPacket(rawOrParsed);
        }
        catch (error) {
            this.diagnostics.packetsRejected++;
            const errReason = (_b = error.reason) !== null && _b !== void 0 ? _b : "invalid_packet";
            const gapReason = errReason === "oversize" ? "oversize" : "sampling_error";
            if (conn.activeEpoch !== null) {
                const epState = conn.epochs.get(conn.activeEpoch);
                if (epState)
                    this.invalidateEpochBaselines(epState);
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
                detail: error.message,
            });
            return { accepted: false, reason: errReason };
        }
        // Per-connection rate limit check (physical packet UTF-8 + NUL bytes)
        if (!this.consumeRateLimitTokens(conn, envelope.physicalBytes)) {
            this.diagnostics.rateLimited++;
            this.diagnostics.packetsRejected++;
            const epState = this.getOrCreateEpochState(bucket, conn, envelope.epoch);
            epState.poisonedSeqs.add(envelope.seq);
            this.invalidateEpochBaselines(epState);
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
            });
            return { accepted: false, reason: "rate_limit_exceeded" };
        }
        const epochState = this.getOrCreateEpochState(bucket, conn, envelope.epoch);
        // Expire any already timed-out pending sequences before processing duplicates or new fragments
        // so that duplicate fragments or late packets cannot extend or bypass an already-expired sequence.
        this.drainEpochReadyBatches(bucket, conn, epochState, false);
        if (envelope.seq > epochState.maxSeenSeq) {
            epochState.maxSeenSeq = envelope.seq;
        }
        const partKey = `${envelope.seq}:${envelope.part}`;
        const partSignature = envelope.parts === 1
            ? (0, state_fingerprint_compare_1.canonicalJson)({
                schema: envelope.schema,
                build: envelope.build,
                epoch: envelope.epoch,
                seq: envelope.seq,
                parts: 1,
                rows: envelope.rows,
                events: envelope.events,
                gaps: envelope.gaps,
            })
            : (0, state_fingerprint_compare_1.canonicalJson)({
                schema: envelope.schema,
                build: envelope.build,
                epoch: envelope.epoch,
                seq: envelope.seq,
                parts: envelope.parts,
                chunk: envelope.chunk,
            });
        // Check against already seen/completed (seq, part) or conflicting metadata for the same seq
        const prevSig = epochState.completedSeqPartSignatures.get(partKey);
        const seqMetaKey = `${envelope.seq}:meta`;
        const seqMetaSig = (0, state_fingerprint_compare_1.canonicalJson)({
            schema: envelope.schema,
            build: envelope.build,
            epoch: envelope.epoch,
            seq: envelope.seq,
            parts: envelope.parts,
        });
        const prevMetaSig = epochState.completedSeqPartSignatures.get(seqMetaKey);
        if (prevMetaSig !== undefined && prevMetaSig !== seqMetaSig) {
            return this.rejectConflictingSeq(bucket, conn, epochState, envelope.seq, "conflicting_seq_metadata");
        }
        if (prevSig !== undefined) {
            if (prevSig === partSignature) {
                this.diagnostics.duplicatesIgnored++;
                return { accepted: true, duplicate: true, report: bucket.comparator.getFirstReport() };
            }
            return this.rejectConflictingSeq(bucket, conn, epochState, envelope.seq, "conflicting_duplicate_part");
        }
        if (epochState.poisonedSeqs.has(envelope.seq)) {
            this.diagnostics.packetsRejected++;
            return { accepted: false, reason: "seq_already_poisoned" };
        }
        epochState.completedSeqPartSignatures.set(seqMetaKey, seqMetaSig);
        epochState.completedSeqPartSignatures.set(partKey, partSignature);
        const bufferLimit = (_c = this.options.bufferLimitBytes) !== null && _c !== void 0 ? _c : exports.DEFAULT_BUFFER_LIMIT_BYTES;
        const now = this.now();
        if (envelope.parts === 1) {
            const batch = {
                rows: envelope.rows,
                events: envelope.events,
                gaps: envelope.gaps,
            };
            if (conn.bufferedBytes + envelope.physicalBytes > bufferLimit) {
                epochState.poisonedSeqs.add(envelope.seq);
                this.invalidateEpochBaselines(epochState);
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
                });
                this.diagnostics.packetsRejected++;
                return { accepted: false, reason: "buffer_overflow" };
            }
            conn.bufferedBytes += envelope.physicalBytes;
            epochState.readySeqs.set(envelope.seq, {
                schema: envelope.schema,
                build: envelope.build,
                epoch: envelope.epoch,
                seq: envelope.seq,
                parts: 1,
                createdAtMs: now,
                batch,
                bufferedBytes: envelope.physicalBytes,
            });
        }
        else {
            let pending = epochState.partialSeqs.get(envelope.seq);
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
                };
                epochState.partialSeqs.set(envelope.seq, pending);
            }
            const chunkBytes = Buffer.byteLength(envelope.chunk, "utf8");
            if (conn.bufferedBytes + chunkBytes > bufferLimit) {
                conn.bufferedBytes -= pending.bufferedBytes;
                epochState.partialSeqs.delete(envelope.seq);
                epochState.poisonedSeqs.add(envelope.seq);
                this.invalidateEpochBaselines(epochState);
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
                });
                this.diagnostics.packetsRejected++;
                return { accepted: false, reason: "buffer_overflow" };
            }
            pending.chunks.set(envelope.part, envelope.chunk);
            pending.lastProgressAtMs = now;
            pending.wireBytesReceived += envelope.physicalBytes;
            pending.bufferedBytes += chunkBytes;
            conn.bufferedBytes += chunkBytes;
            if (pending.chunks.size === pending.parts) {
                epochState.partialSeqs.delete(envelope.seq);
                const orderedChunks = [];
                for (let i = 0; i < pending.parts; i++) {
                    const ch = pending.chunks.get(i);
                    if (ch === undefined) {
                        conn.bufferedBytes -= pending.bufferedBytes;
                        return this.rejectConflictingSeq(bucket, conn, epochState, envelope.seq, "missing_fragment_part");
                    }
                    orderedChunks.push(ch);
                }
                const fullText = orderedChunks.join("");
                const fullBytes = Buffer.byteLength(fullText, "utf8");
                if (fullBytes > exports.MAX_LOGICAL_BATCH_BYTES) {
                    conn.bufferedBytes -= pending.bufferedBytes;
                    epochState.poisonedSeqs.add(envelope.seq);
                    this.invalidateEpochBaselines(epochState);
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
                        detail: `reassembled batch exceeded ${exports.MAX_LOGICAL_BATCH_BYTES} bytes (${fullBytes})`,
                    });
                    this.diagnostics.packetsRejected++;
                    return { accepted: false, reason: "oversize" };
                }
                let batch;
                try {
                    const parsedBatch = parseUniqueJson(fullText);
                    batch = validateLogicalBatchObject(parsedBatch);
                }
                catch (error) {
                    conn.bufferedBytes -= pending.bufferedBytes;
                    epochState.poisonedSeqs.add(envelope.seq);
                    this.invalidateEpochBaselines(epochState);
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
                        detail: `reassembled batch parse failed: ${error.message}`,
                    });
                    this.diagnostics.packetsRejected++;
                    return { accepted: false, reason: "reassembly_parse_failed" };
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
                });
            }
        }
        this.diagnostics.packetsAccepted++;
        this.drainEpochReadyBatches(bucket, conn, epochState, false);
        return { accepted: true, report: bucket.comparator.getFirstReport() };
    }
    rejectConflictingSeq(bucket, conn, epochState, seq, detail) {
        this.diagnostics.packetsRejected++;
        const pending = epochState.partialSeqs.get(seq);
        if (pending) {
            conn.bufferedBytes -= pending.bufferedBytes;
            epochState.partialSeqs.delete(seq);
        }
        const ready = epochState.readySeqs.get(seq);
        if (ready) {
            conn.bufferedBytes -= ready.bufferedBytes;
            epochState.readySeqs.delete(seq);
        }
        epochState.poisonedSeqs.add(seq);
        this.invalidateEpochBaselines(epochState);
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
        });
        this.drainEpochReadyBatches(bucket, conn, epochState, false);
        return { accepted: false, reason: detail };
    }
    resolveEffectiveRateBytesPerSec(schema) {
        var _a, _b;
        const configured = (_a = this.options.rateBytesPerSec) !== null && _a !== void 0 ? _a : (Number.parseInt((_b = process.env.MULTI_FINGERPRINT_RATE_BYTES_PER_SEC) !== null && _b !== void 0 ? _b : "", 10) || exports.DEFAULT_RATE_BYTES_PER_SEC);
        if (schema === exports.FINGERPRINT_COMPACT_V2_SCHEMA) {
            return Math.max(1, Math.min(configured, exports.COMPACT_V2_CLIENT_RATE_BYTES_PER_SEC));
        }
        return Math.max(1, configured);
    }
    drainEpochReadyBatches(bucket, conn, epochState, forceFlushMissing) {
        var _a, _b, _c, _d;
        const now = this.now();
        const maxPending = (_a = this.options.maxPendingSeqs) !== null && _a !== void 0 ? _a : exports.MAX_PENDING_SEQS;
        const waitTimeoutMs = (_b = this.options.fragmentWaitTimeoutMs) !== null && _b !== void 0 ? _b : exports.FRAGMENT_WAIT_TIMEOUT_MS;
        const maxTotalCapMs = (_c = this.options.maxReassemblyTotalMs) !== null && _c !== void 0 ? _c : (Number.parseInt((_d = process.env.MULTI_FINGERPRINT_MAX_REASSEMBLY_MS) !== null && _d !== void 0 ? _d : "", 10) || exports.DEFAULT_MAX_REASSEMBLY_TOTAL_MS);
        const rate = this.resolveEffectiveRateBytesPerSec(bucket.identity.schema);
        while (true) {
            // 1. Apply any contiguous ready batch at nextSeq
            const ready = epochState.readySeqs.get(epochState.nextSeq);
            if (ready) {
                epochState.readySeqs.delete(epochState.nextSeq);
                conn.bufferedBytes = Math.max(0, conn.bufferedBytes - ready.bufferedBytes);
                this.applyLogicalBatch(bucket, conn, epochState, ready);
                epochState.nextSeq++;
                continue;
            }
            // 2. If nextSeq is known poisoned, advance past it with gap already recorded
            if (epochState.poisonedSeqs.has(epochState.nextSeq)) {
                this.invalidateEpochBaselines(epochState);
                epochState.nextSeq++;
                continue;
            }
            // 3. Check if we have later sequences waiting while nextSeq is missing/partial
            const hasLaterOrPartial = epochState.readySeqs.size > 0 || epochState.partialSeqs.size > 0;
            if (!hasLaterOrPartial)
                break;
            const pendingSpan = epochState.maxSeenSeq - epochState.nextSeq + 1;
            const totalPendingCount = epochState.readySeqs.size + epochState.partialSeqs.size;
            const partial = epochState.partialSeqs.get(epochState.nextSeq);
            let shouldExpire = forceFlushMissing || pendingSpan > maxPending || totalPendingCount > maxPending;
            if (!shouldExpire) {
                if (partial) {
                    const elapsedSinceCreatedMs = Math.max(0, now - partial.createdAtMs);
                    const idleMs = Math.max(0, now - partial.lastProgressAtMs);
                    const progressDurationMs = Math.max(0, partial.lastProgressAtMs - partial.createdAtMs);
                    const expectedRateTransferMs = Math.ceil((partial.wireBytesReceived / rate) * 1000);
                    const unpaidRateAllowanceMs = Math.max(0, expectedRateTransferMs - progressDurationMs);
                    const effectiveIdleTimeoutMs = waitTimeoutMs + unpaidRateAllowanceMs;
                    const effectiveTotalTimeoutMs = Math.min(maxTotalCapMs, Math.max(120000, expectedRateTransferMs + waitTimeoutMs * 2));
                    if (idleMs >= effectiveIdleTimeoutMs || elapsedSinceCreatedMs >= effectiveTotalTimeoutMs) {
                        shouldExpire = true;
                    }
                }
                else {
                    let earliestLaterCreatedAtMs = Number.POSITIVE_INFINITY;
                    for (const [s, item] of epochState.partialSeqs.entries()) {
                        if (s > epochState.nextSeq && item.createdAtMs < earliestLaterCreatedAtMs) {
                            earliestLaterCreatedAtMs = item.createdAtMs;
                        }
                    }
                    for (const [s, item] of epochState.readySeqs.entries()) {
                        if (s > epochState.nextSeq && item.createdAtMs < earliestLaterCreatedAtMs) {
                            earliestLaterCreatedAtMs = item.createdAtMs;
                        }
                    }
                    if (Number.isFinite(earliestLaterCreatedAtMs)) {
                        const waitMs = Math.max(0, now - earliestLaterCreatedAtMs);
                        const bufferedAllowanceMs = Math.ceil((conn.bufferedBytes / rate) * 1000);
                        const missingEffectiveTimeoutMs = Math.min(maxTotalCapMs, waitTimeoutMs + bufferedAllowanceMs);
                        if (waitMs >= missingEffectiveTimeoutMs) {
                            shouldExpire = true;
                        }
                    }
                }
            }
            if (shouldExpire) {
                // Expire missing/partial nextSeq
                if (partial) {
                    conn.bufferedBytes = Math.max(0, conn.bufferedBytes - partial.bufferedBytes);
                    epochState.partialSeqs.delete(epochState.nextSeq);
                    epochState.poisonedSeqs.add(epochState.nextSeq);
                    this.invalidateEpochBaselines(epochState);
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
                    });
                }
                else {
                    epochState.poisonedSeqs.add(epochState.nextSeq);
                    this.invalidateEpochBaselines(epochState);
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
                    });
                }
                epochState.nextSeq++;
                continue;
            }
            // Still within waiting window for out-of-order seq / fragment;
            // mark pending status on comparator until all parts/seqs arrive.
            break;
        }
        const stillPending = epochState.readySeqs.size > 0 || epochState.partialSeqs.size > 0;
        bucket.comparator.setObserverPendingSequences(conn.observerId, stillPending);
    }
    /**
     * Replays a single `relay-records/*.jsonl` frame line into the fingerprint service
     * if it represents a battle_in `wf-fp` packet.
     */
    replayRelayRecordJsonlLine(rawLine, expectedMembers) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const trimmed = rawLine.trim();
        if (!trimmed)
            return { handled: false };
        const parsed = JSON.parse(trimmed);
        if (parsed.type !== "frame" || parsed.channel !== "battle" || parsed.dir !== "in") {
            return { handled: false };
        }
        const rawPayload = typeof parsed.raw === "string" ? parsed.raw : null;
        let packetObj = parsed.parsed;
        if (!packetObj && rawPayload) {
            try {
                packetObj = parseUniqueJson(rawPayload);
            }
            catch (_j) {
                return { handled: false };
            }
        }
        if (!isStateFingerprintPacket(packetObj)) {
            return { handled: false };
        }
        const viewerId = Number((_a = parsed.viewerId) !== null && _a !== void 0 ? _a : 0);
        const connectionId = String((_b = parsed.connectionId) !== null && _b !== void 0 ? _b : "");
        const roomNumber = String((_c = parsed.roomNumber) !== null && _c !== void 0 ? _c : "unknown");
        const generation = Number((_d = parsed.generation) !== null && _d !== void 0 ? _d : 0);
        const sceneEpoch = Number((_e = parsed.sceneEpoch) !== null && _e !== void 0 ? _e : 0);
        const roomInstanceId = String((_f = parsed.roomInstanceId) !== null && _f !== void 0 ? _f : `room-inst-${roomNumber}`);
        const battleSessionId = String((_g = parsed.battleSessionId) !== null && _g !== void 0 ? _g : `battle-${roomNumber}-g${generation}`);
        const res = this.receivePacket({
            observerId: connectionId || `viewer:${viewerId}`,
            viewerId,
            connectionId,
            connectionGeneration: Number((_h = parsed.connectionGeneration) !== null && _h !== void 0 ? _h : 0),
            roomNumber,
            roomInstanceId,
            battleSessionId,
            generation,
            sceneEpoch,
            expectedMembers,
        }, rawPayload !== null && rawPayload !== void 0 ? rawPayload : packetObj);
        return { handled: true, accepted: res.accepted, reason: res.reason };
    }
    /**
     * Force-flushes any incomplete or out-of-order sequences across all active buckets
     * (e.g. on socket close, scene transition, or test inspection after missing packets).
     */
    flushPending(runKeyOrId) {
        const targets = runKeyOrId
            ? [...this.runs.values()].filter(r => r.identity.runId === runKeyOrId
                || r.identity.battleSessionId === runKeyOrId
                || r.identity.roomNumber === runKeyOrId)
            : [...this.runs.values()];
        for (const bucket of targets) {
            for (const conn of bucket.connections.values()) {
                for (const epochState of conn.epochs.values()) {
                    this.drainEpochReadyBatches(bucket, conn, epochState, true);
                }
            }
        }
    }
    noteConnectionClosed(context) {
        var _a, _b;
        if (!this.isEnabled())
            return;
        const roomInstanceId = context.roomInstanceId || `room-inst-${context.roomNumber}`;
        const battleSessionId = context.battleSessionId || `battle-${context.roomNumber}-g${(_a = context.generation) !== null && _a !== void 0 ? _a : 0}`;
        const sceneEpoch = (_b = context.sceneEpoch) !== null && _b !== void 0 ? _b : 0;
        const matchingBuckets = [...this.runs.values()].filter(b => b.identity.roomInstanceId === roomInstanceId
            && b.identity.battleSessionId === battleSessionId
            && b.identity.sceneEpoch === sceneEpoch);
        const buckets = matchingBuckets.length > 0 ? matchingBuckets : [this.ensureRunBucket(context)];
        const observerId = context.observerId || context.connectionId || `viewer:${context.viewerId}`;
        for (const bucket of buckets) {
            const conn = this.getOrCreateConnectionState(bucket, observerId, context);
            for (const epochState of conn.epochs.values()) {
                this.drainEpochReadyBatches(bucket, conn, epochState, true);
                this.invalidateEpochBaselines(epochState);
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
            });
        }
    }
    applyLogicalBatch(bucket, conn, epochState, item) {
        var _a, _b, _c;
        const { batch } = item;
        // 1. Validate & apply client-reported gaps first
        for (const rawGap of batch.gaps) {
            try {
                const gap = validateGapEntry(rawGap);
                this.invalidateEpochBaselines(epochState, gap.battleId, gap.battleEpoch);
                bucket.comparator.addGap(conn.observerId, gap);
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
                });
            }
            catch (error) {
                this.invalidateEpochBaselines(epochState);
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
                    detail: `invalid gap entry: ${error.message}`,
                });
                return;
            }
        }
        // 2. Validate & apply batch events
        const normalizedEvents = [];
        for (const rawEvent of batch.events) {
            try {
                const ev = validateEventEntry(rawEvent);
                if (ev.eventId !== epochState.nextExpectedEventId) {
                    epochState.eventGapDetected = true;
                    const fromEv = epochState.nextExpectedEventId;
                    const toEv = ev.eventId > fromEv ? ev.eventId - 1 : ev.eventId;
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
                    });
                    epochState.nextExpectedEventId = ev.eventId + 1;
                }
                else {
                    if (!epochState.eventGapDetected) {
                        epochState.contiguousEventWaterMark = ev.eventId;
                    }
                    epochState.nextExpectedEventId = ev.eventId + 1;
                }
                normalizedEvents.push(ev);
            }
            catch (error) {
                epochState.eventGapDetected = true;
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
                    detail: `invalid event entry: ${error.message}`,
                });
                return;
            }
        }
        if (normalizedEvents.length > 0) {
            bucket.comparator.addEvents(conn.observerId, normalizedEvents);
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
            });
        }
        // 3. Validate & apply rows in sampling order
        for (const rawRow of batch.rows) {
            const peekBattleId = isPlainObject(rawRow) && typeof rawRow.battleId === "string" ? rawRow.battleId : null;
            const peekBattleEpoch = isPlainObject(rawRow) && isNInt(rawRow.battleEpoch) ? rawRow.battleEpoch : null;
            const baselineKey = peekBattleId !== null && peekBattleEpoch !== null
                ? `${peekBattleId}#${peekBattleEpoch}`
                : "__invalid__";
            let baseline = epochState.baselines.get(baselineKey);
            if (!baseline && baselineKey !== "__invalid__") {
                baseline = {
                    lastFrame: null,
                    state: null,
                    seenFrames: new Set(),
                    hasInitialOrGap: batch.gaps.some(g => isPlainObject(g)
                        && g.reason === "initial_missing"
                        && (g.battleId === null || g.battleId === peekBattleId)),
                };
                epochState.baselines.set(baselineKey, baseline);
            }
            try {
                const applied = applyRowToState((_a = baseline === null || baseline === void 0 ? void 0 : baseline.state) !== null && _a !== void 0 ? _a : null, (_b = baseline === null || baseline === void 0 ? void 0 : baseline.lastFrame) !== null && _b !== void 0 ? _b : null, rawRow, item.schema);
                const bState = baseline;
                if (bState.seenFrames.has(applied.postFrame)) {
                    throw new Error(`duplicate postFrame ${applied.postFrame} for battle ${applied.battleId}#${applied.battleEpoch}`);
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
                    });
                    bState.hasInitialOrGap = true;
                }
                if (applied.postFrame === 0 && applied.phase === "initial") {
                    bState.hasInitialOrGap = true;
                }
                bState.seenFrames.add(applied.postFrame);
                bState.lastFrame = applied.postFrame;
                bState.state = applied.state;
                const eventContextComplete = !epochState.eventGapDetected
                    && (applied.eventCursor === null || epochState.contiguousEventWaterMark >= applied.eventCursor);
                const groupHashes = (0, state_fingerprint_compare_1.computeStateGroupHashes)(applied.state);
                const sortedValues = {};
                for (const [k, v] of [...applied.state.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
                    sortedValues[k] = v;
                }
                const observation = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ observerId: conn.observerId, viewerId: conn.viewerId, connectionId: conn.connectionId, connectionGeneration: conn.connectionGeneration, clientEpoch: item.epoch, seq: item.seq, parts: item.parts, build: item.build, schema: item.schema, battleId: applied.battleId, battleEpoch: applied.battleEpoch, postFrame: applied.postFrame, phase: applied.phase, zone: applied.zone, floor: applied.floor, mode: applied.mode, baseFrame: applied.baseFrame, eventCursor: applied.eventCursor, eventContextComplete, inputs: applied.inputs, unsupported: applied.unsupported }, (applied.inputSummary !== undefined ? { inputSummary: applied.inputSummary } : {})), (applied.routeSummary !== undefined ? { routeSummary: applied.routeSummary } : {})), (applied.sampleInterval !== undefined ? { sampleInterval: applied.sampleInterval } : {})), (applied.previousCheckpointFrame !== undefined ? { previousCheckpointFrame: applied.previousCheckpointFrame } : {})), { state: applied.state, groupHashes });
                this.appendJsonl(bucket, Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ type: "row", ts: Date.now(), runId: bucket.identity.runId, roomNumber: bucket.identity.roomNumber, roomInstanceId: bucket.identity.roomInstanceId, battleSessionId: bucket.identity.battleSessionId, generation: bucket.identity.generation, sceneEpoch: bucket.identity.sceneEpoch, observer: {
                        id: conn.observerId,
                        viewerId: conn.viewerId,
                        connectionId: conn.connectionId,
                        connectionGeneration: conn.connectionGeneration,
                    }, build: item.build, schema: item.schema, epoch: item.epoch, seq: item.seq, parts: item.parts, battleId: applied.battleId, battleEpoch: applied.battleEpoch, postFrame: applied.postFrame, phase: applied.phase, zone: applied.zone, floor: applied.floor, mode: applied.mode, baseFrame: applied.baseFrame, eventCursor: applied.eventCursor, eventContextComplete, inputs: applied.inputs, unsupported: applied.unsupported }, (applied.inputSummary !== undefined ? { inputSummary: applied.inputSummary } : {})), (applied.routeSummary !== undefined ? { routeSummary: applied.routeSummary } : {})), (applied.sampleInterval !== undefined ? { sampleInterval: applied.sampleInterval } : {})), (applied.previousCheckpointFrame !== undefined ? { previousCheckpointFrame: applied.previousCheckpointFrame } : {})), { groupHashes, values: sortedValues }));
                bucket.comparator.addFrameObservation(observation);
            }
            catch (error) {
                if (baseline) {
                    baseline.state = null;
                    baseline.lastFrame = null;
                }
                const errReason = (_c = error.reason) !== null && _c !== void 0 ? _c : "sampling_error";
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
                    detail: error.message,
                });
                if (errReason === "broken_delta_chain") {
                    bucket.comparator.noteObserverIssue(conn.observerId, "broken_delta_chain");
                }
            }
        }
    }
}
exports.StateFingerprintService = StateFingerprintService;
exports.stateFingerprintService = new StateFingerprintService();
function resolveFrozenExpectedMembers(client, room) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    const members = [];
    const seenViewerIds = new Set();
    const seenConnectionIds = new Set();
    const addMember = (viewerId, connectionId) => {
        if (viewerId > 0 && seenViewerIds.has(viewerId))
            return;
        if (connectionId && seenConnectionIds.has(connectionId))
            return;
        if (viewerId > 0)
            seenViewerIds.add(viewerId);
        if (connectionId)
            seenConnectionIds.add(connectionId);
        const observerId = connectionId || `viewer:${viewerId}`;
        members.push({ observerId, viewerId, connectionId });
    };
    if (room) {
        const contract = (_c = (0, battle_contract_1.getBattleSessionContract)(room, (_a = client.battleSessionId) !== null && _a !== void 0 ? _a : (_b = room.lifecycle) === null || _b === void 0 ? void 0 : _b.battleSessionId)) !== null && _c !== void 0 ? _c : (0, battle_contract_1.ensureBattleSessionContract)(room);
        if (contract) {
            for (const viewerId of contract.viewerIds) {
                const binding = contract.members.get(viewerId);
                const frozenFiveBossCid = (_f = (_e = (_d = room.five_boss_runtime) === null || _d === void 0 ? void 0 : _d.battleIdentityByViewerId) === null || _e === void 0 ? void 0 : _e[String(viewerId)]) === null || _f === void 0 ? void 0 : _f.connectionId;
                const lobbyCid = (_g = SessionManager_1.sessionManager.getClient(viewerId, client.roomNumber)) === null || _g === void 0 ? void 0 : _g.connectionId;
                const cid = (viewerId === client.viewerId ? client.connectionId : "")
                    || (binding === null || binding === void 0 ? void 0 : binding.connectionId)
                    || frozenFiveBossCid
                    || lobbyCid
                    || "";
                addMember(viewerId, cid);
            }
        }
        else {
            const viewerIds = ((_h = room.expected_real_viewer_ids) === null || _h === void 0 ? void 0 : _h.length) > 0
                ? room.expected_real_viewer_ids
                : (_j = room.member_viewer_ids) !== null && _j !== void 0 ? _j : [];
            for (const viewerId of viewerIds) {
                const frozenFiveBossCid = (_m = (_l = (_k = room.five_boss_runtime) === null || _k === void 0 ? void 0 : _k.battleIdentityByViewerId) === null || _l === void 0 ? void 0 : _l[String(viewerId)]) === null || _m === void 0 ? void 0 : _m.connectionId;
                const lobbyCid = (_o = SessionManager_1.sessionManager.getClient(viewerId, client.roomNumber)) === null || _o === void 0 ? void 0 : _o.connectionId;
                const cid = (viewerId === client.viewerId ? client.connectionId : "")
                    || frozenFiveBossCid
                    || lobbyCid
                    || "";
                addMember(viewerId, cid);
            }
        }
    }
    if (members.length === 0 && Array.isArray(client.mates) && client.mates.length > 0) {
        for (const mate of client.mates) {
            if (!mate || mate.comId)
                continue;
            const vId = Number((_q = (_p = mate.viewerId) !== null && _p !== void 0 ? _p : mate.viewer_id) !== null && _q !== void 0 ? _q : 0);
            const cId = String((_s = (_r = mate.connectionId) !== null && _r !== void 0 ? _r : mate.connection_id) !== null && _s !== void 0 ? _s : "");
            if (vId > 0 || cId)
                addMember(vId, cId);
        }
    }
    return members;
}
/**
 * Called by `battle.ts` when a Heartbeat Notify (`tag === 5`) carries an extension (`[5, P]`).
 * Never relays and never sends a Heartbeat ACK.
 * When `MULTI_FINGERPRINT_DIR` is not set, exits immediately with zero overhead.
 */
function handleBattleFingerprintNotify(socket, notifyData, indexedClient) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    if (!exports.stateFingerprintService.isEnabled())
        return;
    const client = indexedClient !== null && indexedClient !== void 0 ? indexedClient : SessionManager_1.sessionManager.findClientBySocket(socket);
    if (!client || !client.isBattle || !SessionManager_1.sessionManager.isCurrentBattleClient(client))
        return;
    const room = (0, manager_1.getRoom)(client.roomNumber);
    const expectedMembers = resolveFrozenExpectedMembers(client, room);
    const context = {
        observerId: client.connectionId || `viewer:${client.viewerId}`,
        viewerId: client.viewerId,
        connectionId: client.connectionId,
        connectionGeneration: (_a = client.connectionGeneration) !== null && _a !== void 0 ? _a : 0,
        roomNumber: client.roomNumber,
        roomInstanceId: (_d = (_b = client.roomInstanceId) !== null && _b !== void 0 ? _b : (_c = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _c === void 0 ? void 0 : _c.instanceId) !== null && _d !== void 0 ? _d : `room-inst-${client.roomNumber}`,
        battleSessionId: (_g = (_e = client.battleSessionId) !== null && _e !== void 0 ? _e : (_f = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _f === void 0 ? void 0 : _f.battleSessionId) !== null && _g !== void 0 ? _g : `battle-${client.roomNumber}-g${client.roomGeneration}`,
        generation: (_j = (_h = client.roomGeneration) !== null && _h !== void 0 ? _h : room === null || room === void 0 ? void 0 : room.lobby_generation) !== null && _j !== void 0 ? _j : 0,
        sceneEpoch: (_m = (_k = client.sceneEpoch) !== null && _k !== void 0 ? _k : (_l = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _l === void 0 ? void 0 : _l.sceneEpoch) !== null && _m !== void 0 ? _m : 0,
        expectedMembers,
    };
    if (!exports.stateFingerprintService["trackedSockets"].has(socket)) {
        exports.stateFingerprintService["trackedSockets"].add(socket);
        socket.once("close", () => {
            if (exports.stateFingerprintService.isEnabled()) {
                exports.stateFingerprintService.noteConnectionClosed(context);
            }
        });
    }
    exports.stateFingerprintService.receivePacket(context, [0, notifyData]);
}
exports.handleBattleFingerprintNotify = handleBattleFingerprintNotify;
