"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseIosCompatConfig = exports.normalizeIosApiHost = void 0;
const net_1 = require("net");
const DISABLED_IOS_COMPAT = Object.freeze({
    enabled: false,
    apiHost: "",
    apiScheme: "http",
});
function isValidHostname(value) {
    if (value.length === 0 || value.length > 253)
        return false;
    return value.split(".").every(label => label.length > 0
        && label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}
function parsePort(value) {
    if (value === undefined)
        return true;
    if (!/^\d+$/.test(value))
        return false;
    const port = Number(value);
    return Number.isSafeInteger(port) && port >= 1 && port <= 65535;
}
/** Validate a client-reachable authority in host[:port] form. */
function normalizeIosApiHost(value) {
    const authority = value.trim();
    if (authority.length === 0 || /[\s\/?#@]/.test(authority))
        return null;
    if (authority.startsWith("[")) {
        const match = authority.match(/^\[([^\]]+)\](?::(\d+))?$/);
        if (match === null || (0, net_1.isIP)(match[1]) !== 6 || !parsePort(match[2]))
            return null;
        if (match[1] === "::")
            return null;
        return authority;
    }
    const firstColon = authority.indexOf(":");
    const lastColon = authority.lastIndexOf(":");
    if (firstColon !== lastColon)
        return null;
    const host = firstColon === -1 ? authority : authority.slice(0, firstColon);
    const port = firstColon === -1 ? undefined : authority.slice(firstColon + 1);
    if (!parsePort(port))
        return null;
    if (host === "0.0.0.0")
        return null;
    if ((0, net_1.isIP)(host) === 0 && !isValidHostname(host))
        return null;
    return authority;
}
exports.normalizeIosApiHost = normalizeIosApiHost;
function parseIosCompatConfig(env = process.env, warn = message => console.warn(message)) {
    var _a;
    if (env.IOS_COMPAT_ENABLED !== "1")
        return DISABLED_IOS_COMPAT;
    const apiHost = normalizeIosApiHost((_a = env.IOS_API_HOST) !== null && _a !== void 0 ? _a : "");
    if (apiHost === null) {
        warn("[iOS] IOS_COMPAT_ENABLED=1 requires a valid IOS_API_HOST in host[:port] form; compatibility disabled");
        return DISABLED_IOS_COMPAT;
    }
    return Object.freeze({
        enabled: true,
        apiHost,
        apiScheme: env.IOS_API_SCHEME === "https" ? "https" : "http",
    });
}
exports.parseIosCompatConfig = parseIosCompatConfig;
