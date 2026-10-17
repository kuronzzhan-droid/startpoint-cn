const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const unzipper = require('unzipper')

const root = path.resolve(__dirname, '..')
const quest = require(path.join(root, 'assets/boss_battle_quest.json'))
const score = require(path.join(root, 'assets/score_reward.json'))

test('Five Boss quests use the dedicated preview reward group', () => {
    const ids = [1099001]
    assert.deepEqual(
        ids.map(id => quest[String(id)].scoreRewardGroupId),
        ids.map(() => 590010000),
    )
    assert.deepEqual(
        Array.from({ length: 22 }, (_, index) => quest[String(1099002 + index)].scoreRewardGroupId),
        Array.from({ length: 22 }, () => 10055),
    )
})

test('dedicated preview group lists the current Five Boss item identities and baseline counts', () => {
    assert.deepEqual(
        score['590010000'].map(row => [row.id, row.count]),
        [[10000144, 1], [10000145, 10], [10000146, 1], [10000147, 1], [10000310, 10]],
    )
})

test('1.4.130 CDN patch is registered and contains both preview tables', async () => {
    const manifest = require(path.join(root, 'assets/asset-patch/manifest.json'))
    const patch = manifest.patches.find(entry => entry.id === 'five-boss-reward-preview-1.4.130')
    assert.ok(patch)
    const archivePath = path.join(root, 'assets/asset-patch/active', patch.archive)
    const archiveBytes = fs.readFileSync(archivePath)
    assert.equal(archiveBytes.length, patch.archive_size)
    assert.deepEqual(patch.files.sort(), [
        'production/upload/93/a3763bc243c7178e1d97a3acd9dab2e9406a5e',
        'production/upload/eb/f8ef19148af9c1330b78c7fb3ce75e3f202e64',
    ])
    const zip = await unzipper.Open.buffer(archiveBytes)
    assert.deepEqual(zip.files.map(file => file.path).sort(), patch.files.slice().sort())
})
