#!/usr/bin/env node
'use strict'

// The commit guard builds the actual index, not local src/ or historical out/.
// --worktree is explicitly a development check and is not commit evidence.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildRuntimeArtifact } = require('./build-runtime-artifact.cjs')

function checkOutArtifacts(options = {}) {
    const repo = path.resolve(options.repo || path.join(__dirname, '..'))
    const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const mode = options.worktree ? 'worktree' : 'index'
    const changed = git(['diff', ...(options.worktree ? ['HEAD'] : ['--cached']), '--name-only', '-z']).split('\0').filter(Boolean)
    const trackedOut = git(['ls-files', '-z', '--', 'out/']).split('\0').filter(Boolean)
    if (trackedOut.length) throw new Error('Source-only runtime policy prohibits tracked out/ files; remove all generated out/ entries from the index')
    if (!options.all && !changed.some(name => name.startsWith('src/') || ['package.json', 'package-lock.json', 'tsconfig.json', 'tools/runtime-build-policy.json', 'tools/build-runtime-artifact.cjs', 'tools/check-out-artifacts.cjs', 'docs/generated/character_table.json'].includes(name) || name.startsWith('out/') || /^assets\/.*\.json$/.test(name))) return { mode, skipped: true }
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-index-check-'))
    try {
        const artifact = buildRuntimeArtifact({ repo, inputMode: mode, output, dependencyRoot: options.dependencyRoot })
        return { mode, skipped: false, ...artifact }
    } finally { fs.rmSync(output, { recursive: true, force: true }) }
}
function main(argv = process.argv.slice(2)) {
    const options = {}
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--worktree') options.worktree = true
        else if (argv[i] === '--all') options.all = true
        else if (argv[i] === '--repo' && argv[i + 1]) options.repo = argv[++i]
        else if (argv[i] === '--dependency-root' && argv[i + 1]) options.dependencyRoot = argv[++i]
        else if (argv[i] === '--help' || argv[i] === '-h') { console.log('Usage: node tools/check-out-artifacts.cjs [--worktree] [--all] [--repo REPO] [--dependency-root LOCKED_INSTALL_DIR]'); return }
        else throw new Error(`Unknown or incomplete argument: ${argv[i]}`)
    }
    const result = checkOutArtifacts(options)
    console.log(`[runtime check] ${result.mode}${options.worktree ? ' (development only)' : ' (staged inputs)'}: ${result.skipped ? 'no affected build inputs' : `${result.files.length} emitted files; passed`}`)
}
module.exports = { checkOutArtifacts }
if (require.main === module) { try { main() } catch (error) { console.error(`[runtime check] ${error.message}`); process.exitCode = 1 } }
