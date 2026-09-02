import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { loadModesBeforeListen } from "../modes/boot"
import { resetModesForTest } from "../modes/registry"

async function fixture(requiredCapability: string): Promise<string> {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "wf-mode-boot-"))
    const modesDir = path.join(projectRoot, "modes.d")
    await mkdir(modesDir)
    const moduleName = "required-mode.mjs"
    const source = Buffer.from(`
export const modeManifest = {
  apiVersion: 1,
  name: "required-mode",
  capability: "required-mode.identity@1",
  requiresServerCapabilities: [${JSON.stringify(requiredCapability)}],
}
export function register() { return {} }
`)
    await writeFile(path.join(modesDir, moduleName), source)
    await writeFile(
        path.join(modesDir, "modes-allowlist.json"),
        JSON.stringify({
            [moduleName]: createHash("sha256").update(source).digest("hex"),
        }),
    )
    await writeFile(
        path.join(modesDir, "modes-required.json"),
        JSON.stringify({ schemaVersion: 1, required: [moduleName] }),
    )
    return projectRoot
}

test("server boot refuses to listen when a required mode lacks a server capability", async t => {
    resetModesForTest()
    const projectRoot = await fixture("missing-runtime@1")
    t.after(async () => {
        resetModesForTest()
        await rm(projectRoot, { recursive: true, force: true })
    })
    let listened = false

    await assert.rejects(
        loadModesBeforeListen({
            projectRoot,
            listen: async () => { listened = true },
            log: () => undefined,
        }),
        /MODE_SERVER_CAPABILITY_MISSING.*missing-runtime@1/s,
    )
    assert.equal(listened, false)
})

test("server boot starts listening only after a required mode has loaded", async t => {
    resetModesForTest()
    const projectRoot = await fixture("five-boss.multiplayer-runtime@1")
    t.after(async () => {
        resetModesForTest()
        await rm(projectRoot, { recursive: true, force: true })
    })
    const events: string[] = []

    const loaded = await loadModesBeforeListen({
        projectRoot,
        listen: async () => { events.push("listen") },
        log: message => {
            if (message.startsWith("[modes] loaded")) events.push("loaded")
        },
    })

    assert.deepEqual(loaded, ["required-mode"])
    assert.deepEqual(events, ["loaded", "listen"])
})
