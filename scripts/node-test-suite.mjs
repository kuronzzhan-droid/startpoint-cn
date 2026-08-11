import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { basename, join, relative, resolve } from "node:path"

// The pass-mission collector intentionally rebuilds a large dependency graph
// many times and takes about 140 seconds on the supported Windows baseline.
const DEFAULT_TOOL_TEST_TIMEOUT_MS = 300_000

function collectRecursive(root, suffix) {
    if (!existsSync(root)) return []
    return readdirSync(root, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
        .map(entry => resolve(entry.parentPath ?? entry.path, entry.name))
        .sort()
}

function collectTopLevel(root, suffix) {
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
        .map(entry => resolve(root, entry.name))
        .sort()
}

export function collectNodeTestSuite(repositoryRoot) {
    const root = resolve(repositoryRoot)
    const compiledTests = collectRecursive(join(root, "out", "tests"), ".test.js")
    const runnerTests = collectTopLevel(join(root, "scripts", "tests"), ".test.mjs")
    const toolTests = collectStandaloneToolTests(root)
    const nodeTests = [...compiledTests, ...runnerTests]

    if (compiledTests.length === 0) {
        throw new Error(`No compiled test files under ${join(root, "out", "tests")}; run build:server first`)
    }
    if (toolTests.length === 0) {
        throw new Error(`No standalone tool tests under ${join(root, "tools")}`)
    }

    return { nodeTests, toolTests }
}

export function collectStandaloneToolTests(repositoryRoot) {
    return collectTopLevel(join(resolve(repositoryRoot), "tools"), ".test.cjs")
}

function runNode(repositoryRoot, args, stdio, label, options = {}) {
    const result = spawnSync(process.execPath, args, {
        cwd: repositoryRoot,
        env: options.env ?? process.env,
        stdio,
        timeout: options.timeout,
    })
    if (result.error?.code === "ETIMEDOUT") {
        throw new Error(`${label} timed out after ${options.timeout}ms`, { cause: result.error })
    }
    if (result.error) throw result.error
    if (result.status !== 0) {
        throw new Error(`${label} failed with status ${result.status ?? "unknown"}`)
    }
}

export function runNodeTestSuite(repositoryRoot, options = {}) {
    const root = resolve(repositoryRoot)
    const stdio = options.stdio ?? "inherit"
    const toolTestTimeoutMs = options.toolTestTimeoutMs ?? DEFAULT_TOOL_TEST_TIMEOUT_MS
    if (!Number.isSafeInteger(toolTestTimeoutMs) || toolTestTimeoutMs <= 0) {
        throw new RangeError("toolTestTimeoutMs must be a positive safe integer")
    }
    const { nodeTests, toolTests } = collectNodeTestSuite(root)

    runNode(root, ["--test", ...nodeTests], stdio, "node:test suite")
    for (const testFile of toolTests) {
        const databaseRoot = mkdtempSync(join(tmpdir(), "starpoint-tool-test-"))
        try {
            runNode(root, [testFile], stdio, relative(root, testFile) || basename(testFile), {
                env: {
                    ...process.env,
                    TS_NODE_TRANSPILE_ONLY: "1",
                    WF_DATABASE_DIR: databaseRoot,
                },
                timeout: toolTestTimeoutMs,
            })
        } finally {
            rmSync(databaseRoot, { recursive: true, force: true })
        }
    }

    return {
        nodeTestCount: nodeTests.length,
        toolTestCount: toolTests.length,
    }
}
