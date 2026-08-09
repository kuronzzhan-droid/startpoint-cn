import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateDataHeaders } from "../../utils";
import { existsSync, lstatSync, readdirSync, statSync } from "fs";
import path from "path";
import {
    findReleasePath,
    MAX_ARCHIVE_SEQ,
} from "../../lib/cn-asset-graph";
import type { ReleaseGraphSnapshot, ReleasePathResult } from "../../lib/cn-asset-graph";
import type { DiffGroup } from "../../lib/cn-character-release";

const CN_PORT = process.env.CN_LISTEN_PORT || "8001";
const CDN_BASE = process.env.CDN_BASE_URL;

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
    return `http://${host}/patch/cn`;
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
    const entityBase = el === "entities" ? `${baseUrl}/${el}/files/` : `${baseUrl}/${el}/`;
    return {
        base_url: entityBase,
        files_list: `${baseUrl}/${el}/${getEntityListName(device)}`,
        total_size: totalSize,
        delayed_assets_size: 0
    };
}

const FULL_ARCHIVE_RE = /^pinball-1\.4\.0-([1-9]\d*)-(.+)\.zip$/;
const SAFE_FULL_ARCHIVE_SUBDIRS = new Set(FULL_ARCHIVE_SUBDIRS);

export function buildArchiveList(baseUrl: string, cdnDir: string, subdir: string): { location: string; size: number; sha256: string }[] {
    if (!SAFE_FULL_ARCHIVE_SUBDIRS.has(subdir as typeof FULL_ARCHIVE_SUBDIRS[number])) {
        console.error(`[CDN] rejecting full archive subdirectory: ${subdir}`);
        return [];
    }
    const resolvedCdnDir = path.resolve(cdnDir);
    const dir = path.resolve(resolvedCdnDir, subdir);
    if (path.dirname(dir) !== resolvedCdnDir) {
        console.error(`[CDN] rejecting full archive path outside CDN root: ${dir}`);
        return [];
    }
    try {
        const directoryStats = lstatSync(dir);
        if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
            console.error(`[CDN] rejecting unsafe full archive directory: ${dir}`);
            return [];
        }
        return readdirSync(dir)
            .filter(name => name.endsWith(".zip"))
            .flatMap(name => {
                const match = FULL_ARCHIVE_RE.exec(name);
                if (match === null) {
                    console.error(`[CDN] skipping noncanonical full archive: ${path.join(dir, name)}`);
                    return [];
                }
                const seq = Number(match[1]);
                if (!Number.isSafeInteger(seq) || seq < 1 || seq > MAX_ARCHIVE_SEQ) {
                    console.error(`[CDN] skipping full archive sequence outside 1..${MAX_ARCHIVE_SEQ}: ${path.join(dir, name)}`);
                    return [];
                }
                const archivePath = path.join(dir, name);
                const stats = lstatSync(archivePath);
                if (stats.isSymbolicLink() || !stats.isFile()) {
                    console.error(`[CDN] skipping unsafe full archive path: ${archivePath}`);
                    return [];
                }
                return {
                    name,
                    seq,
                    archive: {
                        location: `${baseUrl}/${subdir}/${name}`,
                        size: stats.size,
                        sha256: ""
                    },
                };
            })
            .sort((left, right) => left.seq - right.seq || left.name.localeCompare(right.name))
            .map(({ archive }) => archive);
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

export function buildDiffList(
    baseUrl: string,
    snapshot: ReleaseGraphSnapshot,
    releasePath?: ReleasePathResult,
): DiffGroup[];
export function buildDiffList(
    baseUrl: string,
    cdnDir: string,
    clientVersion: string,
    targetVersion: string,
    device?: string,
): DiffGroup[];
export function buildDiffList(
    baseUrl: string,
    source: string | ReleaseGraphSnapshot,
    clientVersionOrPath?: string | ReleasePathResult,
    targetVersion?: string,
    device?: string,
): DiffGroup[] {
    if (typeof source !== "string") {
        const releasePath = typeof clientVersionOrPath === "object"
            ? clientVersionOrPath
            : findReleasePath(source, source.fullBase);
        const normalizedBase = baseUrl.replace(/\/$/, "");
        return releasePath.edges.map(edge => ({
            original_version: edge.from,
            version: edge.to,
            archive: edge.archives.map(archive => ({
                location: `${normalizedBase}/${archive.relativePath}`,
                size: archive.size,
                sha256: archive.sha256,
            })),
        }));
    }

    const cdnDir = source;
    const clientVersion = typeof clientVersionOrPath === "string" ? clientVersionOrPath : "0.0.0";
    const resolvedTargetVersion = targetVersion ?? clientVersion;
    const groups = new Map<string, { original_version: string; archive: { location: string; size: number; sha256: string }[] }>();

    // CDN diff archives
    for (const subdir of getDiffArchiveSubdirs(device)) {
        const dir = path.join(cdnDir, subdir);
        try {
            for (const f of readdirSync(dir).filter(f => f.endsWith(".zip"))) {
                const match = f.match(/pinball-(\d+\.\d+\.\d+)-(\d+\.\d+\.\d+)-\d+-/);
                if (match) {
                    const from = match[1];
                    const to = match[2];
                    const stats = statSync(path.join(dir, f));
                    if (!groups.has(to)) groups.set(to, { original_version: from, archive: [] });
                    groups.get(to)!.archive.push({ location: `${baseUrl}/${subdir}/${f}`, size: stats.size, sha256: "" });
                }
            }
        } catch (e) {
            console.error(`[CDN] buildDiffList failed for ${subdir}:`, (e as Error).message);
        }
    }

    // Asset patch archives (active patches only)
    const patchDir = path.join(__dirname, "..", "..", "..", "assets", "asset-patch", "active");
    try {
        for (const f of readdirSync(patchDir).filter(f => f.endsWith(".zip"))) {
            const match = f.match(/pinball-(\d+\.\d+\.\d+)-(\d+\.\d+\.\d+)-\d+-/);
            if (match) {
                const from = match[1];
                const to = match[2];
                const stats = statSync(path.join(patchDir, f));
                if (!groups.has(to)) groups.set(to, { original_version: from, archive: [] });
                groups.get(to)!.archive.push({ location: `${baseUrl}/asset-patch/active/${f}`, size: stats.size, sha256: "" });
            }
        }
    } catch (e) {
        console.error(`[PATCH] buildDiffList failed for active patches:`, (e as Error).message);
    }

    return [...groups.entries()]
        // The client totals every returned archive for its confirmation
        // dialog. Do not expose unrelated historical update steps.
        .filter(([version]) =>
            compareVersion(version, clientVersion) > 0
            && compareVersion(version, resolvedTargetVersion) <= 0
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

// 启动时扫描一次，动态计算总大小
const TOTAL_SIZE = (() => {
    let total = 0;
    for (const subdir of [...FULL_ARCHIVE_SUBDIRS, ...DIFF_ARCHIVE_SUBDIRS]) {
        try {
            for (const f of readdirSync(path.join(cdnDir, subdir)).filter(f => f.endsWith(".zip")))
                total += statSync(path.join(cdnDir, subdir, f)).size;
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
        reply.status(200).send({
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

        reply.type("application/json");
        reply.status(200).send({
            data_headers: generateDataHeaders({ asset_update: true }),
            data: {
                info: {
                    client_asset_version: resVer ?? "",
                    target_asset_version: targetVersion,
                    eventual_target_asset_version: targetVersion,
                    is_initial: first,
                    latest_maj_first_version: "1.4.0"
                },
                full: {
                    version: fullVersion,
                    archive: fullArchives
                },
                diff: diffArchives,
                asset_version_hash: ""
            }
        });
    });
};

export default routes;

export const CDN_TOTAL_SIZE = TOTAL_SIZE;
export const ENTITY_LISTS_DIR = entityListsDirName();
