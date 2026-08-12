import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
    collectNodeTestSuite,
    collectStandaloneToolTests,
    runNodeTestSuite,
} from "../node-test-suite.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

function createFixture() {
    const root = mkdtempSync(join(tmpdir(), "starpoint-node-suite-"))
    mkdirSync(join(root, "out", "tests", "nested"), { recursive: true })
    mkdirSync(join(root, "scripts", "tests"), { recursive: true })
    mkdirSync(join(root, "tools"), { recursive: true })
    return root
}

function write(root, relativePath, source) {
    const target = join(root, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, source, "utf8")
}

test("collects compiled, runner, and standalone tool tests in stable order", () => {
    const root = createFixture()
    try {
        write(root, "out/tests/z.test.js", "")
        write(root, "out/tests/nested/a.test.js", "")
        write(root, "out/tests/not-a-test.js", "")
        write(root, "scripts/tests/runner.test.mjs", "")
        write(root, "tools/zeta.test.cjs", "")
        write(root, "tools/alpha.test.cjs", "")
        write(root, "tools/nested.test.cjs.disabled", "")

        const suite = collectNodeTestSuite(root)
        assert.deepEqual(
            suite.nodeTests.map(path => path.slice(root.length + 1).replaceAll("\\", "/")),
            [
                "out/tests/nested/a.test.js",
                "out/tests/z.test.js",
                "scripts/tests/runner.test.mjs",
            ],
        )
        assert.deepEqual(
            suite.toolTests.map(path => path.slice(root.length + 1).replaceAll("\\", "/")),
            ["tools/alpha.test.cjs", "tools/zeta.test.cjs"],
        )
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("actual inventory includes every top-level tools test", () => {
    const expected = readdirSync(join(repositoryRoot, "tools"), { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith(".test.cjs"))
        .map(entry => entry.name)
        .sort()
    const actual = collectStandaloneToolTests(repositoryRoot)
        .map(path => path.slice(join(repositoryRoot, "tools").length + 1))

    assert.equal(expected.length, 50)
    assert.deepEqual(actual, expected)
})

test("runs standalone tool tests and fails closed on a broken canary", () => {
    const root = createFixture()
    try {
        write(root, "out/tests/compiled.test.js", [
            "const test = require('node:test')",
            "test('compiled canary', () => {})",
        ].join("\n"))
        write(root, "scripts/tests/runner.test.mjs", [
            "import test from 'node:test'",
            "test('runner canary', () => {})",
        ].join("\n"))
        write(root, "tools/01-pass.test.cjs", "console.log('tool canary passed')\n")
        write(root, "tools/02-fail.test.cjs", "throw new Error('tool canary failed')\n")

        assert.throws(
            () => runNodeTestSuite(root, { stdio: "pipe" }),
            error => error instanceof Error
                && /02-fail\.test\.cjs/.test(error.message)
                && /status 1/.test(error.message),
        )
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("reports exact counts after all groups pass", () => {
    const root = createFixture()
    try {
        write(root, "out/tests/compiled.test.js", [
            "const test = require('node:test')",
            "test('compiled canary', () => {})",
        ].join("\n"))
        write(root, "scripts/tests/runner.test.mjs", [
            "import test from 'node:test'",
            "test('runner canary', () => {})",
        ].join("\n"))
        write(root, "tools/01-pass.test.cjs", "")
        write(root, "tools/02-pass.test.cjs", "")

        assert.deepEqual(
            runNodeTestSuite(root, { stdio: "pipe" }),
            { nodeTestCount: 2, toolTestCount: 2 },
        )
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("isolates every standalone tool database root and removes it after execution", () => {
    const root = createFixture()
    try {
        write(root, "out/tests/compiled.test.js", "")
        write(root, "tools/01-capture.test.cjs", [
            "const fs = require('node:fs')",
            "const path = require('node:path')",
            "if (!process.env.WF_DATABASE_DIR) throw new Error('missing isolated database root')",
            "if (process.env.TS_NODE_TRANSPILE_ONLY !== '1') throw new Error('missing transpile-only runtime')",
            "fs.writeFileSync(path.join(__dirname, '01-root.txt'), process.env.WF_DATABASE_DIR)",
            "fs.writeFileSync(path.join(process.env.WF_DATABASE_DIR, 'sentinel'), 'owned')",
        ].join("\n"))
        write(root, "tools/02-capture.test.cjs", [
            "const fs = require('node:fs')",
            "const path = require('node:path')",
            "if (!process.env.WF_DATABASE_DIR) throw new Error('missing isolated database root')",
            "if (process.env.TS_NODE_TRANSPILE_ONLY !== '1') throw new Error('missing transpile-only runtime')",
            "fs.writeFileSync(path.join(__dirname, '02-root.txt'), process.env.WF_DATABASE_DIR)",
        ].join("\n"))

        runNodeTestSuite(root, { stdio: "pipe" })

        const first = readFileSync(join(root, "tools", "01-root.txt"), "utf8")
        const second = readFileSync(join(root, "tools", "02-root.txt"), "utf8")
        assert.notEqual(first, second)
        assert.equal(existsSync(first), false)
        assert.equal(existsSync(second), false)
        assert.equal(existsSync(join(root, ".database")), false)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("fails closed when a standalone tool exceeds its execution limit", () => {
    const root = createFixture()
    try {
        write(root, "out/tests/compiled.test.js", "")
        write(root, "tools/hang.test.cjs", "setInterval(() => {}, 1_000)\n")

        assert.throws(
            () => runNodeTestSuite(root, { stdio: "pipe", toolTestTimeoutMs: 50 }),
            error => error instanceof Error
                && /hang\.test\.cjs/.test(error.message)
                && /timed out/.test(error.message),
        )
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
