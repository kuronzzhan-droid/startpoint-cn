/**
 * Unified version control for CN asset update.
 *
 * CDN_VERSION is auto-detected from diff archive filenames.
 * CN_RES_VERSION in .env is OBSOLETE — version is derived from CDN + enabled patches.
 *
 * Flow:
 *   1st-time (no resVer): full.version="1.4.0", full.archives=all, target=CDN_VERSION
 *   Update  (resVer<target):  full.version=resVer, full.archives=[], target=max(CDN, patches)
 *   Up-to-date (resVer≥target): same als update but no diffs to download
 */
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import path from "path";
import {
    compareReleaseVersions,
    findReleasePath,
    getCnReleaseGraphSnapshot,
    isEligibleReleaseStart,
} from "./cn-asset-graph";
import type { ReleaseGraphSnapshot, ReleasePathResult } from "./cn-asset-graph";

// CDN full archives are at version 1.4.0
export const FULL_BASE = "1.4.0";

const VERSION_RE = /^\d+\.\d+\.\d+$/;

export interface AssetTarget {
    targetVersion: string;
    isFirstTime: boolean;
    fullVersion: string;
    path: ReleasePathResult;
}

// Detect highest version from CDN diff archives + enabled patches
export function getEffectiveVersion(
    snapshot: ReleaseGraphSnapshot = getCnReleaseGraphSnapshot(),
): string {
    return snapshot.tailVersion;
}

// Detect highest version from CDN diff archive filenames
let _cdnVersion: string | null = null;

export function detectCDNVersion(): string {
    return getEffectiveVersion();
}

export function parseVersion(v: string): number[] {
    return v.split(".").map(Number);
}

export function compareVersion(a: string, b: string): number {
    return compareReleaseVersions(a, b);
}

export interface PatchMeta {
    id: string; type: "patch" | "mod"; name: string;
    version: string; depends_on: string; enabled: boolean;
}

let _manifestCache: { cdn_version: string; patches: PatchMeta[] } | null = null;
let _manifestMtimeMs: number | null = null;

export function getPatchManifest(): { cdn_version: string; patches: PatchMeta[] } {
    const mp = path.join(__dirname, "..", "..", "assets", "asset-patch", "manifest.json");
    if (!existsSync(mp)) {
        _manifestCache = { cdn_version: "1.4.54", patches: [] };
        _manifestMtimeMs = null;
        return _manifestCache;
    }
    const mtimeMs = statSync(mp).mtimeMs;
    if (_manifestCache && _manifestMtimeMs === mtimeMs) return _manifestCache;
    _manifestCache = JSON.parse(readFileSync(mp, "utf8"));
    _manifestMtimeMs = mtimeMs;
    return _manifestCache!;
}

export function reloadPatchManifest(): void {
    _manifestCache = null;
    _manifestMtimeMs = null;
}

// Max enabled patch version whose depends_on <= resVer
export function getMaxPatchVersion(resVer?: string): string | null {
    if (!resVer) return null;
    const manifest = getPatchManifest();
    let maxV: string | null = null;
    for (const p of manifest.patches) {
        if (!p.enabled || p.type !== "patch") continue;
        if (compareVersion(p.depends_on, resVer) > 0) continue;
        if (!maxV || compareVersion(p.version, maxV) > 0) maxV = p.version;
    }
    return maxV;
}

export function isFirstTime(resVer?: string, fullBase = FULL_BASE): boolean {
    return !resVer
        || !VERSION_RE.test(resVer)
        || compareReleaseVersions(resVer, fullBase) < 0;
}

/**
 * Compute asset update response for a client.
 * 1st-time: full download to CDN_VERSION + applicable patches.
 * Update:   only diff from resVer to effective version.
 */
export function computeAssetTarget(
    resVer?: string,
    snapshot: ReleaseGraphSnapshot = getCnReleaseGraphSnapshot(),
): AssetTarget {
    const first = isFirstTime(resVer, snapshot.fullBase);
    const startVersion = first ? snapshot.fullBase : resVer!;
    const releasePath = isEligibleReleaseStart(snapshot, startVersion)
        ? findReleasePath(snapshot, startVersion)
        : { startVersion, targetVersion: startVersion, edges: [] };
    return {
        targetVersion: releasePath.targetVersion,
        isFirstTime: first,
        fullVersion: startVersion,
        path: releasePath,
    };
}
