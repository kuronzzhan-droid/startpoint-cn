"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomCommandFingerprint = exports.commandJsonBytes = exports.cloneCommandJson = exports.roomCommandIssuedAt = exports.createRoomCommandId = exports.RoomCommandError = void 0;
const crypto_1 = require("crypto");
class RoomCommandError extends Error {
    constructor(code, message, commandId, outcomeUnknown) {
        super(message);
        this.code = code;
        this.commandId = commandId;
        this.outcomeUnknown = outcomeUnknown;
        this.name = "RoomCommandError";
    }
}
exports.RoomCommandError = RoomCommandError;
/** IDs cannot be refreshed after retention expiry. Scope is one owner epoch, not durable exactly-once. */
function createRoomCommandId(issuedAtUnixMs = Date.now()) {
    if (!Number.isSafeInteger(issuedAtUnixMs) || issuedAtUnixMs < 0)
        throw new Error("Invalid command issue time");
    return `rc1.${issuedAtUnixMs}.${(0, crypto_1.randomUUID)()}`;
}
exports.createRoomCommandId = createRoomCommandId;
function roomCommandIssuedAt(commandId) {
    const match = /^rc1\.(\d{1,16})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(commandId);
    if (!match)
        return undefined;
    const value = Number(match[1]);
    return Number.isSafeInteger(value) ? value : undefined;
}
exports.roomCommandIssuedAt = roomCommandIssuedAt;
/** Strict JSON, with bounded traversal. No getters, prototypes, closures, or silently lost values. */
function cloneCommandJson(value) {
    let nodes = 0;
    const seen = new Set();
    const check = (item, depth) => {
        if (++nodes > 65536 || depth > 64)
            throw new Error("Command JSON complexity limit");
        if (item === null || typeof item === "string" || typeof item === "boolean")
            return;
        if (typeof item === "number" && Number.isFinite(item))
            return;
        if (typeof item !== "object")
            throw new Error("Command values must be finite JSON");
        if (seen.has(item))
            throw new Error("Command JSON cycle");
        seen.add(item);
        if (Array.isArray(item)) {
            if (Reflect.ownKeys(item).length !== item.length + 1)
                throw new Error("Command array must be dense JSON");
            for (let i = 0; i < item.length; i++) {
                const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
                if (!descriptor || !("value" in descriptor))
                    throw new Error("Command array accessor");
                check(descriptor.value, depth + 1);
            }
        }
        else {
            const prototype = Object.getPrototypeOf(item);
            if (prototype !== Object.prototype && prototype !== null)
                throw new Error("Command object must be plain JSON");
            for (const key of Reflect.ownKeys(item)) {
                if (typeof key !== "string")
                    throw new Error("Command symbol key");
                const descriptor = Object.getOwnPropertyDescriptor(item, key);
                if (!descriptor.enumerable || !("value" in descriptor))
                    throw new Error("Command object accessor/non-enumerable");
                check(descriptor.value, depth + 1);
            }
        }
        seen.delete(item);
    };
    check(value, 0);
    return JSON.parse(JSON.stringify(value));
}
exports.cloneCommandJson = cloneCommandJson;
function commandJsonBytes(value) {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
}
exports.commandJsonBytes = commandJsonBytes;
function roomCommandFingerprint(command) {
    var _a;
    const canonical = (value) => {
        if (value === null || typeof value !== "object")
            return JSON.stringify(value);
        if (Array.isArray(value))
            return `[${value.map(canonical).join(",")}]`;
        const item = value;
        return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
    };
    // A retry's wait budget is not its business identity.
    return (0, crypto_1.createHash)("sha256").update(canonical({ kind: command.kind, payload: command.payload,
        expectedIdentity: (_a = command.expectedIdentity) !== null && _a !== void 0 ? _a : null })).digest("hex");
}
exports.roomCommandFingerprint = roomCommandFingerprint;
