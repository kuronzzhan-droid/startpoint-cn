const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, 'lib/weapon-riven', name))
const { canonicalRivenMembers, parseRivenAcknowledgement, validateRivenCanonical } = load('multi-protocol')
const { RivenSnapshotStore } = load('multi-store')
const catalog = { id: 'fixture-catalog', soulKeys: new Set([16000001,15990001,15990002,15990003,15990004]),
    weaponIds: new Set([300101]), resourceDigest: 'fixture' }
function member(viewerId, level, slot = 0) {
    const party = { characters: [[0,{id:111001}],[1],[1]], unison_characters: [[1],[1],[1]],
        equipments: [[0,{equipmentId:300101}],[1],[1]], abilitySoulIds: [[1],[1],[1]],
        weapon_rivens: [[1],[1],[1]], weapon_riven_scope: 'multi-v1', weapon_riven_snapshot_id: 'fixture-snapshot',
        weapon_riven_mode: 1, weapon_riven_catalog: catalog.id, weapon_riven_reason: '' }
    party.abilitySoulIds[slot] = [0,16000001]
    party.weapon_rivens[slot] = [0,[16000001,300101,15990001,level]]
    return { viewerId, connectionId: `c-${viewerId}`, party }
}
const identity = preparationId => ({ ownerEpoch: 'owner', roomInstanceId: 'instance', sourceLobbyGeneration: 1, preparationId })
function snapshot(preparationId = 'p1') { const members = [member(9007199254740991,80),member(102,25,1)]
    return { identity: identity(preparationId), snapshotId: 'fixture-snapshot', members,
        canonical: canonicalRivenMembers(members,catalog), sha256: 'sha', mode: 1, catalog: catalog.id,
        reason: '', rulesDigest: 'rules', ackConnectionIds: ['A','B'], conversionLoadouts: [], audit: [] } }

test('C22 exact canonical preserves safe viewer decimals and same-item owner/slot separation', () => {
    const value = snapshot(), expected = 'WFR2C1|fixture-catalog|1|2|V|9007199254740991|111001|0|300101|16000001|4|16000001|300101|15990001|80|0|0|0|0|0|0|0|0|0|0|V|102|111001|0|300101|0|0|0|0|0|16000001|4|16000001|300101|15990001|25|0|0|0|0|0'
    assert.equal(value.canonical, expected)
    assert.deepEqual(parseRivenAcknowledgement(`WFR2|A|fixture-snapshot|${expected}`),
        { kind:'A',snapshotId:'fixture-snapshot',canonical:expected })
    assert.equal(parseRivenAcknowledgement('ordinary log'), null)
    assert.deepEqual(parseRivenAcknowledgement('WFR2|N|invalid|invalid_snapshot'),
        { kind:'N',snapshotId:'invalid',reason:'invalid_snapshot' })
})
test('checked-in cross-language vectors have exact canonical and ACK bytes', () => {
    for (const vector of require('./fixtures/weapon-riven-p2-canonical-vectors.json').vectors) {
        assert.equal(canonicalRivenMembers(vector.members), vector.canonical)
        assert.equal(parseRivenAcknowledgement(vector.ack).canonical, vector.canonical)
    }
})

test('strict scalar, row, COM, resources, reason and ACK length validation', () => {
    for (const change of [p=>p.weapon_rivens[0][1].push(3), p=>p.weapon_rivens[0][1][3]=1.2,
        p=>p.weapon_rivens[0][1][3]=101, p=>p.weapon_rivens[0][1][2]=15999999,
        p=>p.weapon_rivens[0][1][1]=999, p=>p.weapon_rivens[0]=[1],
        p=>p.abilitySoulIds[0]=16000001, p=>p.weapon_riven_reason='bad',
        p=>p.characters[0][1].id=2147483648, p=>p.weapon_rivens[0][1][2]=2147483648,
        p=>p.weapon_rivens[0][1][0]=16000002, p=>p.weapon_rivens[0]=[0,[16000001,300101,15990001,1,15990001,2]]]) {
        const m = member(1,80); change(m.party); assert.throws(()=>canonicalRivenMembers([m],catalog))
    }
    assert.throws(()=>canonicalRivenMembers([member(1,80),member(1,25)],catalog),/DUPLICATE/)
    const four = member(1,80); four.party.weapon_rivens[0][1] = [16000001,300101,15990001,1,15990002,100,15990003,50,15990004,1]
    assert.doesNotThrow(()=>canonicalRivenMembers([four],catalog))
    for (const content of [snapshot().canonical+'|0',snapshot().canonical.slice(0,-2),snapshot().canonical.replace('9007199254740991','9007199254740992')]) {
        assert.throws(()=>validateRivenCanonical(content))
    }
    assert.throws(()=>parseRivenAcknowledgement('WFR2|A|s|'+'1'.repeat(4096)))
    const disabled=member(1,80); Object.assign(disabled.party,{weapon_riven_mode:0,weapon_riven_catalog:'none',weapon_riven_reason:'mixed_version',weapon_rivens:[[1],[1],[1]],abilitySoulIds:[[1],[1],[1]]})
    const com={viewerId:900000001,comId:1,party:{characters:[[1],[1],[1]],unison_characters:[[1],[1],[1]],equipments:[[1],[1],[1]],abilitySoulIds:[[1],[1],[1]]}}
    assert.match(canonicalRivenMembers([disabled,com]),/\|C\|1\|/)
    com.party.weapon_rivens=[[1],[1],[1]]; assert.throws(()=>canonicalRivenMembers([disabled,com]),/COM_CONTEXT/)
})

test('store coalesces unknown-outcome retries, clones results, pins committed battles and isolates old releases', async () => {
    let now=0, builds=0, release
    const store=new RivenSnapshotStore(()=>now,2,10,100)
    const promise=store.prepare(identity('p1'),'roster',async()=>{ builds++; await new Promise(resolve=>release=resolve); return snapshot() })
    const retry=store.prepare(identity('p1'),'roster',async()=>{ throw Error('must not run') })
    await Promise.resolve(); assert.equal(builds,1); release()
    const a=await promise,b=await retry; a.members[0].party.weapon_rivens[0][1][3]=1
    assert.equal(b.members[0].party.weapon_rivens[0][1][3],80)
    const ref={identity:identity('p1'),snapshotId:b.snapshotId,battleSessionId:'e50e4f4f-51ab-4e57-9414-3c12526549c5:1:2:123'}
    store.commit(ref); now=1000; assert.equal(store.get(ref).canonical,b.canonical)
    assert.throws(()=>store.commit({...ref,battleSessionId:'battle-2'}),/CONFLICT/)
    await store.prepare(identity('p2'),'new',async()=>snapshot('p2'))
    assert.equal(store.release({...ref,snapshotId:'wrong'}),false)
    assert.equal(store.release(ref),true)
    assert.equal(store.get({identity:identity('p2'),snapshotId:b.snapshotId}).identity.preparationId,'p2')
    await assert.rejects(store.prepare(identity('p1'),'roster',async()=>snapshot()),/RELEASED/)
})

test('cancel-before-freeze, owner loss, TTL, capacity and changed admission fail closed', async () => {
    let now=0
    const store=new RivenSnapshotStore(()=>now,1,10,100)
    store.cancel({identity:identity('cancelled')})
    await assert.rejects(store.prepare(identity('cancelled'),'a',async()=>snapshot('cancelled')),/RELEASED/)
    await store.prepare(identity('p1'),'a',async()=>snapshot(),()=>{throw Error('revoked')})
    assert.throws(()=>store.commit({identity:identity('p1'),snapshotId:'fixture-snapshot',battleSessionId:'b'}),/revoked/)
    await assert.rejects(store.prepare(identity('p2'),'b',async()=>snapshot('p2')),/CAPACITY/)
    await assert.rejects(store.prepare(identity('p1'),'changed',async()=>snapshot()),/CONFLICT/)
    now=11; assert.throws(()=>store.get({identity:identity('p1'),snapshotId:'fixture-snapshot'}),/MISSING/)
    store.releaseOwnerEpoch('owner')
    await assert.rejects(store.prepare(identity('p3'),'c',async()=>snapshot('p3')),/RELEASED/)
})

test('late freeze completion cannot resurrect a cancelled preparation or owner epoch', async()=>{
    for (const cancel of [store=>store.cancel({identity:identity('p1')}),store=>store.releaseOwnerEpoch('owner')]) {
        const store=new RivenSnapshotStore(); let release
        const pending=store.prepare(identity('p1'),'a',async()=>{await new Promise(resolve=>release=resolve);return snapshot()})
        await Promise.resolve(); cancel(store); release()
        await assert.rejects(pending,/RELEASED/)
        assert.equal(store.stats().preparing,0); assert.equal(store.stats().committed,0)
    }
})
