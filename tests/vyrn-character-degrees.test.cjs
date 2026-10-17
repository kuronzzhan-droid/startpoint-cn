const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starpoint-vyrn-degrees-'))
process.env.DATA_DIR = dataDir
process.env.GACHA_SEED_DIR = path.join(dataDir, 'seeds')
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const { getDb } = require('../out/data/db')
const accounts = require('../out/data/domains/account')
const players = require('../out/data/domains/player')
const characters = require('../out/data/domains/character')
const degrees = require('../out/data/domains/degree')
const catalog = require('../out/lib/character-degree-catalog')
const rewards = require('../out/lib/character-degree-rewards')
const snapshots = require('../out/data/snapshots/player-snapshot')
const content = require('../out/lib/content-master')
const CID = 169978
const PAIR = [9910090, 9910091]
const db = getDb()

// Fail if the actual merged character metadata has not been integrated.
assert.equal(content.serverCharacters[CID]?.rarity, 5)
function player(label) {
  const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'fixture', idpId: label, status: 'normal' })
  return players.insertDefaultPlayerSync(account.id)
}
function own(player, exp = 379988, overLimitStep = 4) {
  characters.insertDefaultPlayerCharacterSync(player.id, CID)
  characters.updatePlayerCharacterSync(player.id, CID, { exp, overLimitStep, evolutionLevel: 0 })
}
function held(player) { return degrees.getPlayerDegreeIdsSync(player.id).filter(id => PAIR.includes(id)) }

test.after(() => {
  if (db.open) db.close()
  const resolved = fs.realpathSync(dataDir)
  assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()))
  assert.ok(path.basename(resolved).startsWith('starpoint-vyrn-degrees-'))
  fs.rmSync(resolved, { recursive: true })
})

test('Vyrn activation, fixed catalog, and winning degree definitions agree', () => {
  assert.deepEqual([...catalog.CHARACTER_DEGREE_CATALOG.find(row => row.character_id === CID).degree_ids], PAIR)
  assert.equal(rewards.characterDegreeRewardsEnabled(), true)
  assert.deepEqual(PAIR.map(id => content.degreeDefinitions[id].name), ['我不是蜥蜴！', '巴哈姆特碎片'])
  for (const [state, id] of PAIR.entries()) {
    assert.equal(content.degreeDefinitions[id].string_id, `degree_mod_character_${CID}_awake${state}`)
    assert.equal(content.degreeDefinitions[id].category_id, 2)
  }
})

test('Vyrn titles require ownership, 100-level EXP, and four limit breaks, then grant both without awakening', () => {
  const p = player('eligibility')
  assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id, [CID]), [])
  own(p, 379987, 4)
  assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id, [CID]), [])
  characters.updatePlayerCharacterSync(p.id, CID, { exp: 379988, overLimitStep: 3 })
  assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id, [CID]), [])
  characters.updatePlayerCharacterSync(p.id, CID, { overLimitStep: 4, evolutionLevel: 0 })
  assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id, [CID]), PAIR)
  const rows = db.prepare('SELECT degree_id, acquired_at FROM players_degrees WHERE player_id=? AND degree_id IN (?,?) ORDER BY degree_id').all(p.id, ...PAIR)
  assert.deepEqual(rows.map(row => row.degree_id), PAIR)
  assert.equal(rows[0].acquired_at, rows[1].acquired_at)
  assert.ok(rows[0].acquired_at > 0)
  assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id, [CID]), [])
  assert.equal(players.getPlayerSync(p.id).degreeId, 1)
})

test('Vyrn pair grants roll back together and never grant to another account', () => {
  const p = player('atomic'), other = player('other'); own(p); own(other)
  db.exec(`CREATE TRIGGER reject_vyrn_second BEFORE INSERT ON players_degrees
    WHEN NEW.player_id=${p.id} AND NEW.degree_id=${PAIR[1]} BEGIN SELECT RAISE(ABORT,'vyrn pair failure'); END`)
  try {
    assert.throws(() => rewards.grantCharacterDegreeRewardsSync(p.id, [CID]), /vyrn pair failure/)
    assert.deepEqual(held(p), [])
    assert.deepEqual(held(other), [])
  } finally { db.exec('DROP TRIGGER reject_vyrn_second') }
  assert.deepEqual(rewards.grantCharacterDegreeRewardsSync(p.id, [CID]), PAIR)
  assert.deepEqual(held(other), [])
})

test('Vyrn degrees use the existing V2 save schema and preserve timestamps and equipped choice', () => {
  const p = player('snapshot'); own(p)
  const before = snapshots.createPlayerSaveSnapshotV2Sync(p.id)
  rewards.grantCharacterDegreeRewardsSync(p.id, [CID])
  players.updatePlayerSync({ id: p.id, degreeId: PAIR[1] })
  const after = snapshots.createPlayerSaveSnapshotV2Sync(p.id)
  assert.equal(after.schemaFingerprint, before.schemaFingerprint)
  const table = after.data.tables.players_degrees
  const idColumn = table.columns.indexOf('degree_id'), timeColumn = table.columns.indexOf('acquired_at')
  assert.ok(idColumn >= 0 && timeColumn >= 0)
  const rows = table.rows.filter(row => PAIR.includes(row[idColumn]))
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => row[timeColumn] > 0))
  assert.equal(players.getPlayerSync(p.id).degreeId, PAIR[1])
  assert.deepEqual(degrees.getPlayerPortableDegreesSync(p.id).filter(row => PAIR.includes(row.degreeId)).map(row => row.degreeId), PAIR)
})
