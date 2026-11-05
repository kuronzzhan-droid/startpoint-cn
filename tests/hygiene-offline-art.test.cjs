const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-hygiene-art-'))
const bash = process.argv[2] || 'bash'
const archive = 'assets/asset-patch/artwork/starview-sway-v7/native-assets.zip'
function run(command, args) {
    const result = spawnSync(command, args, { cwd: fixture, encoding: 'utf8', windowsHide: true })
    if (result.error) throw result.error
    return result
}
function scan(expected, label) {
    const result = run(bash, ['scripts/check-hygiene.sh', '--all'])
    assert.equal(result.status, expected, label + '\n' + result.stdout + result.stderr)
}
function writeSized(file, size) {
    const target = path.join(fixture, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, Buffer.alloc(size))
}
try {
    assert.equal(run('git', ['init', '-q']).status, 0)
    fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true })
    fs.copyFileSync(path.join(root, 'scripts/check-hygiene.sh'), path.join(fixture, 'scripts/check-hygiene.sh'))
    writeSized(archive, 20 * 1024 * 1024)
    assert.equal(run('git', ['add', '--', 'scripts/check-hygiene.sh', archive]).status, 0)
    scan(0, 'The exact offline archive is allowed up to 20 MiB')
    writeSized(archive, 20 * 1024 * 1024 + 1)
    scan(1, 'The exact archive must still obey its size limit')
    writeSized(archive, 0)
    const other = archive.replace('native-assets.zip', 'unapproved.zip')
    writeSized(other, 1024 * 1024 + 1)
    assert.equal(run('git', ['add', '--', other]).status, 0)
    scan(1, 'Another file in the same directory is not allowed')
    writeSized(other, 0)
    const misplaced = archive.replace('starview-sway-v7', 'another-pool')
    writeSized(misplaced, 1024 * 1024 + 1)
    assert.equal(run('git', ['add', '--', misplaced]).status, 0)
    scan(1, 'The same filename in another directory is not allowed')
    console.log('PASS: exact archive allowed; oversized, renamed and relocated archives rejected')
} finally {
    const resolved = fs.realpathSync(fixture)
    assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep))
    fs.rmSync(resolved, { recursive: true })
}
