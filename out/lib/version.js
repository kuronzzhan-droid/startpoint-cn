"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeAssetTarget = exports.isFirstTime = exports.getMaxPatchVersion = exports.reloadPatchManifest = exports.getPatchManifest = exports.compareVersion = exports.parseVersion = exports.detectCDNVersion = exports.getEffectiveVersion = exports.FULL_BASE = void 0;
const file_exists_1 = require("./file-exists");
/**
 * Unified version control for CN asset update.
 *
 * CDN_VERSION is auto-detected from diff archive filenames.
 * CN_RES_VERSION in .env is OBSOLETE — version is derived from CDN + enabled patches.
 *
 * Flow:
 *   1st-time (no resVer): full.version="1.4.0", full.archives=all, target=CDN_VERSION
 *   Update  (resVer<target):  full.version=resVer, full.archives=[], target=max(CDN, patches)
 *   Up-to-date (resVer≥target): full=null, diff=null when no archive task remains
 */
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
// CDN full archives are at version 1.4.0
exports.FULL_BASE = "1.4.0";
// Detect highest version from CDN diff archives + enabled patches
function getEffectiveVersion() {
    const cdnVer = detectCDNVersion();
    // Scan ALL enabled patches for max version (not filtered by depends_on)
    const manifest = getPatchManifest();
    let maxPatchVer = null;
    for (const p of manifest.patches) {
        if (!p.enabled || p.type !== "patch")
            continue;
        if (!maxPatchVer || compareVersion(p.version, maxPatchVer) > 0)
            maxPatchVer = p.version;
    }
    if (maxPatchVer && compareVersion(maxPatchVer, cdnVer) > 0)
        return maxPatchVer;
    return cdnVer;
}
exports.getEffectiveVersion = getEffectiveVersion;
// Detect highest version from CDN diff archive filenames
let _cdnVersion = null;
function detectCDNVersion() {
    if (_cdnVersion)
        return _cdnVersion;
    const cdnDir = path_1.default.join(__dirname, "..", "..", ".cdn", "cn");
    let max = "1.4.0";
    for (const subdir of ["archive-common-diff", "archive-medium-diff", "archive-android-diff"]) {
        const dir = path_1.default.join(cdnDir, subdir);
        try {
            for (const f of (0, fs_1.readdirSync)(dir).filter(f => f.endsWith(".zip"))) {
                const m = f.match(/pinball-\d+\.\d+\.\d+-(\d+\.\d+\.\d+)-\d+-/);
                if (m && compareVersion(m[1], max) > 0)
                    max = m[1];
            }
        }
        catch (_) { /* ignore */ }
    }
    _cdnVersion = max;
    return max;
}
exports.detectCDNVersion = detectCDNVersion;
function parseVersion(v) {
    return v.split(".").map(Number);
}
exports.parseVersion = parseVersion;
function compareVersion(a, b) {
    const av = parseVersion(a), bv = parseVersion(b);
    for (let i = 0; i < 3; i++) {
        if (av[i] !== bv[i])
            return av[i] - bv[i];
    }
    return 0;
}
exports.compareVersion = compareVersion;
let _manifestCache = null;
let _manifestMtimeMs = null;
function getPatchManifest() {
    const mp = path_1.default.join(__dirname, "..", "..", "assets", "asset-patch", "manifest.json");
    if (!(0, file_exists_1.existsSync)(mp)) {
        _manifestCache = { cdn_version: "1.4.54", patches: [] };
        _manifestMtimeMs = null;
        return _manifestCache;
    }
    const mtimeMs = (0, fs_1.statSync)(mp).mtimeMs;
    if (_manifestCache && _manifestMtimeMs === mtimeMs)
        return _manifestCache;
    _manifestCache = JSON.parse((0, fs_1.readFileSync)(mp, "utf8"));
    _manifestMtimeMs = mtimeMs;
    return _manifestCache;
}
exports.getPatchManifest = getPatchManifest;
function reloadPatchManifest() {
    _manifestCache = null;
    _manifestMtimeMs = null;
}
exports.reloadPatchManifest = reloadPatchManifest;
// Max enabled patch version whose depends_on <= resVer
function getMaxPatchVersion(resVer) {
    if (!resVer)
        return null;
    const manifest = getPatchManifest();
    let maxV = null;
    for (const p of manifest.patches) {
        if (!p.enabled || p.type !== "patch")
            continue;
        if (compareVersion(p.depends_on, resVer) > 0)
            continue;
        if (!maxV || compareVersion(p.version, maxV) > 0)
            maxV = p.version;
    }
    return maxV;
}
exports.getMaxPatchVersion = getMaxPatchVersion;
function isFirstTime(resVer) {
    return !resVer || compareVersion(exports.FULL_BASE, resVer) > 0;
}
exports.isFirstTime = isFirstTime;
/**
 * Compute asset update response for a client.
 * 1st-time: full download to CDN_VERSION + applicable patches.
 * Update:   only diff from resVer to effective version.
 */
function computeAssetTarget(resVer) {
    if (isFirstTime(resVer)) {
        return {
            targetVersion: getEffectiveVersion(),
            isFirstTime: true,
            fullVersion: exports.FULL_BASE,
        };
    }
    // Non-first-time: client already has full CDN data
    const effective = getEffectiveVersion();
    const target = compareVersion(effective, resVer) > 0 ? effective : resVer;
    return {
        targetVersion: target,
        isFirstTime: false,
        fullVersion: resVer, // tell client its current version = its full version
    };
}
exports.computeAssetTarget = computeAssetTarget;
