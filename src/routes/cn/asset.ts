import { existsSync } from "../../lib/file-exists";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders } from "../../utils";

import path from "path";
import { getZipArchiveMetadata, invalidateZipCache } from "../../lib/zip-summary-cache";
import { getPatchManifest } from "../../lib/version";

const CN_PORT = process.env.CN_LISTEN_PORT || "8001";

/** Validates the configured origin and removes trailing slashes before path joins. */
export function normalizeCdnBaseUrl(value: string): string {
    const trimmed = value.trim();
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error("CDN_BASE_URL must be an absolute HTTP(S) URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("CDN_BASE_URL must use HTTP or HTTPS.");
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error("CDN_BASE_URL must not contain credentials, a query, or a fragment.");
    }
    return parsed.toString().replace(/\/+$/, "");
}

export function joinCdnPath(baseUrl: string, ...segments: string[]): string {
    const normalizedBase = baseUrl.replace(/\/+$/, "");
    const suffix = segments
        .map(segment => segment.replace(/^\/+|\/+$/g, ""))
        .filter(Boolean)
        .join("/");
    return suffix ? `${normalizedBase}/${suffix}` : normalizedBase;
}

const CDN_BASE = process.env.CDN_BASE_URL
    ? normalizeCdnBaseUrl(process.env.CDN_BASE_URL)
    : undefined;
// Test-server split distribution: CDN_BASE_URL (Cloudflare mirror) serves everything up to
// LOCAL_PATCH_AFTER; newer asset patches are served from LOCAL_PATCH_BASE_URL (this server).
const LOCAL_PATCH_BASE = process.env.LOCAL_PATCH_BASE_URL
    ? normalizeCdnBaseUrl(process.env.LOCAL_PATCH_BASE_URL)
    : undefined;
const LOCAL_PATCH_AFTER = process.env.LOCAL_PATCH_AFTER || undefined;
// Archives whose mirror copy differs from ours (comma-separated file names) are also served locally.
const LOCAL_PATCH_FILES = new Set((process.env.LOCAL_PATCH_FILES || "").split(",").map(s => s.trim()).filter(Boolean));
/** Clears short-lived ZIP metadata after an in-process asset publication. */
export function invalidateAssetArchiveCatalog(directory?: string): void {
    invalidateZipCache(directory);
}

/** Reads ZIP names and sizes with a short TTL; response URLs are never cached. */
export function getAssetArchiveMetadata(directory: string) {
    return getZipArchiveMetadata(directory);
}

export const FULL_ARCHIVE_SUBDIRS = [
    "archive-common-full",
    "archive-medium-full",
    "archive-android-full",
    "archive-ios-full",
] as const;

export const DIFF_ARCHIVE_SUBDIRS = [
    "archive-common-diff",
    "archive-medium-diff",
    "archive-android-diff",
    "archive-ios-diff",
] as const;

/** Get CDN base URL from request Host header, fall back to CDN_BASE_URL env or default. */
function getCdnBase(request: FastifyRequest): string {
    if (CDN_BASE) return CDN_BASE;
    const host = request.headers.host || `localhost:${CN_PORT}`;
    return normalizeCdnBaseUrl(`http://${host}/patch/cn`);
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
    const value = request.headers[name];
    return typeof value === "string" ? value : undefined;
}

/**
 * CN iOS clients use the same asset update chain as Android clients.
 * Numeric platform values are sent by some client builds (1 = iOS, 2 = Android).
 */
export function isSupportedAssetDevice(device?: string): boolean {
    if (device === undefined) return true;
    const normalized = device.toLowerCase();
    return normalized === "1"
        || normalized === "2"
        || normalized === "android"
        || normalized === "ios";
}

export function isIosAssetDevice(device?: string): boolean {
    const normalized = device?.toLowerCase();
    return normalized === "1" || normalized === "ios";
}

export function getEntityListName(device?: string): string {
    return isIosAssetDevice(device)
        ? "10939-ios_medium.csv"
        : "10939-android_medium.csv";
}

export function getFullArchiveSubdirs(device?: string): readonly string[] {
    return [
        "archive-common-full",
        "archive-medium-full",
        isIosAssetDevice(device) ? "archive-ios-full" : "archive-android-full",
    ];
}

export function getDiffArchiveSubdirs(device?: string): readonly string[] {
    return [
        "archive-common-diff",
        "archive-medium-diff",
        isIosAssetDevice(device) ? "archive-ios-diff" : "archive-android-diff",
    ];
}

/** Detect CDN path-list dir name: `EntityLists` (cn_cdn) or `entities` (cn_cdn_new). */
function entityListsDirName(): string {
    if (existsSync(path.join(cdnDir, "EntityLists"))) return "EntityLists";
    if (existsSync(path.join(cdnDir, "entities"))) return "entities";
    return "EntityLists";
}

export function getVersionInfo(baseUrl: string, totalSize: number, device?: string) {
    const el = entityListsDirName();
    const entityBase = `${joinCdnPath(baseUrl, el, ...(el === "entities" ? ["files"] : []))}/`;
    return {
        base_url: entityBase,
        files_list: joinCdnPath(baseUrl, el, getEntityListName(device)),
        total_size: totalSize,
        delayed_assets_size: 0
    };
}

function buildArchiveList(baseUrl: string, cdnDir: string, subdir: string): { location: string; size: number; sha256: string }[] {
    const dir = path.join(cdnDir, subdir);
    try {
        return getAssetArchiveMetadata(dir).map(archive => ({
            location: joinCdnPath(baseUrl, subdir, archive.filename),
            size: archive.size,
            sha256: ""
        }));
    } catch (e) {
        console.error(`[CDN] buildArchiveList failed for ${subdir}:`, (e as Error).message);
        return [];
    }
}

function parseVersion(v: string): number[] {
    return v.split(".").map(Number);
}

function compareVersion(a: string, b: string): number {
    const av = parseVersion(a), bv = parseVersion(b);
    for (let i = 0; i < 3; i++) {
        if (av[i] !== bv[i]) return av[i] - bv[i];
    }
    return 0;
}

/**
 * Return the archive names explicitly published by enabled manifest entries.
 *
 * The active directory also contains held local-test and superseded archives.
 * Scanning that directory as the source of truth can make a clean client
 * download multiple archives for the same version edge; whichever archive is
 * applied last then wins for overlapping resources.  The manifest is the
 * release boundary, while the directory is only the storage location.
 */
function getEnabledPatchArchiveNames(): Set<string> {
    const names = new Set<string>();
    const manifest = getPatchManifest() as {
        patches?: Array<{
            type?: string;
            enabled?: boolean;
            archive?: unknown;
            chain?: unknown;
        }>;
    };
    for (const patch of manifest.patches ?? []) {
        if (patch.type !== "patch" || patch.enabled !== true) continue;
        const archives = Array.isArray(patch.chain)
            ? patch.chain
            : [patch.archive];
        for (const archive of archives) {
            if (typeof archive === "string" && archive.length > 0) names.add(archive);
        }
    }
    return names;
}

const ACTIVE_PATCH_DIR = path.join(__dirname, "..", "..", "..", "assets", "asset-patch", "active");

export interface DiffArchiveKey {
    readonly from: string;
    readonly to: string;
    readonly seq: number;
}

/** Parses `pinball-<from>-<to>-<seq>-<name>.zip`; returns null for other names. */
export function parseDiffArchiveName(filename: string): DiffArchiveKey | null {
    const match = filename.match(/pinball-(\d+\.\d+\.\d+)-(\d+\.\d+\.\d+)-(\d+)-/);
    if (!match) return null;
    return { from: match[1], to: match[2], seq: Number.parseInt(match[3], 10) };
}

/** Numeric (from, to, seq) order; the file name only breaks exact ties. */
export function compareDiffArchiveNames(a: string, b: string): number {
    const ka = parseDiffArchiveName(a), kb = parseDiffArchiveName(b);
    if (ka && kb) {
        const order = compareVersion(ka.from, kb.from)
            || compareVersion(ka.to, kb.to)
            || ka.seq - kb.seq;
        if (order !== 0) return order;
    } else if (ka || kb) {
        return ka ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The client concatenates each version group's `archive` array in the order
 * returned here and hands the flat list to its downloader, so archives of one
 * version edge must follow their numeric sequence. Directory listing order is
 * platform dependent and sorts "10" before "2", so it is never relied on.
 */
function sortDiffArchives<T extends { readonly filename: string }>(
    archives: readonly T[],
): { archive: T; key: DiffArchiveKey }[] {
    const entries: { archive: T; key: DiffArchiveKey }[] = [];
    for (const archive of archives) {
        const key = parseDiffArchiveName(archive.filename);
        if (key) entries.push({ archive, key });
    }
    return entries.sort((a, b) => compareDiffArchiveNames(a.archive.filename, b.archive.filename));
}

/**
 * Reports publication problems in the enabled patch chain: duplicate
 * (from, to, seq) triples, sequence gaps inside one edge, conflicting or
 * non-contiguous version edges, and listed archives missing from disk.
 * Returns readable warnings; an empty array means the chain is clean.
 */
export function checkPatchChainIntegrity(publishedNames: Iterable<string>, filesOnDisk: Iterable<string>): string[] {
    const warnings: string[] = [];
    const onDisk = new Set(filesOnDisk);
    const triples = new Map<string, string[]>();
    const edges = new Map<string, { from: string; to: string; seqs: number[] }>();
    const fromByTarget = new Map<string, Set<string>>();
    for (const name of publishedNames) {
        if (!onDisk.has(name)) warnings.push(`listed archive missing from active directory: ${name}`);
        const key = parseDiffArchiveName(name);
        if (!key) {
            warnings.push(`listed archive name has no (from,to,seq) prefix: ${name}`);
            continue;
        }
        const triple = `${key.from}->${key.to}#${key.seq}`;
        triples.set(triple, [...(triples.get(triple) ?? []), name]);
        const edgeId = `${key.from}->${key.to}`;
        const edge = edges.get(edgeId) ?? { from: key.from, to: key.to, seqs: [] };
        edge.seqs.push(key.seq);
        edges.set(edgeId, edge);
        const froms = fromByTarget.get(key.to) ?? new Set<string>();
        froms.add(key.from);
        fromByTarget.set(key.to, froms);
    }
    for (const [triple, names] of triples) {
        if (names.length > 1) warnings.push(`duplicate (from,to,seq) ${triple}: ${[...names].sort().join(", ")}`);
    }
    for (const [to, froms] of fromByTarget) {
        if (froms.size > 1) {
            warnings.push(`version ${to} is reached from several versions: ${[...froms].sort(compareVersion).join(", ")}`);
        }
    }
    const ordered = [...edges.values()]
        .sort((a, b) => compareVersion(a.from, b.from) || compareVersion(a.to, b.to));
    for (const edge of ordered) {
        const seqs = [...new Set(edge.seqs)].sort((a, b) => a - b);
        const expected = seqs.map((_, index) => index + 1);
        if (seqs.join(",") !== expected.join(",")) {
            warnings.push(`sequence gap in ${edge.from}->${edge.to}: found [${seqs.join(",")}], expected [${expected.join(",")}]`);
        }
    }
    for (let i = 1; i < ordered.length; i++) {
        const previous = ordered[i - 1], current = ordered[i];
        if (previous.to === current.to) continue;
        if (current.from !== previous.to) {
            warnings.push(`chain gap: ${previous.from}->${previous.to} is followed by ${current.from}->${current.to}`);
        }
    }
    return warnings;
}

/** Startup self-check: logs a malformed patch chain, never blocks startup. */
export function reportPatchChainIntegrity(): string[] {
    let warnings: string[];
    try {
        const filesOnDisk = existsSync(ACTIVE_PATCH_DIR)
            ? getAssetArchiveMetadata(ACTIVE_PATCH_DIR).map(archive => archive.filename)
            : [];
        warnings = checkPatchChainIntegrity(getEnabledPatchArchiveNames(), filesOnDisk);
    } catch (e) {
        warnings = [`self-check could not run: ${(e as Error).message}`];
    }
    for (const warning of warnings) console.warn(`[PATCH] chain self-check: ${warning}`);
    return warnings;
}

function buildDiffList(
    baseUrl: string,
    cdnDir: string,
    clientVersion: string,
    targetVersion: string,
    device?: string,
): { original_version: string; version: string; archive: { location: string; size: number; sha256: string }[] }[] {
    const groups = new Map<string, { original_version: string; archive: { location: string; size: number; sha256: string }[] }>();
    
    // CDN diff archives
    for (const subdir of getDiffArchiveSubdirs(device)) {
        const dir = path.join(cdnDir, subdir);
        try {
            for (const { archive, key } of sortDiffArchives(getAssetArchiveMetadata(dir))) {
                if (!groups.has(key.to)) groups.set(key.to, { original_version: key.from, archive: [] });
                groups.get(key.to)!.archive.push({ location: joinCdnPath(baseUrl, subdir, archive.filename), size: archive.size, sha256: "" });
            }
        } catch (e) {
            console.error(`[CDN] buildDiffList failed for ${subdir}:`, (e as Error).message);
        }
    }
    
    // Asset patch archives (active patches only)
    const publishedArchives = getEnabledPatchArchiveNames();
    try {
        const published = getAssetArchiveMetadata(ACTIVE_PATCH_DIR)
            .filter(archive => publishedArchives.has(archive.filename));
        for (const { archive, key } of sortDiffArchives(published)) {
            if (!groups.has(key.to)) groups.set(key.to, { original_version: key.from, archive: [] });
            // Test server: patches newer than what the Cloudflare mirror carries come from this box.
            const patchBase = LOCAL_PATCH_BASE
                && ((LOCAL_PATCH_AFTER && compareVersion(key.to, LOCAL_PATCH_AFTER) > 0) || LOCAL_PATCH_FILES.has(archive.filename))
                ? LOCAL_PATCH_BASE : baseUrl;
            groups.get(key.to)!.archive.push({ location: joinCdnPath(patchBase, "asset-patch", "active", archive.filename), size: archive.size, sha256: "" });
        }
    } catch (e) {
        console.error(`[PATCH] buildDiffList failed for active patches:`, (e as Error).message);
    }
    
    return [...groups.entries()]
        // The client totals every returned archive for its confirmation
        // dialog. Do not expose unrelated historical update steps.
        .filter(([version]) =>
            compareVersion(version, clientVersion) > 0
            && compareVersion(version, targetVersion) <= 0
        )
        .sort(([a], [b]) => compareVersion(a, b))
        .map(([version, data]) => ({ original_version: data.original_version, version, archive: data.archive }));
}

const envCdnDir = process.env.CDN_DIR || ".cdn";
const cdnDir = path.isAbsolute(envCdnDir) ? path.join(envCdnDir, "cn") : path.join(__dirname, "..", "..", "..", envCdnDir, "cn");

function sumArchiveSizes(archives: { size: number }[]): number {
    return archives.reduce((total, archive) => total + archive.size, 0);
}

/** Calculate only the archives this client will actually download. */
export function getAssetDownloadSize(resVer?: string, device?: string): number {
    const { computeAssetTarget } = require("../../lib/version");
    const { targetVersion, isFirstTime: first, fullVersion } = computeAssetTarget(resVer);
    const fullArchives = first
        ? [
            ...getFullArchiveSubdirs(device).flatMap(subdir => buildArchiveList("", cdnDir, subdir)),
        ]
        : [];
    const diffBaseVersion = first ? fullVersion : (resVer ?? fullVersion);
    const diffArchives = buildDiffList("", cdnDir, diffBaseVersion, targetVersion, device)
        .flatMap(group => group.archive);
    return sumArchiveSizes(fullArchives) + sumArchiveSizes(diffArchives);
}

// 启动时检查一次补丁链，只告警不阻断启动
reportPatchChainIntegrity();

// 启动时扫描一次，动态计算总大小
const TOTAL_SIZE = (() => {
    let total = 0;
    for (const subdir of [...FULL_ARCHIVE_SUBDIRS, ...DIFF_ARCHIVE_SUBDIRS]) {
        try {
            for (const archive of getAssetArchiveMetadata(path.join(cdnDir, subdir))) {
                total += archive.size;
            }
        } catch (e) {
            console.error(`[CDN] TOTAL_SIZE failed for ${subdir}:`, (e as Error).message);
        }
    }
    return total;
})();

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/version_info", async (request: FastifyRequest, reply: FastifyReply) => {
        const baseUrl = getCdnBase(request);
        const resVer = request.headers['res_ver'] as string | undefined;
        const device = headerValue(request, "device");
        reply.type("application/json");
        return reply.status(200).send({
            data_headers: generateDataHeaders(),
            data: getVersionInfo(baseUrl, getAssetDownloadSize(resVer, device), device)
        });
    });

    fastify.post("/get_path", async (request: FastifyRequest, reply: FastifyReply) => {
        const device = headerValue(request, "device");
        if (!isSupportedAssetDevice(device)) {
            return reply.status(400).type("application/json").send({
                code: "UNSUPPORTED_PLATFORM",
                message: `unsupported DEVICE header: ${device?.toLowerCase()}`
            });
        }

        const baseUrl = getCdnBase(request);
        const resVer = request.headers['res_ver'] as string | undefined;
        const { computeAssetTarget } = require("../../lib/version");
        const { targetVersion, isFirstTime: first, fullVersion } = computeAssetTarget(resVer);

        const fullArchives = first
            ? [
                ...getFullArchiveSubdirs(device).flatMap(subdir => buildArchiveList(baseUrl, cdnDir, subdir)),
            ]
            : [];

        const diffBaseVersion = first ? fullVersion : (resVer ?? fullVersion);
        const diffArchives = buildDiffList(
            baseUrl,
            cdnDir,
            diffBaseVersion,
            targetVersion,
            device,
        );

        // Empty objects/arrays become Option.Some in AIR and open a 0 MB dialog.
        // Only acknowledge an already-current client with no archive tasks.
        // Keep initial downloads and real (even tiny) archives on the download path.
        const noUpdate = !first && resVer === targetVersion
            && fullArchives.length === 0 && diffArchives.length === 0;

        reply.type("application/json");
        return reply.status(200).send({
            data_headers: generateDataHeaders({ asset_update: !noUpdate }),
            data: {
                info: {
                    client_asset_version: resVer ?? "",
                    target_asset_version: targetVersion,
                    eventual_target_asset_version: targetVersion,
                    is_initial: first,
                    latest_maj_first_version: "1.4.0"
                },
                full: noUpdate ? null : {
                    version: fullVersion,
                    archive: fullArchives
                },
                diff: noUpdate ? null : diffArchives,
                asset_version_hash: ""
            }
        });
    });
};

export default routes;

export const CDN_TOTAL_SIZE = TOTAL_SIZE;
export const ENTITY_LISTS_DIR = entityListsDirName();
