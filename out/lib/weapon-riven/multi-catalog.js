"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rivenRulesDigest = exports.readRivenResourceCatalog = exports.verifyRivenCatalog = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const sha256 = (value) => (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
function ids(value) {
    if (!Array.isArray(value) || !value.length || value.some(n => !Number.isSafeInteger(n) || n <= 0)
        || new Set(value).size !== value.length)
        throw new Error("RIVEN_INVALID_CATALOG_IDS");
    return [...value].sort((a, b) => a - b);
}
/** Build IDs bind actual client resource bytes, independently of server q-to-L rules. */
function verifyRivenCatalog(manifest, basePath) {
    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.resources)
        || manifest.resources.length < 2 || manifest.resources.length > 10000)
        throw new Error("RIVEN_INVALID_CATALOG");
    const souls = ids(manifest.soulKeys), weapons = ids(manifest.weaponIds), names = new Set();
    const resources = manifest.resources.map(resource => {
        if (!resource || typeof resource.logical !== "string" || !/^[A-Za-z0-9_./-]{1,240}$/.test(resource.logical)
            || names.has(resource.logical) || typeof resource.path !== "string" || !/^[a-f0-9]{64}$/.test(resource.sha256))
            throw new Error("RIVEN_INVALID_CATALOG_RESOURCE");
        names.add(resource.logical);
        if (sha256((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(basePath, resource.path))) !== resource.sha256)
            throw new Error("RIVEN_CATALOG_RESOURCE_CHANGED");
        return `${resource.logical}\t${resource.sha256}\n`;
    }).sort();
    if (!names.has("master/ability/ability_soul.orderedmap") || !names.has("master/item/equipment.orderedmap")
        || !names.has("master/item/item.orderedmap") || ![...names].some(name => name.endsWith("/custom_ability_string.orderedmap")))
        throw new Error("RIVEN_CATALOG_REQUIRED_RESOURCE");
    const resourceDigest = sha256(resources.join(""));
    return { id: `riven-multi-v1-${resourceDigest.slice(0, 32)}`, resourceDigest, soulKeys: new Set(souls), weaponIds: new Set(weapons) };
}
exports.verifyRivenCatalog = verifyRivenCatalog;
function readRivenResourceCatalog(path = process.env.WEAPON_RIVEN_MULTI_CATALOG) {
    if (!path)
        return null;
    const absolute = (0, node_path_1.resolve)(path);
    return verifyRivenCatalog(JSON.parse((0, node_fs_1.readFileSync)(absolute, "utf8").replace(/^\uFEFF/, "")), (0, node_path_1.dirname)(absolute));
}
exports.readRivenResourceCatalog = readRivenResourceCatalog;
/** Ordered scalar-free object representation is internal hashing only, never ACK encoding. */
function rivenRulesDigest(value) {
    const stable = (entry) => entry === null || typeof entry !== "object" ? entry
        : Array.isArray(entry) ? entry.map(stable)
            : Object.fromEntries(Object.keys(entry).sort().map(key => [key, stable(entry[key])]));
    return sha256(JSON.stringify(stable(value)));
}
exports.rivenRulesDigest = rivenRulesDigest;
