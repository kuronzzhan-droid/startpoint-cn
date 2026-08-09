"use strict"

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const test = require("node:test")


const ROOT = path.join(__dirname, "..")
const SRC = path.join(ROOT, "src")
const OPTIONAL_OUTPUT = "./out/lib/mode15-optional.js"

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return sourceFiles(full)
        return entry.isFile() && entry.name.endsWith(".ts") ? [full] : []
    })
}

function probe(extraEnv) {
    const script = `
const mode = require(${JSON.stringify(OPTIONAL_OUTPUT)})
console.log(JSON.stringify({
  loaded: mode.isMode15RuntimeLoaded(),
  recognized: mode.isMode15Quest(9, 700098001),
  gate: mode.canStartMode15QuestSync(1, 9, 700098001),
}))
`
    const result = spawnSync(process.execPath, ["-e", script], {
        cwd: ROOT,
        env: { ...process.env, ...extraEnv },
        encoding: "utf8",
    })
    assert.equal(result.status, 0, result.stderr)
    const line = result.stdout.trim().split(/\r?\n/).at(-1)
    return JSON.parse(line)
}

test("production callers depend only on the optional facade", () => {
    const offenders = []
    for (const file of sourceFiles(SRC)) {
        if (file.endsWith(`${path.sep}lib${path.sep}mode15.ts`)) continue
        if (file.endsWith(`${path.sep}lib${path.sep}mode15-optional.ts`)) continue
        const source = fs.readFileSync(file, "utf8")
        if (/from\s+["'][^"']*\/mode15["']/.test(source)) {
            offenders.push(path.relative(ROOT, file))
        }
    }
    assert.deepEqual(offenders, [])
})

test("explicit disable leaves the generic server gate open", () => {
    const result = probe({
        MODE15_ENABLED: "0",
        MODE15_MODULE_PATH: "",
    })
    assert.equal(result.loaded, false)
    assert.equal(result.recognized, false)
    assert.deepEqual(result.gate, {
        allowed: true,
        stage: null,
        expectedStage: 1,
    })
})

test("a missing optional module does not prevent startup", () => {
    const result = probe({
        MODE15_ENABLED: "1",
        MODE15_MODULE_PATH: "modules/not-installed-mode15.cjs",
    })
    assert.equal(result.loaded, false)
    assert.equal(result.recognized, false)
})
