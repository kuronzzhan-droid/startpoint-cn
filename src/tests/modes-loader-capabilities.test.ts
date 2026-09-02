import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { loadModes } from "../modes/loader"
import {
    listModeCapabilities,
    resetModesForTest,
} from "../modes/registry"

interface FixtureOptions {
    readonly requiredCapability: string
    readonly requiredFile?: boolean
}

function buildFixture(options: FixtureOptions): {
    readonly directory: string
    readonly source: string
} {
    const directory = mkdtempSync(path.join(tmpdir(), "wf-mode-capability-"))
    const source = "// loader test fixture\n"
    writeFileSync(path.join(directory, "fixture.mjs"), source)
    writeFileSync(path.join(directory, "modes-allowlist.json"), JSON.stringify({
        "fixture.mjs": createHash("sha256").update(source).digest("hex"),
    }))
    if (options.requiredFile !== false) {
        writeFileSync(path.join(directory, "modes-required.json"), JSON.stringify({
            schemaVersion: 1,
            required: ["fixture.mjs"],
        }))
    }
    return { directory, source }
}

test("required mode is rejected before register when a server capability is missing", async t => {
    resetModesForTest()
    t.after(resetModesForTest)
    const fixture = buildFixture({ requiredCapability: "missing.runtime@1" })
    t.after(() => rmSync(fixture.directory, { recursive: true, force: true }))
    let registerCalls = 0

    await assert.rejects(
        loadModes({
            projectRoot: "C:\\not-used",
            env: { MODES_DIR: fixture.directory },
            log: () => {},
            importModule: async () => ({
                modeManifest: {
                    apiVersion: 1,
                    name: "fixture-mode",
                    capability: "fixture.mode@1",
                    requiresServerCapabilities: ["missing.runtime@1"],
                },
                register: () => {
                    registerCalls += 1
                    return {}
                },
            }),
        }),
        error => {
            assert.match(String(error), /MODE_SERVER_CAPABILITY_MISSING/)
            assert.match(String(error), /missing\.runtime@1/)
            return true
        },
    )

    assert.equal(registerCalls, 0)
    assert.deepEqual(listModeCapabilities(), [])
})

test("five-boss module loads when its multiplayer runtime capability is present", async t => {
    resetModesForTest()
    t.after(resetModesForTest)
    const fixture = buildFixture({
        requiredCapability: "five-boss.multiplayer-runtime@1",
    })
    t.after(() => rmSync(fixture.directory, { recursive: true, force: true }))
    let registerCalls = 0

    const loaded = await loadModes({
        projectRoot: "C:\\not-used",
        env: { MODES_DIR: fixture.directory },
        log: () => {},
        importModule: async () => ({
            modeManifest: {
                apiVersion: 1,
                name: "fixture-mode",
                capability: "fixture.mode@1",
                requiresServerCapabilities: ["five-boss.multiplayer-runtime@1"],
            },
            register: () => {
                registerCalls += 1
                return {}
            },
        }),
    })

    assert.deepEqual(loaded, ["fixture-mode"])
    assert.equal(registerCalls, 1)
    assert.deepEqual(listModeCapabilities(), ["fixture.mode@1"])
})
