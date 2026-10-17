#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const POLICY = 'tools/runtime-build-policy.json'
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const slash = value => value.split(path.sep).join('/')
function inside(root, filename) {
    const relative = path.relative(root, filename)
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
function safeName(name) {
    if (!name || name.includes('\\') || name.includes('\0') || path.posix.isAbsolute(name) || name.split('/').some(p => !p || p === '.' || p === '..') || /^[a-z]:/i.test(name)) throw new Error(`Unsafe path: ${name}`)
    return name
}
function selected(name) {
    return ['package.json', 'package-lock.json', 'tsconfig.json', POLICY, 'docs/generated/character_table.json'].includes(name) || /^src\/.*\.(?:tsx?|json)$/.test(name) || (/^assets\/.*\.json$/.test(name) && !name.startsWith('assets/asset-patch/'))
}
function git(repo, args, encoding = 'utf8') {
    return execFileSync('git', args, { cwd: repo, encoding, maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}
function inputEntries(repo, source, mode) {
    if (mode === 'worktree') {
        return [...new Set(git(repo, ['ls-files', '-c', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean))].filter(name => selected(name) && fs.existsSync(path.join(repo, name))).map(name => ({ name, worktree: true }))
    }
    const raw = mode === 'index' ? git(repo, ['ls-files', '--stage', '-z']) : git(repo, ['ls-tree', '-rz', '--full-tree', source])
    return raw.split('\0').filter(Boolean).map(row => {
        const [header, name] = row.split('\t')
        const fields = header.split(' ')
        if (!selected(name)) return null
        if (mode === 'index' && fields[2] !== '0') throw new Error(`Unmerged index entry: ${name}`)
        if (!['100644', '100755'].includes(fields[0])) throw new Error(`Build input must be a regular Git blob: ${name}`)
        return { name, oid: fields[mode === 'index' ? 1 : 2] }
    }).filter(Boolean)
}
function readBlobs(repo, entries) {
    const oids = [...new Set(entries.map(entry => entry.oid))]
    if (!oids.length) return new Map()
    if (oids.some(oid => !/^[a-f0-9]{40,64}$/.test(oid))) throw new Error('Invalid Git blob identity')
    const input = `${oids.join('\n')}\n`
    const sizes = execFileSync('git', ['cat-file', '--batch-check'], { cwd: repo, input, encoding: 'utf8', maxBuffer: oids.length * 128 + 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n').map((header, index) => {
        const [oid, type, size] = header.trim().split(' ')
        if (oid !== oids[index] || type !== 'blob' || !/^\d+$/.test(size)) throw new Error(`Cannot export Git blob: ${header}`)
        return Number(size)
    })
    const maximum = sizes.reduce((sum, size) => sum + size, 0) + oids.length * 128 + 1024
    if (maximum > 512 * 1024 * 1024) throw new Error('Isolated build inputs exceed the 512 MiB export limit')
    const bytes = execFileSync('git', ['cat-file', '--batch'], { cwd: repo, input, encoding: null, maxBuffer: maximum, stdio: ['pipe', 'pipe', 'pipe'] })
    const blobs = new Map()
    let offset = 0
    for (let index = 0; index < oids.length; index++) {
        const end = bytes.indexOf(10, offset)
        if (end < offset) throw new Error('Truncated Git batch header')
        const [oid, type, size] = bytes.subarray(offset, end).toString('ascii').split(' ')
        if (oid !== oids[index] || type !== 'blob' || Number(size) !== sizes[index]) throw new Error('Git batch blob identity mismatch')
        offset = end + 1
        const payloadEnd = offset + sizes[index]
        if (bytes[payloadEnd] !== 10) throw new Error('Truncated Git batch payload')
        blobs.set(oid, bytes.subarray(offset, payloadEnd))
        offset = payloadEnd + 1
    }
    if (offset !== bytes.length) throw new Error('Unexpected Git batch payload')
    return blobs
}
function npmVersion() {
    const cli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    return fs.existsSync(cli) ? execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim() : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim()
}
function npmCi(root) {
    const cli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev']
    const options = { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NODE_ENV: 'development' } }
    if (fs.existsSync(cli)) execFileSync(process.execPath, [cli, ...args], options)
    else execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { ...options, shell: process.platform === 'win32' })
}
function json(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8')) }
function validateDependencies(root, lockBytes, policy) {
    if (sha256(fs.readFileSync(path.join(root, 'package-lock.json'))) !== sha256(lockBytes)) throw new Error('Dependency root lockfile does not match source lockfile')
    const lock = JSON.parse(lockBytes.toString('utf8'))
    const installed = json(path.join(root, 'node_modules/.package-lock.json'))
    if (!lock.packages || !installed.packages) throw new Error('A package-lock v2/v3 installation is required')
    for (const [name, actual] of Object.entries(installed.packages)) {
        safeName(name)
        const expected = lock.packages[name]
        if (!expected || ['version', 'resolved', 'integrity'].some(key => expected[key] !== actual[key])) throw new Error(`Installed lock mismatch: ${name}`)
    }
    const inspectModules = (directory, prefix = 'node_modules') => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === '.bin' || entry.name === '.package-lock.json') continue
            const filename = path.join(directory, entry.name)
            if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Unlisted dependency entry: ${prefix}/${entry.name}`)
            if (entry.name.startsWith('@')) {
                for (const child of fs.readdirSync(filename, { withFileTypes: true })) inspectPackage(path.join(filename, child.name), `${prefix}/${entry.name}/${child.name}`, child)
            } else inspectPackage(filename, `${prefix}/${entry.name}`, entry)
        }
    }
    const inspectPackage = (filename, name, entry) => {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !installed.packages[name]) throw new Error(`Unlisted dependency entry: ${name}`)
        const nested = path.join(filename, 'node_modules')
        if (fs.existsSync(nested)) inspectModules(nested, `${name}/node_modules`)
    }
    inspectModules(path.join(root, 'node_modules'))
    for (const [name, expected] of Object.entries(lock.packages)) {
        if (!name) continue
        safeName(name)
        if (!name.startsWith('node_modules/') || expected.link) throw new Error(`Unsupported locked dependency: ${name}`)
        const metadata = path.join(root, name, 'package.json')
        if (!installed.packages[name] || !fs.existsSync(metadata)) {
            if (expected.optional && !installed.packages[name] && !fs.existsSync(metadata)) continue
            throw new Error(`Missing locked dependency: ${name}`)
        }
        if (json(metadata).version !== expected.version) throw new Error(`Installed package version mismatch: ${name}`)
    }
    const typescript = require(path.join(root, 'node_modules/typescript'))
    if (typescript.version !== policy.toolchain.typescript || lock.packages['node_modules/typescript']?.version !== policy.toolchain.typescript) throw new Error('TypeScript version does not match runtime build policy')
    return typescript
}
function walk(root) {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(root, entry.name)
        if (entry.isSymbolicLink()) throw new Error(`Unexpected output symlink: ${file}`)
        return entry.isDirectory() ? walk(file) : [file]
    })
}
function buildRuntimeArtifact(options) {
    const repo = path.resolve(options.repo || '.')
    const mode = options.inputMode || 'commit'
    if (!['commit', 'index', 'worktree'].includes(mode)) throw new Error('Unknown build input mode')
    const source = mode === 'commit' ? git(repo, ['rev-parse', '--verify', `${options.source}^{commit}`]).trim() : null
    const output = path.resolve(options.output)
    if (fs.existsSync(output) && (fs.lstatSync(output).isSymbolicLink() || !fs.statSync(output).isDirectory() || fs.readdirSync(output).length)) throw new Error('Output directory must be empty and must not be a symlink')
    fs.mkdirSync(output, { recursive: true })
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-build-'))
    try {
        const entries = inputEntries(repo, source, mode)
        const blobs = mode === 'worktree' ? null : readBlobs(repo, entries)
        for (const entry of entries) {
            safeName(entry.name)
            const destination = path.join(scratch, entry.name)
            fs.mkdirSync(path.dirname(destination), { recursive: true })
            if (entry.worktree && !fs.lstatSync(path.join(repo, entry.name)).isFile()) throw new Error(`Worktree input is not a regular file: ${entry.name}`)
            fs.writeFileSync(destination, entry.worktree ? fs.readFileSync(path.join(repo, entry.name)) : blobs.get(entry.oid))
        }
        const policy = json(path.join(scratch, POLICY))
        if (policy.schema !== 1 || policy.output_dir !== 'out' || !Array.isArray(policy.required_outputs) || !policy.required_outputs.length || !policy.toolchain) throw new Error('Invalid runtime build policy')
        for (const filename of policy.required_outputs) if (!safeName(filename).startsWith('out/')) throw new Error('Required runtime output must be under out/')
        const node = process.versions.node
        const npm = npmVersion()
        if (node !== policy.toolchain.node || npm !== policy.toolchain.npm) throw new Error(`Toolchain mismatch: Node ${node}, npm ${npm}`)
        const lockBytes = fs.readFileSync(path.join(scratch, 'package-lock.json'))
        const sourcePackage = json(path.join(scratch, 'package.json'))
        const lockedPackage = JSON.parse(lockBytes.toString('utf8')).packages?.['']
        const sortedPairs = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)))
        if (!lockedPackage || ['dependencies', 'devDependencies', 'optionalDependencies'].some(key => sortedPairs(sourcePackage[key]) !== sortedPairs(lockedPackage[key]))) throw new Error('Source package.json dependencies do not match package-lock.json')
        let dependencyRoot = scratch
        if (options.dependencyRoot) dependencyRoot = fs.realpathSync(options.dependencyRoot)
        else npmCi(scratch)
        const ts = validateDependencies(dependencyRoot, lockBytes, policy)
        if (dependencyRoot !== scratch) fs.symlinkSync(path.join(dependencyRoot, 'node_modules'), path.join(scratch, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
        const configFile = path.join(scratch, 'tsconfig.json')
        const config = ts.readConfigFile(configFile, ts.sys.readFile)
        if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
        // Extends must not read shared worktree or machine-local configuration.
        if (config.config.extends || config.config.references) throw new Error('Runtime build requires a standalone tsconfig')
        const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, scratch)
        if (parsed.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, { getCanonicalFileName: p => p, getCurrentDirectory: () => scratch, getNewLine: () => '\n' }))
        const emitRoot = path.join(scratch, 'out')
        if (!parsed.options.outDir || path.resolve(parsed.options.outDir) !== emitRoot || parsed.options.outFile || parsed.options.declarationDir && !inside(emitRoot, path.resolve(parsed.options.declarationDir))) throw new Error('Compiler output must remain inside out/')
        const compilerOptions = { ...parsed.options, noEmitOnError: true, incremental: false, composite: false, tsBuildInfoFile: undefined }
        const roots = [...new Set([...parsed.fileNames, ...entries.filter(e => /^src\/.*\.tsx?$/.test(e.name)).map(e => path.join(scratch, e.name))])]
        const host = ts.createCompilerHost(compilerOptions)
        const dependencyModules = fs.realpathSync(path.join(dependencyRoot, 'node_modules'))
        const allowed = filename => {
            const absolute = path.resolve(filename)
            if (!inside(scratch, absolute) && !inside(dependencyModules, absolute)) return false
            if (fs.existsSync(absolute)) {
                const real = fs.realpathSync(absolute)
                return inside(scratch, real) || inside(dependencyModules, real)
            }
            return true
        }
        if (roots.some(filename => !allowed(filename))) throw new Error('Compiler input escapes isolated source/dependencies')
        const originalGetSourceFile = host.getSourceFile.bind(host)
        host.getSourceFile = (filename, ...args) => allowed(filename) ? originalGetSourceFile(filename, ...args) : undefined
        host.getCurrentDirectory = () => scratch
        for (const name of ['readFile', 'fileExists', 'directoryExists']) {
            const original = host[name]?.bind(host)
            if (original) host[name] = filename => allowed(filename) ? original(filename) : name === 'readFile' ? undefined : false
        }
        const emitted = new Set()
        host.writeFile = (filename, data, bom) => {
            const absolute = path.resolve(filename)
            // TypeScript leaves imported JSON outside rootDir at its original
            // assets location. Those committed static inputs are not out emits.
            if (!inside(emitRoot, absolute)) {
                const relative = slash(path.relative(scratch, absolute))
                if ((relative.startsWith('assets/') && relative.endsWith('.json') || relative === 'docs/generated/character_table.json') && fs.existsSync(absolute) && fs.readFileSync(absolute, 'utf8').replace(/^\uFEFF/, '') === data.replace(/^\uFEFF/, '')) return
                throw new Error(`Compiler output escapes out/: ${relative}`)
            }
            fs.mkdirSync(path.dirname(absolute), { recursive: true })
            fs.writeFileSync(absolute, `${bom ? '\uFEFF' : ''}${data}`)
            emitted.add(slash(path.relative(scratch, absolute)))
        }
        const program = ts.createProgram(roots, compilerOptions, host)
        const diagnostics = ts.getPreEmitDiagnostics(program)
        if (diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: p => p, getCurrentDirectory: () => scratch, getNewLine: () => '\n' }))
        const result = program.emit()
        if (result.emitSkipped || result.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('TypeScript emit failed')
        for (const filename of policy.required_outputs) if (!emitted.has(filename)) throw new Error(`Missing required runtime output: ${filename}`)
        for (const filename of emitted) {
            if (!filename.endsWith('.js')) continue
            const absolute = path.join(scratch, filename)
            const tree = ts.createSourceFile(filename, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
            const checkReference = reference => {
                if (!reference.startsWith('.')) return
                const target = path.resolve(path.dirname(absolute), reference)
                const candidates = [target, `${target}.js`, `${target}.json`, path.join(target, 'index.js')]
                if (!inside(scratch, target) || !candidates.some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) throw new Error(`Missing relative runtime dependency: ${filename} -> ${reference}`)
            }
            const visit = node => {
                if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) checkReference(node.arguments[0].text)
                if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) checkReference(node.moduleSpecifier.text)
                ts.forEachChild(node, visit)
            }
            visit(tree)
        }
        const files = [...emitted].sort()
        if (!files.length || walk(emitRoot).length !== files.length) throw new Error('Incomplete emitted output inventory')
        fs.cpSync(emitRoot, path.join(output, 'out'), { recursive: true, errorOnExist: true, force: false })
        return { schema: 1, source_commit: source || `${mode}:${sha256(Buffer.from(entries.map(e => `${e.name}\0${e.oid || sha256(fs.readFileSync(path.join(scratch, e.name)))}`).sort().join('\n')))}`, node_version: node, npm_version: npm, typescript_version: ts.version, dependency_source: options.dependencyRoot ? 'trusted-local-install' : 'npm-ci', lockfile_sha256: sha256(lockBytes), root_dir: parsed.options.rootDir ? slash(path.relative(scratch, parsed.options.rootDir)) : null, files }
    } catch (error) {
        const emittedOutput = path.join(output, 'out')
        if (inside(output, emittedOutput)) fs.rmSync(emittedOutput, { recursive: true, force: true })
        throw error
    } finally { fs.rmSync(scratch, { recursive: true, force: true }) }
}
function main(argv = process.argv.slice(2)) {
    const options = {}
    const names = { '--repo': 'repo', '--source': 'source', '--output': 'output', '--dependency-root': 'dependencyRoot' }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--help') { process.stdout.write('Usage: node tools/build-runtime-artifact.cjs --repo REPO --source SHA --output EMPTY_DIR [--dependency-root LOCKED_INSTALL_DIR]\nDefault: isolated npm ci --ignore-scripts. --dependency-root trusts local package bytes after checking source/install lock metadata and actual versions; it does not verify each installed byte against registry tarballs.\n'); return }
        if (!names[argv[i]] || !argv[i + 1]) throw new Error(`Unknown or incomplete argument: ${argv[i]}`)
        options[names[argv[i]]] = argv[++i]
    }
    if (!options.source || !options.output) throw new Error('--source and --output are required')
    process.stdout.write(`${JSON.stringify(buildRuntimeArtifact(options))}\n`)
}
module.exports = { buildRuntimeArtifact, validateDependencies, inputEntries, selected, sha256 }
if (require.main === module) { try { main() } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 } }
