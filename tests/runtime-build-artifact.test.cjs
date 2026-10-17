'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { test, after } = require('node:test')
const { buildRuntimeArtifact } = require('../tools/build-runtime-artifact.cjs')
const { checkOutArtifacts } = require('../tools/check-out-artifacts.cjs')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-build-tests-'))
const repoRoot = path.resolve(__dirname, '..')
const dependencySource = process.env.STARPOINT_TEST_DEPENDENCY_ROOT || repoRoot
const tsSource = path.join(dependencySource, 'node_modules/typescript')
const tsLocked = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')).packages['node_modules/typescript']
const pkg = { name: 'runtime-fixture', version: '1.0.0', devDependencies: { typescript: tsLocked.version } }
const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': pkg, 'node_modules/typescript': tsLocked } }
const lockBytes = `${JSON.stringify(lock)}\n`
const dependencyRoot = path.join(root, 'dependencies')
fs.mkdirSync(path.join(dependencyRoot, 'node_modules'), { recursive: true })
fs.cpSync(tsSource, path.join(dependencyRoot, 'node_modules/typescript'), { recursive: true })
fs.writeFileSync(path.join(dependencyRoot, 'package-lock.json'), lockBytes)
fs.writeFileSync(path.join(dependencyRoot, 'node_modules/.package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/typescript': tsLocked } }))
after(() => fs.rmSync(root, { recursive: true, force: true }))

let sequence = 0
function fixture() {
    const repo = path.join(root, `repo-${++sequence}`)
    fs.mkdirSync(repo)
    const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    const write = (name, bytes) => { const filename = path.join(repo, name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes) }
    git(['init', '-q'])
    git(['config', 'user.name', 'Runtime Fixture'])
    git(['config', 'user.email', 'runtime-fixture@example.invalid'])
    write('.gitignore', 'out/\nsrc/hidden.ts\n')
    write('package.json', JSON.stringify(pkg))
    write('package-lock.json', lockBytes)
    write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'es2020', module: 'commonjs', strict: true, rootDir: 'src', outDir: 'out', resolveJsonModule: true, esModuleInterop: true, incremental: true }, include: ['src/**/*.ts'] }))
    write('tools/runtime-build-policy.json', JSON.stringify({ schema: 1, output_dir: 'out', toolchain: { node: '24.19.0', npm: '11.17.0', typescript: '5.4.5' }, required_outputs: ['out/runtime.js', 'out/worker.js'] }))
    write('src/runtime.ts', 'export const value = 1\n')
    write('src/worker.ts', 'export const worker = true\n')
    git(['add', '.gitignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'tools/runtime-build-policy.json', 'src/runtime.ts', 'src/worker.ts'])
    git(['commit', '-qm', 'fixture'])
    const source = git(['rev-parse', 'HEAD'])
    const output = path.join(root, `output-${sequence}`)
    return { repo, git, write, source, output, build: extra => buildRuntimeArtifact({ repo, source, output, dependencyRoot, ...extra }), check: extra => checkOutArtifacts({ repo, dependencyRoot, ...extra }) }
}

test('fixed commit ignores dirty source and poisoned historical output; CLI emits only identity JSON', () => {
    const f = fixture()
    f.write('src/runtime.ts', 'invalid syntax !\n')
    f.write('out/runtime.js', 'poisoned historical runtime')
    const built = f.build()
    assert.equal(built.source_commit, f.source)
    assert.equal(built.dependency_source, 'trusted-local-install')
    assert.equal(built.root_dir, 'src')
    assert.deepEqual(built.files, ['out/runtime.js', 'out/worker.js'])
    assert.match(fs.readFileSync(path.join(f.output, 'out/runtime.js'), 'utf8'), /value = 1/)
    const cli = spawnSync(process.execPath, [path.join(repoRoot, 'tools/build-runtime-artifact.cjs'), '--repo', f.repo, '--source', f.source, '--output', path.join(root, 'cli-output'), '--dependency-root', dependencyRoot], { encoding: 'utf8' })
    assert.equal(cli.status, 0, cli.stderr)
    assert.equal(JSON.parse(cli.stdout).source_commit, f.source)
})

test('index compilation ignores an unstaged repair of staged invalid code', () => {
    const f = fixture()
    f.write('src/runtime.ts', 'export const value: number = "broken"\n')
    f.git(['add', 'src/runtime.ts'])
    f.write('src/runtime.ts', 'export const value = 2\n')
    assert.throws(() => f.check(), /TS2322/)
    assert.equal(f.check({ worktree: true }).mode, 'worktree')
})

test('index compilation ignores an unstaged broken edit of valid staged code', () => {
    const f = fixture()
    f.write('src/runtime.ts', 'export const value = 2\n')
    f.git(['add', 'src/runtime.ts'])
    f.write('src/runtime.ts', 'export const value: number = "broken"\n')
    assert.equal(f.check().skipped, false)
})

test('ignored and untracked dependencies cannot make a staged import pass', () => {
    const f = fixture()
    f.write('src/hidden.ts', 'export const hidden = 1\n')
    f.write('src/runtime.ts', 'import { hidden } from "./hidden"; export const value = hidden\n')
    f.git(['add', 'src/runtime.ts'])
    assert.throws(() => f.check(), /TS2307/)
    f.write('src/new.ts', 'export const fresh = 1\n')
    f.write('src/runtime.ts', 'import { fresh } from "./new"; export const value = fresh\n')
    f.git(['add', 'src/runtime.ts'])
    assert.throws(() => f.check(), /TS2307/)
    f.git(['add', 'src/new.ts'])
    assert.equal(f.check().files.includes('out/new.js'), true)
})

test('type declarations require no matching JS; JSON is inventoried from actual emit', () => {
    const f = fixture()
    f.write('src/types.d.ts', 'interface OnlyType { value: number }\n')
    f.write('src/payload.json', '{"value":3}\n')
    f.write('src/runtime.ts', 'import payload from "./payload.json"; export const value = payload.value\n')
    f.git(['add', 'src/types.d.ts', 'src/payload.json', 'src/runtime.ts'])
    const built = f.check()
    assert.equal(built.files.includes('out/types.d.js'), false)
    assert.equal(built.files.includes('out/payload.json'), true)
})

test('new or changed tracked outputs fail; removing all tracked outputs is legal', () => {
    const f = fixture()
    f.write('out/runtime.js', 'old generated bytes')
    f.git(['add', '-f', 'out/runtime.js'])
    assert.throws(() => f.check(), /prohibits tracked out/)
    f.git(['commit', '-qm', 'legacy-output'])
    f.write('out/runtime.js', 'changed generated bytes')
    f.git(['add', '-f', 'out/runtime.js'])
    assert.throws(() => f.check(), /prohibits tracked out/)
    f.git(['rm', '--cached', '-f', '--', 'out/runtime.js'])
    assert.equal(f.check().skipped, false)
})

test('compile error and missing worker leave no plausible complete output', () => {
    const f = fixture()
    f.write('src/runtime.ts', 'export const value: number = "broken"\n')
    f.git(['add', 'src/runtime.ts'])
    assert.throws(() => f.build({ inputMode: 'index' }), /TS2322/)
    assert.deepEqual(fs.readdirSync(f.output), [])
    f.write('src/runtime.ts', 'export const value = 2\n')
    f.git(['add', 'src/runtime.ts'])
    f.git(['rm', '--', 'src/worker.ts'])
    assert.throws(() => f.build({ inputMode: 'index' }), /Missing required runtime output: out\/worker.js/)
    assert.deepEqual(fs.readdirSync(f.output), [])
})

test('output escape and missing string require fail instead of shipping a partial runtime', () => {
    const f = fixture()
    f.write('tsconfig.json', JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: '../escaped' }, include: ['src/**/*.ts'] }))
    f.git(['add', 'tsconfig.json'])
    assert.throws(() => f.build({ inputMode: 'index' }), /output must remain inside out/)
    f.git(['restore', '--source=HEAD', '--staged', '--worktree', 'tsconfig.json'])
    f.write('src/runtime.ts', 'declare function require(name: string): unknown; export const value = require("./missing")\n')
    f.git(['add', 'src/runtime.ts'])
    assert.throws(() => f.build({ inputMode: 'index' }), /Missing relative runtime dependency/)
})

test('dependency override rejects mismatched original lock, installed lock and real TypeScript version', () => {
    const f = fixture()
    const badRoot = path.join(root, 'bad-dependencies')
    fs.cpSync(dependencyRoot, badRoot, { recursive: true })
    const build = () => f.build({ dependencyRoot: badRoot })
    fs.writeFileSync(path.join(badRoot, 'package-lock.json'), `${lockBytes} `)
    assert.throws(build, /lockfile does not match/)
    fs.writeFileSync(path.join(badRoot, 'package-lock.json'), lockBytes)
    fs.writeFileSync(path.join(badRoot, 'node_modules/.package-lock.json'), JSON.stringify({ packages: { 'node_modules/typescript': { ...tsLocked, version: '0.0.0' } } }))
    assert.throws(build, /Installed lock mismatch/)
    fs.writeFileSync(path.join(badRoot, 'node_modules/.package-lock.json'), JSON.stringify({ packages: { 'node_modules/typescript': tsLocked } }))
    fs.writeFileSync(path.join(badRoot, 'node_modules/typescript/lib/typescript.js'), 'module.exports = { version: "0.0.0" }\n')
    assert.throws(build, /TypeScript version/)
})

test('existing output content is rejected without deleting user files', () => {
    const f = fixture()
    fs.mkdirSync(f.output)
    fs.writeFileSync(path.join(f.output, 'keep.txt'), 'keep')
    assert.throws(() => f.build(), /must be empty/)
    assert.equal(fs.readFileSync(path.join(f.output, 'keep.txt'), 'utf8'), 'keep')
})

test('a dependency root with an unlisted package cannot satisfy hidden build imports', () => {
    const f = fixture()
    const extraRoot = path.join(root, 'extra-dependencies')
    fs.cpSync(dependencyRoot, extraRoot, { recursive: true })
    fs.mkdirSync(path.join(extraRoot, 'node_modules/unlisted'))
    fs.writeFileSync(path.join(extraRoot, 'node_modules/unlisted/index.d.ts'), 'export const secret: number\n')
    assert.throws(() => f.build({ dependencyRoot: extraRoot }), /Unlisted dependency entry/)
})

test('development worktree mode excludes a deleted optional module while index retains it', () => {
    const f = fixture()
    f.write('src/optional.ts', 'export const optional = 1\n')
    f.git(['add', 'src/optional.ts'])
    f.git(['commit', '-qm', 'optional-module'])
    fs.unlinkSync(path.join(f.repo, 'src/optional.ts'))
    assert.equal(f.check({ worktree: true }).files.includes('out/optional.js'), false)
    assert.equal(f.check({ all: true }).files.includes('out/optional.js'), true)
})

test('explicit generated character JSON is exported from staged input without widening docs access', () => {
    const f = fixture()
    f.write('docs/generated/character_table.json', '{"name":"committed"}\n')
    f.write('docs/private.json', '{"secret":true}\n')
    f.write('src/runtime.ts', 'import table from "../docs/generated/character_table.json"; export const value = table.name\n')
    f.git(['add', 'src/runtime.ts', 'docs/generated/character_table.json', 'docs/private.json'])
    assert.equal(f.check().files.includes('out/runtime.js'), true)
    f.git(['commit', '-qm', 'generated-character-json'])
    f.write('docs/generated/character_table.json', '{"name":"updated"}\n')
    f.git(['add', 'docs/generated/character_table.json'])
    f.write('docs/generated/character_table.json', 'invalid worktree JSON')
    assert.equal(f.check().skipped, false)
    f.write('src/runtime.ts', 'import table from "../docs/private.json"; export const value = table.secret\n')
    f.git(['add', 'src/runtime.ts'])
    assert.throws(() => f.check(), /TS2307/)
})

test('dependency override does not hide a source package manifest missing its lock update', () => {
    const f = fixture()
    f.write('package.json', JSON.stringify({ ...pkg, dependencies: { missing: '1.0.0' } }))
    f.git(['add', 'package.json'])
    assert.throws(() => f.check(), /Source package.json dependencies do not match/)
})

test('an absolute tsconfig root cannot read ambient declarations outside isolated inputs', () => {
    const f = fixture()
    const external = path.join(root, 'ambient-secret.d.ts')
    fs.writeFileSync(external, 'declare const enum AmbientValue { Number = 9 }\n')
    f.write('src/runtime.ts', 'export const value = AmbientValue.Number\n')
    f.write('tsconfig.json', JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'out' }, files: ['src/runtime.ts', 'src/worker.ts', external] }))
    f.git(['add', 'src/runtime.ts', 'tsconfig.json'])
    assert.throws(() => f.check(), /Compiler input escapes isolated/)
})
