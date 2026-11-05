const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-four-gacha-hygiene-'))
const bash = process.argv[2] || 'bash'
const prefix = 'assets/asset-patch/artwork/gacha-four-offline/'
const pools = ['starview-encounter', 'autumn-beast-dice', 'autumn-prayer-rabbit', 'autumn-moon-laurel']
function run(command, args) {
  const r = spawnSync(command, args, { cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 65536 })
  if (r.error) throw r.error
  return r
}
function scan(code) {
  const r = run(bash, ['scripts/check-hygiene.sh', '--all'])
  assert.equal(r.status, code, r.stdout + r.stderr)
}
function size(file, bytes) {
  const target = path.join(fixture, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const fd = fs.openSync(target, 'w')
  try { fs.ftruncateSync(fd, bytes) } finally { fs.closeSync(fd) }
}
try {
  assert.equal(run('git', ['init', '-q']).status, 0)
  fs.mkdirSync(path.join(fixture, 'scripts'))
  fs.copyFileSync(path.join(root, 'scripts/check-hygiene.sh'), path.join(fixture, 'scripts/check-hygiene.sh'))
  assert.equal(run('git', ['add', '--', 'scripts/check-hygiene.sh']).status, 0)
  for (const pool of pools) {
    const file = prefix + pool + '/native-assets.zip'
    size(file, 20 * 1024 * 1024)
    assert.equal(run('git', ['add', '--', file]).status, 0)
    scan(0)
    size(file, 20 * 1024 * 1024 + 1)
    scan(1)
    size(file, 0)
  }
  for (const file of [prefix + pools[0] + '/other.zip', prefix + 'unapproved/native-assets.zip', prefix + pools[0] + '/native-assets.zip.bak']) {
    size(file, 1024 * 1024 + 1)
    assert.equal(run('git', ['add', '--', file]).status, 0)
    scan(1)
    size(file, 0)
  }
  scan(0)
  console.log('PASS: four exact paths allowed; oversized, renamed and relocated files rejected')
} finally {
  const resolved = fs.realpathSync(fixture)
  assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep))
  fs.rmSync(resolved, { recursive: true })
}
