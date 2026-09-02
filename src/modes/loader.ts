import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { createModeHost } from "./host"
import {
    isModeManifest,
    listModeCapabilities,
    MODE_SERVER_CAPABILITIES,
    registerMode,
    runModeRegistrationTransaction,
    type ModeHooks,
    type ModeManifest,
} from "./registry"

export interface LoadModesOptions {
    readonly projectRoot: string
    readonly env?: NodeJS.ProcessEnv
    readonly log?: (message: string) => void
    readonly importModule?: (url: string) => Promise<unknown>
}

type ModeFailureCode =
    | "MODE_NOT_ALLOWLISTED"
    | "MODE_HASH_MISMATCH"
    | "MODE_IMPORT_FAILED"
    | "MODE_MANIFEST_INVALID"
    | "MODE_SERVER_CAPABILITY_MISSING"
    | "MODE_REGISTER_EXPORT_MISSING"
    | "MODE_REGISTER_FAILED"
    | "MODE_FILE_MISSING"

interface ModeLoadSuccess {
    readonly ok: true
    readonly fileName: string
    readonly modeName: string
}

interface ModeLoadFailure {
    readonly ok: false
    readonly fileName: string
    readonly code: ModeFailureCode
    readonly detail: string
}

type ModeLoadOutcome = ModeLoadSuccess | ModeLoadFailure

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function failed(
    fileName: string,
    code: ModeFailureCode,
    detail: string,
): ModeLoadFailure {
    return { ok: false, fileName, code, detail }
}

function compareCodePoints(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0
}

function isModeFileName(value: unknown): value is string {
    return typeof value === "string" && /^[a-zA-Z0-9._-]+\.mjs$/.test(value)
}

async function readRequiredFiles(modesDir: string): Promise<readonly string[]> {
    const file = path.join(modesDir, "modes-required.json")
    let raw: string
    try {
        raw = await fs.readFile(file, "utf8")
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
        throw error
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new Error("[MODE_REQUIRED_CONFIG_INVALID] modes-required.json: invalid JSON")
    }
    if (!isRecord(parsed)
        || parsed.schemaVersion !== 1
        || !Array.isArray(parsed.required)
        || Object.keys(parsed).some(key => key !== "schemaVersion" && key !== "required")) {
        throw new Error("[MODE_REQUIRED_CONFIG_INVALID] modes-required.json: invalid schema")
    }
    if (!parsed.required.every(isModeFileName)) {
        throw new Error("[MODE_REQUIRED_CONFIG_INVALID] modes-required.json: invalid file name")
    }
    const required = parsed.required as string[]
    if (new Set(required).size !== required.length) {
        throw new Error("[MODE_REQUIRED_CONFIG_INVALID] modes-required.json: duplicate file")
    }
    return Object.freeze([...required].sort(compareCodePoints))
}

function immutableManifest(value: unknown): ModeManifest | null {
    if (!isModeManifest(value)) return null
    return Object.freeze({
        apiVersion: value.apiVersion,
        name: value.name,
        capability: value.capability,
        ...(value.capabilities === undefined
            ? {}
            : { capabilities: Object.freeze([...value.capabilities]) }),
        ...(value.requiresServerCapabilities === undefined
            ? {}
            : {
                requiresServerCapabilities: Object.freeze([
                    ...value.requiresServerCapabilities,
                ]),
            }),
    })
}

function missingCapabilities(manifest: ModeManifest): readonly string[] {
    const available = new Set<string>(MODE_SERVER_CAPABILITIES)
    return (manifest.requiresServerCapabilities ?? []).filter(
        capability => !available.has(capability),
    )
}

async function tryLoadMode(options: {
    readonly modesDir: string
    readonly fileName: string
    readonly allowlist: Readonly<Record<string, unknown>>
    readonly importModule: (url: string) => Promise<unknown>
    readonly log: (message: string) => void
}): Promise<ModeLoadOutcome> {
    const expected = options.allowlist[options.fileName]
    if (typeof expected !== "string" || !/^[0-9a-fA-F]{64}$/.test(expected)) {
        return failed(options.fileName, "MODE_NOT_ALLOWLISTED", "not allowlisted")
    }
    const absolute = path.join(options.modesDir, options.fileName)
    let content: Buffer
    try {
        content = await fs.readFile(absolute)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return failed(options.fileName, "MODE_FILE_MISSING", "module file is missing")
        }
        return failed(options.fileName, "MODE_IMPORT_FAILED", "module file is unreadable")
    }
    const digest = createHash("sha256").update(content).digest("hex")
    if (digest !== expected.toLowerCase()) {
        return failed(options.fileName, "MODE_HASH_MISMATCH", `file sha256=${digest}`)
    }

    let imported: unknown
    try {
        imported = await options.importModule(pathToFileURL(absolute).href)
    } catch (error) {
        return failed(
            options.fileName,
            "MODE_IMPORT_FAILED",
            (error as Error)?.message ?? String(error),
        )
    }
    const moduleExports = isRecord(imported) ? imported : {}
    const fromDefault = isRecord(moduleExports.default) ? moduleExports.default : {}
    const manifest = immutableManifest(
        moduleExports.modeManifest ?? fromDefault.modeManifest,
    )
    if (manifest === null) {
        return failed(options.fileName, "MODE_MANIFEST_INVALID", "invalid modeManifest export")
    }
    const missing = missingCapabilities(manifest)
    if (missing.length > 0) {
        return failed(
            options.fileName,
            "MODE_SERVER_CAPABILITY_MISSING",
            `missing server capabilities: ${missing.join(", ")}`,
        )
    }
    const register = fromDefault.register ?? moduleExports.register
    if (typeof register !== "function") {
        return failed(
            options.fileName,
            "MODE_REGISTER_EXPORT_MISSING",
            "register(host) export is missing",
        )
    }
    try {
        const hooks = (await register(createModeHost(options.log)) ?? {}) as ModeHooks
        registerMode(manifest, hooks, {
            fileName: options.fileName,
            name: manifest.name,
            capabilities: [manifest.capability, ...(manifest.capabilities ?? [])],
            sha256: digest,
        })
    } catch (error) {
        return failed(
            options.fileName,
            "MODE_REGISTER_FAILED",
            (error as Error)?.message ?? String(error),
        )
    }
    return { ok: true, fileName: options.fileName, modeName: manifest.name }
}

function throwRequiredFailures(
    requiredFiles: readonly string[],
    outcomes: ReadonlyMap<string, ModeLoadOutcome>,
): void {
    const failures: string[] = []
    for (const fileName of requiredFiles) {
        const outcome = outcomes.get(fileName)
        if (!outcome) {
            failures.push(`- ${fileName}: [MODE_FILE_MISSING] module file is missing`)
        } else if (!outcome.ok) {
            failures.push(`- ${fileName}: [${outcome.code}] ${outcome.detail}`)
        }
    }
    if (failures.length > 0) {
        throw new Error(["[modes] required modules failed:", ...failures].join("\n"))
    }
}

export async function loadModes(options: LoadModesOptions): Promise<readonly string[]> {
    const env = options.env ?? process.env
    const log = options.log ?? (message => console.log(message))
    const modesDir = env.MODES_DIR ?? path.join(options.projectRoot, "modes.d")
    const requiredFiles = await readRequiredFiles(modesDir)
    if (env.MODES_ENABLED === "0") {
        if (requiredFiles.length > 0) {
            throw new Error(
                "[MODE_REQUIRED_DISABLED] required modules cannot be disabled",
            )
        }
        log("[modes] disabled by MODES_ENABLED=0")
        return []
    }

    let entries: string[]
    try {
        entries = (await fs.readdir(modesDir))
            .filter(name => name.endsWith(".mjs"))
            .sort(compareCodePoints)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") entries = []
        else throw error
    }
    let allowlist: Record<string, unknown> = {}
    try {
        const parsed: unknown = JSON.parse(
            await fs.readFile(path.join(modesDir, "modes-allowlist.json"), "utf8"),
        )
        if (isRecord(parsed)) allowlist = parsed
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            log("[modes] allowlist is unreadable; no optional mode will load")
        }
    }
    const importModule = options.importModule
        ?? (new Function("url", "return import(url)") as (url: string) => Promise<unknown>)

    return runModeRegistrationTransaction(async () => {
        const outcomes = new Map<string, ModeLoadOutcome>()
        const loaded: string[] = []
        const requiredSet = new Set(requiredFiles)
        for (const fileName of entries) {
            const outcome = await tryLoadMode({
                modesDir,
                fileName,
                allowlist,
                importModule,
                log,
            })
            outcomes.set(fileName, outcome)
            if (outcome.ok) {
                loaded.push(outcome.modeName)
                log(`[modes] loaded ${outcome.modeName}`)
            } else if (!requiredSet.has(fileName)) {
                log(`[modes] SKIP ${fileName}: [${outcome.code}] ${outcome.detail}`)
            }
        }
        throwRequiredFailures(requiredFiles, outcomes)
        if (loaded.length > 0) {
            log(`[modes] capabilities: ${listModeCapabilities().join(", ")}`)
        }
        return Object.freeze(loaded)
    })
}
