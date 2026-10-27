'use strict'
// Candidate-only compiler and test mirror. Never reads or writes a player DB in
// the source worktree, and never replaces its existing out/ artifacts.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const candidate = path.join(root, 'p2-server-candidate')
const runtime = path.join(candidate, 'runtime')
const group = process.env.RIVEN_P2_CHECK_GROUP || ''
if (group && !/^[A-Za-z0-9_-]+$/.test(group)) throw Error('Invalid RIVEN_P2_CHECK_GROUP')
const logs = path.join(candidate, 'test-logs', group)
const args = process.argv.slice(2)
const regressions = [
    'multi-business-facts', 'client-admission-tcp', 'multi-owner-admission-lease',
    'multi-lobby-battle-handoff', 'multi-battle-command-boundary', 'multi-lobby-owner-http',
    'five-boss-owner-command', 'five-boss-owner-http', 'multi-battle-sim',
    'multi-lobby-autostart-contract', 'multi-owner-start-barriers',
    'multi-realtime-owner-process', 'multi-realtime-return-process', 'multi-ai-fallback-roster',
].map(name => `tests/${name}.test.cjs`)
regressions.push('tests/wiki-team-code-route.test.cjs', 'tests/npc-party-pool-selection.test.cjs',
    'tests/quest-recommended-party.test.js', 'tests/npc-party-snapshot.test.cjs')

function copyTree(name) {
    if (fs.existsSync(path.join(runtime, name))) return
    fs.cpSync(path.join(root, name), path.join(runtime, name), { recursive: true,
        filter: source => !fs.lstatSync(source).isSymbolicLink() })
}
function prepare() {
    fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(logs, { recursive: true })
    for (const name of ['src', 'tests', 'tools', 'data', 'assets/cdndata', 'assets/asset_lists', 'docs/generated']) copyTree(name)
    if (fs.existsSync(path.join(root, 'assets/weapon-riven-multi-resources'))) copyTree('assets/weapon-riven-multi-resources')
    for (const name of ['tsconfig.json', 'package.json'])
        if (!fs.existsSync(path.join(runtime, name))) fs.copyFileSync(path.join(root, name), path.join(runtime, name))
    fs.mkdirSync(path.join(runtime, 'assets'), { recursive: true })
    // Server tables and fixture imports are root-level JSON; no CDN/APK media,
    // local admission keys, .env files, or .database are copied.
    for (const name of fs.readdirSync(path.join(root, 'assets')))
        if (name.endsWith('.json') && fs.statSync(path.join(root, 'assets', name)).isFile())
            if (!fs.existsSync(path.join(runtime, 'assets', name))) fs.copyFileSync(path.join(root, 'assets', name), path.join(runtime, 'assets', name))
    fs.mkdirSync(path.join(runtime, 'tmp'), { recursive: true })
}
function environment(directory) {
    const env = { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory,
        DATA_DIR: path.join(directory, 'database'), GACHA_SEED_DIR: path.join(directory, 'seeds'),
        STARPOINT_TEST_OUT_DIR: path.join(runtime, 'out'), LENS_BUILD_OUT: path.join(runtime, 'out'),
        TS_NODE_PROJECT: path.join(runtime, 'tsconfig.json'), PROCESS_MEMORY_DIAGNOSTICS: 'false',
        npm_config_cache: path.join(candidate, 'npm-cache') }
    for (const key of ['CN_LOAD_CAPTURE_PATH', 'PERF_STATE_OUTPUT', 'TEST_SERVER_TEMPLATE_PATH',
        'TEST_SERVER_SHARED_PASSWORD', 'TEST_SERVER_TEMPLATE_SAVE', 'MULTI_REALTIME_OWNER_CHILD', 'MULTI_REALTIME_PROCESS']) delete env[key]
    return env
}
async function run(label, argv, directory) {
    const log = path.join(logs, `${label}.log`), stream = fs.createWriteStream(log)
    const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, argv, { cwd: runtime, env: environment(directory), stdio: ['ignore', 'pipe', 'pipe'] })
        child.stdout.on('data', data => stream.write(data)); child.stderr.on('data', data => stream.write(data))
        child.once('error', reject); child.once('exit', code => resolve(code ?? 1))
    })
    await new Promise(resolve => stream.end(resolve))
    console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${label}: ${log}`)
    return { label, code, log }
}
async function main() {
    prepare()
    const directory = fs.mkdtempSync(path.join(runtime, 'tmp', 'riven-p2-'))
    const results = []
    if (args.includes('--typecheck')) results.push(await run('typecheck',
        [require.resolve('typescript/bin/tsc'), '--project', path.join(runtime, 'tsconfig.json'), '--noEmit'], directory))
    if (args.includes('--compile')) results.push(await run('compile',
        [require.resolve('typescript/bin/tsc'), '--project', path.join(runtime, 'tsconfig.json'),
            '--outDir', path.join(runtime, 'out'), '--tsBuildInfoFile', path.join(candidate, 'tsconfig.tsbuildinfo')], directory))
    if (results.some(result => result.code)) {
        fs.writeFileSync(path.join(candidate, group ? `check-results-${group}.json` : 'check-results.json'), JSON.stringify({ runtime, at: new Date().toISOString(), results }, null, 2))
        process.exitCode = 1; return
    }
    const files = args.includes('--suite')
        ? [...fs.readdirSync(path.join(runtime, 'tests')).filter(name => /^weapon-riven.*\.test\.cjs$/.test(name)).map(name => `tests/${name}`), ...regressions]
        : args.filter(argument => !argument.startsWith('--'))
    for (const file of [...new Set(files)]) {
        if (!/^tests\/[a-zA-Z0-9_.-]+\.test\.(cjs|js)$/.test(file)) throw Error(`Unsupported test path: ${file}`)
        const testDirectory = fs.mkdtempSync(path.join(directory, 'case-'))
        results.push(await run(path.basename(file), ['--test', file], testDirectory))
    }
    fs.writeFileSync(path.join(candidate, group ? `check-results-${group}.json` : 'check-results.json'), JSON.stringify({ runtime, at: new Date().toISOString(), results }, null, 2))
    if (results.some(result => result.code)) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
