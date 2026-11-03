"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCrashLogRecord = exports.crashReportText = exports.parseCrashReportBody = exports.MAX_CRASH_LOG_BYTES = void 0;
const node_crypto_1 = require("node:crypto");
const msgpackr_1 = require("msgpackr");
const parsedReport = Symbol("parsed crash report");
exports.MAX_CRASH_LOG_BYTES = 48 * 1024;
const MAX_FIELD_BYTES = 512;
const MAX_FIELDS_BYTES = 8 * 1024;
function parsed(payload, format, receivedBytes) {
    return { [parsedReport]: true, payload, format, receivedBytes };
}
/** Only used by /crash. Game endpoints retain their existing wire parser. */
function parseCrashReportBody(raw) {
    const bytes = Buffer.byteLength(raw, "utf8");
    const text = raw.trim();
    if (!text)
        return parsed("", "empty", bytes);
    try {
        return parsed(JSON.parse(text), "json", bytes);
    }
    catch ( /* Try legacy formats. */_a) { /* Try legacy formats. */ }
    // AIR reports sometimes label raw JSON as a form. Never split broken JSON
    // on stack-trace '&' or '=' characters and lose its remaining evidence.
    if (/^[{[\"]/.test(text))
        return parsed(raw, "invalid_json", bytes);
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 !== 1) {
        try {
            return parsed((0, msgpackr_1.unpack)(Buffer.from(text, "base64")), "msgpack_base64", bytes);
        }
        catch ( /* Preserve unrecognised text rather than throwing. */_b) { /* Preserve unrecognised text rather than throwing. */ }
    }
    if (/(^|&)[^=&\s]+=/u.test(text)) {
        const values = Object.create(null);
        for (const [key, value] of new URLSearchParams(raw)) {
            const old = values[key];
            if (old === undefined)
                values[key] = value;
            else if (Array.isArray(old))
                old.push(value);
            else
                values[key] = [old, value];
        }
        return parsed(values, "form", bytes);
    }
    return parsed(raw, "text", bytes);
}
exports.parseCrashReportBody = parseCrashReportBody;
function normalise(body) {
    if (body && typeof body === "object" && body[parsedReport] === true)
        return body;
    if (typeof body === "string")
        return parseCrashReportBody(body);
    if (body === undefined || body === null)
        return parsed(body !== null && body !== void 0 ? body : "", "empty", 0);
    const text = stringify(body);
    return parsed(body, "json", Buffer.byteLength(text, "utf8"));
}
function stringify(value) {
    var _a;
    if (typeof value === "string")
        return value;
    try {
        return (_a = JSON.stringify(value)) !== null && _a !== void 0 ? _a : "";
    }
    catch (_b) {
        return "[unserialisable crash report]";
    }
}
/** Full decoded report for existing seed feedback; logging limits never alter it. */
function crashReportText(body) { return stringify(normalise(body).payload); }
exports.crashReportText = crashReportText;
function sensitive(key) {
    return /password|passwd|pwd|token|authorization|cookie|secret|proof|privatekey|signingkey/i.test(key.replace(/[^a-z0-9]/gi, ""));
}
function redactText(text) {
    return text
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
        .replace(/(\b(?:authorization|cookie)\s*[:=]\s*)[^\r\n]+/gi, "$1[redacted]")
        .replace(/([\"']?\b(?:password|passwd|pwd|[\w-]*token|secret|proof|private[_-]?key|signing[_-]?key)\b[\"']?\s*[:=]\s*)(?:\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|[^\s&;,}\]]+)/gi, "$1[redacted]");
}
function safeText(payload) {
    const seen = new WeakSet();
    function sanitise(value, depth) {
        if (depth > 32)
            return "[nested report depth limit]";
        if (typeof value === "string") {
            // JSON embedded in a form field must remain valid JSON after
            // redaction, including escaped quotes inside credential values.
            if (/^[{[]/.test(value.trim())) {
                try {
                    return JSON.stringify(sanitise(JSON.parse(value), depth + 1));
                }
                catch ( /* Keep malformed report text with bounded redaction. */_a) { /* Keep malformed report text with bounded redaction. */ }
            }
            return redactText(value);
        }
        if (!value || typeof value !== "object")
            return value;
        if (seen.has(value))
            return "[circular]";
        seen.add(value);
        if (value instanceof Date)
            return value.toISOString();
        if (Array.isArray(value))
            return value.map(item => sanitise(item, depth + 1));
        const result = Object.create(null);
        for (const [key, item] of Object.entries(value))
            result[key] = sensitive(key) ? "[redacted]" : sanitise(item, depth + 1);
        return result;
    }
    try {
        return stringify(sanitise(payload, 0));
    }
    catch (_a) {
        return "[unserialisable crash report]";
    }
}
function cutUtf8(text, maxBytes, tail = false) {
    const buffer = Buffer.from(text, "utf8");
    if (buffer.length <= maxBytes)
        return text;
    if (tail) {
        let start = buffer.length - maxBytes;
        while (start < buffer.length && (buffer[start] & 0xc0) === 0x80)
            start++;
        return buffer.subarray(start).toString("utf8");
    }
    let end = maxBytes;
    while (end > 0 && (buffer[end] & 0xc0) === 0x80)
        end--;
    return buffer.subarray(0, end).toString("utf8");
}
const evidenceKeys = new Set([
    "viewerid", "playerid", "accountid", "userid", "uid", "resver", "resourceversion", "assetversion",
    "appversion", "clientversion", "build", "platform", "device", "devicename", "devicemodel",
    "graphicsdevicename", "os", "osversion", "platformosversion", "error", "errorcode", "errorname",
    "exception", "exceptionname", "code", "message", "reason", "detail", "questid", "category", "round", "phase",
]);
function collectFields(text) {
    const fields = [];
    let root;
    try {
        root = JSON.parse(text);
    }
    catch (_a) {
        return { fields, limited: false };
    }
    let visited = 0, limited = false;
    function visit(value, prefix, depth) {
        if (++visited > 4096 || depth > 12) {
            limited = true;
            return;
        }
        if (typeof value === "string" && /^[{[]/.test(value.trim())) {
            try {
                visit(JSON.parse(value), prefix, depth + 1);
            }
            catch ( /* Not an embedded JSON field. */_a) { /* Not an embedded JSON field. */ }
            return;
        }
        if (!value || typeof value !== "object")
            return;
        for (const [key, item] of Object.entries(value)) {
            const at = cutUtf8(prefix ? prefix + "." + key : key, 256);
            if (!sensitive(key) && evidenceKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))
                && ["string", "number", "boolean"].includes(typeof item)) {
                if (fields.length >= 24) {
                    limited = true;
                    continue;
                }
                const candidate = { path: at, value: typeof item === "string"
                        ? cutUtf8(item, MAX_FIELD_BYTES) : item };
                if (Buffer.byteLength(JSON.stringify([...fields, candidate]), "utf8") <= MAX_FIELDS_BYTES)
                    fields.push(candidate);
                else
                    limited = true;
            }
        }
        // Read this object's metadata before spending the traversal budget on
        // a potentially huge stack-frame array or nested context.
        for (const [key, item] of Object.entries(value)) {
            if (visited > 4096) {
                limited = true;
                break;
            }
            const at = cutUtf8(prefix ? prefix + "." + key : key, 256);
            visit(item, at, depth + 1);
        }
    }
    visit(root, "", 0);
    return { fields, limited };
}
/** One bounded JSON line, with evidence fields extracted before body truncation. */
function createCrashLogRecord(body, requestId = "", receivedAt = new Date().toISOString()) {
    var _a;
    const source = normalise(body);
    const text = safeText(source.payload);
    const { fields, limited } = collectFields(text);
    const codes = [...new Set((_a = text.match(/\b(?:[A-Z]_[a-fA-F0-9]{6}|[A-Z][0-9]{3,5})\b/g)) !== null && _a !== void 0 ? _a : [])].slice(0, 16);
    const record = {
        version: 1, received_at: cutUtf8(receivedAt, 64), request_id: cutUtf8(requestId, 128), format: source.format,
        received_bytes: source.receivedBytes, body_bytes: Buffer.byteLength(text, "utf8"),
        // Hash the redacted content, never a password/session-bearing original.
        sha256: (0, node_crypto_1.createHash)("sha256").update(text).digest("hex"), fields, fields_limited: limited, codes,
        truncated: false, report: { text },
    };
    if (Buffer.byteLength(JSON.stringify(record), "utf8") + Buffer.byteLength("[CRASH] ") <= exports.MAX_CRASH_LOG_BYTES)
        return record;
    record.truncated = true;
    let budget = 16 * 1024;
    do {
        record.report = { head: cutUtf8(text, budget), tail: cutUtf8(text, budget, true) };
        if (Buffer.byteLength(JSON.stringify(record), "utf8") + Buffer.byteLength("[CRASH] ") <= exports.MAX_CRASH_LOG_BYTES)
            return record;
        budget = Math.floor(budget / 2);
    } while (budget > 0);
    record.report = { head: "", tail: "" };
    return record;
}
exports.createCrashLogRecord = createCrashLogRecord;
