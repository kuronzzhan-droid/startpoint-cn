// Run the multiplayer connectivity suite with all disposable state in this repository.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const parent = path.join(root, 'tmp')
const files = [
    'tests/client-admission-tcp.test.cjs',
    'tests/client-admission-lifecycle.test.cjs',
    'tests/client-admission.test.cjs',
    'tests/multi-barrier-recovery.test.js',
    'tests/multi-active-quest-recovery.test.js',
    'tests/active-quest-conditional-delete.test.cjs',
    'tests/tcp-disconnect-diagnostics.test.cjs',
    'tests/multi-battle-telemetry.test.cjs',
    'tests/multi-battle-sim.test.cjs',
    'tests/multi-battle-relay-process.test.cjs',
    'tests/multi-room-admission.test.js',
    'tests/multi-guest-eligibility.test.js',
    'tests/multi-room-disband-protocol.test.js',
    'tests/multi-equipment-entry-dialog.test.js',
    'tests/multi-equipment-ready-http.test.cjs',
    'tests/finish-settlement-idempotency.test.cjs',
    'tests/c2330-party-edit-guard.test.cjs',
    'tests/fantasy-equipment-party-gate.test.cjs',
    'tests/online-presence-tcp.test.cjs',
    'tests/five-boss-connection-diagnostic.test.js',
    'tests/five-boss-integration.test.js',
    'tools/mode15_persistent_completion.test.cjs',
    'tests/mode15-disconnect-load-recovery.test.cjs',
    'tests/tcp-server-lifecycle.test.cjs',
    'tests/lounge-tcp-hardening.test.cjs',
    'tools/lounge_recovery_protocol.test.cjs',
    'tools/lounge_room_lifecycle.test.cjs',
    'tools/multi_chain_reliable_send.test.cjs',
    'tools/multi_room_connection_generation.test.cjs',
    'tools/multi_host_reconnect_roster.test.cjs',
    'tools/multi_room_identity.test.cjs',
    'tools/multi_room_lifecycle_coordinator.test.cjs',
    'tools/multi_battle_relay_snapshot.test.cjs',
    'tools/multi_settlement_lifecycle.test.cjs',
    'tools/multi_tcp_guardrails.test.cjs',
]

let child = null
let directory = null
let interruptedSignal = null

function cleanupDirectory() {
    if (!directory) return
    fs.rmSync(directory, { recursive: true, force: true })
    directory = null
}

function cleanup() {
    cleanupDirectory()
    try { fs.rmdirSync(parent) } catch {}
    console.log('[check] temporary state removed')
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        interruptedSignal = signal
        if (!child) return
        try {
            if (process.platform === 'win32') child.kill(signal)
            else process.kill(-child.pid, signal)
        } catch {}
    })
}

async function run(file) {
    directory = fs.mkdtempSync(path.join(parent, 'multiplayer-check-'))
    const environment = {
        ...process.env,
        TMPDIR: directory,
        TMP: directory,
        TEMP: directory,
        DATA_DIR: path.join(directory, 'database'),
        GACHA_SEED_DIR: path.join(directory, 'seeds'),
        npm_config_cache: path.join(directory, 'npm-cache'),
        PROCESS_MEMORY_DIAGNOSTICS: 'false',
    }
    const code = await new Promise((resolve, reject) => {
        child = spawn(process.execPath, ['--test', file], {
            cwd: root,
            stdio: 'inherit',
            env: environment,
            detached: process.platform !== 'win32',
        })
        child.once('error', reject)
        child.once('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)))
    })
    child = null
    cleanupDirectory()
    return code
}

async function main() {
    fs.mkdirSync(parent, { recursive: true })
    try {
        for (const file of files) {
            const code = await run(file)
            if (interruptedSignal) {
                process.exitCode = interruptedSignal === 'SIGINT' ? 130 : 143
                return
            }
            if (code !== 0) {
                process.exitCode = code
                return
            }
        }
    } catch (error) {
        console.error(error)
        process.exitCode = 1
    } finally {
        cleanup()
    }
}

void main()
