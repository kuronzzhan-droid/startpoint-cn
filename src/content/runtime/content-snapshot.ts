import fs from "node:fs"
import path from "node:path"

export interface ContentRepositoryInfo {
    readonly source: "bundled"
    readonly assetVersion: string
    readonly generatorVersion: number
    readonly releaseDigest: null
}

export interface ReadonlyContentRepository {
    info(): ContentRepositoryInfo
    table<T>(tableName: string): T
}

const tableCache = new Map<string, unknown>()

const bundledRepository: ReadonlyContentRepository = Object.freeze({
    info(): ContentRepositoryInfo {
        return {
            source: "bundled",
            assetVersion: "1.4.58",
            generatorVersion: 1,
            releaseDigest: null,
        }
    },
    table<T>(tableName: string): T {
        if (!/^[a-z0-9_-]+\.json$/i.test(tableName)) {
            throw new TypeError(`Invalid bundled content table '${tableName}'.`)
        }
        if (!tableCache.has(tableName)) {
            const filePath = path.join(process.cwd(), "assets", tableName)
            tableCache.set(tableName, JSON.parse(fs.readFileSync(filePath, "utf8")))
        }
        return tableCache.get(tableName) as T
    },
})

export interface ContentSnapshot {
    readonly cdn?: unknown
    readonly repository: ReadonlyContentRepository
}

const bundledSnapshot: ContentSnapshot = Object.freeze({
    repository: bundledRepository,
})

export const productionContentSnapshotProvider: {
    snapshot: ContentSnapshot
} = {
    snapshot: bundledSnapshot,
}

export async function initializeContentSnapshot(): Promise<ContentSnapshot> {
    return productionContentSnapshotProvider.snapshot
}

export function getContentSnapshot(): ContentSnapshot {
    return productionContentSnapshotProvider.snapshot
}
