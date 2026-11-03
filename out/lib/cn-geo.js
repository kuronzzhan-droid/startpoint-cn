"use strict";
// Decides whether a client IP is in mainland China (APNIC CN ipv4 ranges).
// Unknown, private and IPv6 addresses count as China so they keep the local download node.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLikelyOverseasIp = isLikelyOverseasIp;
const fs_1 = require("fs");
const path_1 = require("path");
let ranges = null;
function loadRanges() {
    if (ranges !== null)
        return ranges;
    try {
        const file = (0, path_1.join)(__dirname, "..", "..", "assets", "cn_ipv4_ranges.json");
        ranges = JSON.parse((0, fs_1.readFileSync)(file, "utf8")).ranges;
    }
    catch (e) {
        console.warn("[CN-GEO] range table unavailable, treating every client as China", e && e.message);
        ranges = [];
    }
    return ranges;
}
function ipv4ToInt(ip) {
    const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip || "");
    if (!m)
        return null;
    const p = m.slice(1).map(Number);
    if (p.some(x => x > 255))
        return null;
    return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function isPrivate(n) {
    const a = n >>> 24, b = (n >>> 16) & 255;
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}
/** True only for a public IPv4 address outside the CN table. */
function isLikelyOverseasIp(ip) {
    const n = ipv4ToInt(ip);
    if (n === null || isPrivate(n))
        return false;
    const r = loadRanges();
    if (r.length === 0)
        return false;
    let lo = 0, hi = r.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (n < r[mid][0])
            hi = mid - 1;
        else if (n > r[mid][1])
            lo = mid + 1;
        else
            return false;
    }
    return true;
}
