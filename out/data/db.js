"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = exports.setDbOverride = void 0;
const _1 = __importDefault(require("."));
// The connection is resolved lazily so the SQLite writer thread can point the
// same domain modules at its own connection before the first getDb() call, and
// so importing a domain module no longer opens/migrates the database as a side
// effect.
let override = null;
let resolved = null;
/**
 * Route getDb() to an externally owned connection.
 *
 * Only the SQLite writer worker uses this: it opens a plain connection without
 * the initializer/migration pipeline and then lets the identical domain code
 * run against it. Call before the first getDb() call.
 */
function setDbOverride(db) {
    override = db;
    resolved = null;
}
exports.setDbOverride = setDbOverride;
function getDb() {
    if (process.env.MULTI_REALTIME_OWNER_CHILD === "1")
        throw new Error("REALTIME_OWNER_CANNOT_OPEN_PLAYER_DATABASE");
    if (override !== null)
        return override;
    if (resolved === null)
        resolved = (0, _1.default)(0 /* Database.WDFP_DATA */);
    return resolved;
}
exports.getDb = getDb;
