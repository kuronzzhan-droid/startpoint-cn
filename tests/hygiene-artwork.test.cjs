const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-hygiene-artwork-'))
const bash = process.argv[2] || 'bash'
const artwork = 'assets/asset-patch/artwork/five-boss/ui-20260911/五重关卡-讨伐页.png'
const original = fs.readFileSync(path.join(root, artwork))
const expectedSha = 'd93b308b548633fd931000716b71de81a7cf3f278a30e5609cd641fabf5adedb'
let checks = 0

function run(command, args) {
    const result = spawnSync(command, args, { cwd: fixture, encoding: 'utf8', windowsHide: true })
    if (result.error) throw result.error
    return result
}
function git(...args) {
    const result = run('git', args)
    assert.equal(result.status, 0, result.stdout + result.stderr)
}
function write(relative, bytes) {
    const target = path.join(fixture, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
}
function scan(expected, label, mode = '--all') {
    const args = ['scripts/check-hygiene.sh']
    if (mode) args.push(mode)
    const result = run(bash, args)
    assert.equal(result.status, expected, label + '\n' + result.stdout + result.stderr)
    checks++
}

try {
    assert.equal(original.length, 1397251)
    assert.equal(crypto.createHash('sha256').update(original).digest('hex'), expectedSha)
    git('init', '-q')
    git('config', 'core.quotePath', 'true')
    write('scripts/check-hygiene.sh', fs.readFileSync(path.join(root, 'scripts/check-hygiene.sh')))
    write(artwork, original)
    git('add', '--', 'scripts/check-hygiene.sh', artwork)
    scan(0, 'The exact existing artwork must pass')
    scan(0, 'The exact existing artwork must pass staged mode', '')

    const altered = Buffer.from(original)
    altered[altered.length - 1] ^= 1
    write(artwork, altered)
    scan(1, 'Changing one byte at the same path must fail')
    git('add', '--', artwork)
    scan(1, 'Changed artwork must also fail staged mode', '')
    write(artwork, Buffer.concat([original, Buffer.from([0])]))
    scan(1, 'Changing the approved size must fail')
    write(artwork, original)
    git('add', '--', artwork)
    scan(0, 'Restoring the approved artwork must pass')

    const other = 'assets/其他图 空格.png'
    write(other, original)
    git('add', '--', other)
    scan(1, 'The same content at a different Chinese path must fail')
    scan(1, 'A different Chinese path must fail staged mode', '')
    write(other, Buffer.alloc(1024 * 1024, 0))
    scan(0, 'An unrelated binary at exactly 1 MiB must pass')
    write(other, Buffer.alloc(1024 * 1024 + 1, 0))
    scan(1, 'An unrelated Chinese binary above 1 MiB must fail')
    write(other, Buffer.alloc(0))

    const text = '资料/检查文本.txt'
    write(text, ['private-user', '@', 'gmail', '.com'].join('') + '\n')
    git('add', '--', text)
    scan(1, 'Chinese filenames must not hide existing text checks')
    write(text, 'ordinary text\n')
    scan(0, 'Clean files and the exact artwork must pass')
    console.log(`PASS: ${checks} legacy artwork, size boundary, Unicode and staged checks`)
} finally {
    const resolved = fs.realpathSync(fixture)
    const tmp = fs.realpathSync(os.tmpdir())
    assert.ok(resolved.startsWith(tmp + path.sep))
    fs.rmSync(resolved, { recursive: true })
}
