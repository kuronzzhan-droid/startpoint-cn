const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
require('ts-node/register/transpile-only')
const { ClientAdmission, proofMessage } = require('../src/lib/client-admission')
const { isWeaponRivenInstanceId, stripWeaponRivenPartySouls, projectWeaponRivenClientResponse,
    projectWeaponRivenLoad, protectWeaponRivenPartySave } = require('../src/lib/weapon-riven/client')

test('only configured capabilities from valid bound admission tickets enable weapon rivens', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'riven-capability-'))
    const config = path.join(directory, 'policy.json'), keys = path.join(directory, 'keys.json')
    const key = crypto.randomBytes(32).toString('hex')
    let now = 100000
    const policy = { enforce: false, updateMessage: 'update', builds: [
        { id: 'modern', name: 'modern', enabled: true, allowUntil: null, capabilities: ['weapon-riven-v1'] },
        { id: 'legacy', name: 'legacy', enabled: true, allowUntil: null },
    ] }
    fs.writeFileSync(keys, JSON.stringify({ modern: key, legacy: key }))
    const save = () => fs.writeFileSync(config, JSON.stringify(policy))
    save()
    const gate = new ClientAdmission(config, keys, () => now, () => {})
    assert.equal(gate.reload(), true)
    const exchange = build => {
        const { data } = gate.challenge({ build, protocol: 1 }, 'local')
        return gate.prove({ challenge: data.challenge,
            proof: crypto.createHmac('sha256', Buffer.from(key, 'hex'))
                .update(proofMessage(build, data.challenge, data.nonce)).digest('hex') }, 'local').data.token
    }
    try {
        const token = exchange('modern'), legacy = exchange('legacy')
        assert.equal(gate.hasCapability('', '', 'weapon-riven-v1'), false, 'legacy admission bypass grants no capability')
        assert.equal(gate.hasCapability(token, 'session', 'weapon-riven-v1'), false, 'unbound ticket rejected')
        gate.bind(token, 'session'); gate.bind(legacy, 'session')
        assert.equal(gate.hasCapability(token, 'session', 'weapon-riven-v1'), true)
        assert.equal(gate.hasCapability(token, 'other-session', 'weapon-riven-v1'), false)
        assert.equal(gate.hasCapability(legacy, 'session', 'weapon-riven-v1'), false)
        assert.equal(gate.hasCapability('weapon-riven-v1', 'session', 'weapon-riven-v1'), false)
        policy.builds[0].capabilities = []; save(); assert.equal(gate.reload(), true)
        assert.equal(gate.hasCapability(token, 'session', 'weapon-riven-v1'), false, 'capability removal takes effect on existing ticket')
        policy.builds[0].capabilities = ['weapon-riven-v1']; save(); gate.reload()
        now += 30 * 60 * 1000 + 1
        assert.equal(gate.hasCapability(token, 'session', 'weapon-riven-v1'), false, 'expired ticket rejected')
        policy.builds[0].capabilities = 'weapon-riven-v1'; save()
        assert.equal(gate.reload(), false, 'malformed capability config rejected')
        policy.builds[0].capabilities = [5]; save(); assert.equal(gate.reload(), false)
    } finally { gate.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('load synthesizes owned instance counts and legacy projection does not mutate saved state', () => {
    const source = { item_list: { 16000000: 8, 16000001: 99, 16000002: 99, 16000900: 12, 5000001: 2 },
        user_party_group_list: [{ party_list: [{ ability_soul_ids: [16000001, 16000000, null] }] }],
        user_rush_event_list: { 1: { ability_soul_id_1: 16000200, ability_soul_id_2: 16000000 } } }
    const before = structuredClone(source)
    const rivens = { 16000001: { riven_id: 1, pending: { draw_id: 'pending', affixes: [[15990001, 50]] } } }
    const autoDismantled = [{ weapon_id: 100001, affixes: [[15990001, 50]], rewards: [[16000900, 3]] }]
    const modern = projectWeaponRivenLoad(source, rivens, true)
    assert.deepEqual(modern.item_list, { 16000000: 8, 16000001: 1, 16000900: 12, 5000001: 2 })
    assert.deepEqual(modern.user_weapon_riven_list, rivens)
    const legacy = projectWeaponRivenClientResponse({ data: { ...modern,
        weapon_riven_list: rivens, weapon_riven_deleted: [16000002], weapon_riven_granted: [16000001],
        weapon_riven_auto_dismantled: autoDismantled } }, false).data
    assert.deepEqual(legacy.item_list, { 16000000: 8, 16000900: 12, 5000001: 2 })
    for (const key of ['user_weapon_riven_list', 'weapon_riven_list', 'weapon_riven_deleted',
        'weapon_riven_granted', 'weapon_riven_auto_dismantled']) assert.equal(key in legacy, false)
    assert.deepEqual(legacy.user_party_group_list[0].party_list[0].ability_soul_ids, [null, 16000000, null])
    assert.equal(legacy.user_rush_event_list[1].ability_soul_id_1, null)
    assert.equal(legacy.user_rush_event_list[1].ability_soul_id_2, 16000000)
    assert.deepEqual(source, before)
    const settlement = { data: { weapon_riven_list: rivens, weapon_riven_granted: [16000001],
        weapon_riven_auto_dismantled: autoDismantled } }
    assert.equal(projectWeaponRivenClientResponse(settlement, true), settlement)
    assert.deepEqual(settlement.data.weapon_riven_granted, [16000001])
    assert.deepEqual(settlement.data.weapon_riven_auto_dismantled, autoDismantled)
})

test('legacy save restores only empty hidden slots and accepts explicit soul replacements', () => {
    const owns = id => [16000001, 16000002].includes(id)
    assert.deepEqual(protectWeaponRivenPartySave([null, 16000002, 16000000], [16000001, null, null], false, owns),
        [16000001, null, 16000000])
    assert.deepEqual(protectWeaponRivenPartySave([500001, null, null], [16000001, null, null], false, owns),
        [500001, null, null])
    assert.deepEqual(protectWeaponRivenPartySave([null, null, null], [16000200, null, null], false, owns),
        [null, null, null], 'deleted instances must not be restored')
    assert.deepEqual(protectWeaponRivenPartySave([16000002, null, null], [16000001, null, null], false, owns),
        [null, null, null], 'an explicit instance injection is rejected without restoring the old slot')
    assert.deepEqual(protectWeaponRivenPartySave([16000002, 16000200, null], [16000001, null, null], true, owns),
        [16000002, null, null])
    assert.deepEqual(protectWeaponRivenPartySave([null, null, null], [16000001, null, null], true, owns),
        [null, null, null])
})

test('real-player room projection uses None tuples and keeps unknown rivens', () => {
    const input = [1, [1, [{ party: { abilitySoulIds: [[0, 16000001], [0, 16000000], [0, 16000200]],
        equipments: [[0, { equipmentId: 16000001 }], [1], [1]] } }]]]
    const before = structuredClone(input)
    const projected = stripWeaponRivenPartySouls(input)
    assert.deepEqual(projected[1][1][0].party.abilitySoulIds, [[1], [0, 16000000], [1]])
    assert.deepEqual(projected[1][1][0].party.equipments, before[1][1][0].party.equipments)
    assert.deepEqual(input, before)
    assert.equal(isWeaponRivenInstanceId(16000000), false)
    assert.equal(isWeaponRivenInstanceId(16000201), true)
    assert.equal(isWeaponRivenInstanceId(16000999), true)
    assert.equal(isWeaponRivenInstanceId(16000900), false)
    assert.equal(isWeaponRivenInstanceId('16000001'), false)
})
