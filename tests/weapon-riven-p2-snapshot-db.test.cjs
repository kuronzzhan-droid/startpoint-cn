const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {load,getDb,player,mode,rivens,savedSouls} = require('./helpers/weapon-riven-five-boss-fixture.cjs')
const {readRivenResourceCatalog} = load('lib/weapon-riven/multi-catalog')
const {displayWeaponRivenAffixes} = load('lib/weapon-riven/display')
const {handleRivenBusiness} = load('lib/weapon-riven/multi-business')
const {buildRivenSnapshot} = load('lib/weapon-riven/multi-snapshot')
process.env.WEAPON_RIVEN_MULTI_ENABLED='1'
process.env.WEAPON_RIVEN_MULTI_CATALOG=path.resolve(__dirname,'../assets/weapon_riven_multi_catalog.json')
const resources=readRivenResourceCatalog()
const caps=new Map()
mock.method(load('lib/client-admission').clientAdmission(),'socketLease',(token)=>({ok:true,remainingMs:60000,
    weaponRiven:caps.get(token) ?? {p1:false,p2:false,catalog:'none'}}))
let sequence=0
async function member(quality,slot=0) {
    const souls=[16000000,0,0]; souls[slot]=16000001
    const p=player(souls)
    load('data/domains/equipment').insertPlayerEquipmentSync(p.id,2010002,{level:1,enhancementLevel:0,protection:false,stack:0})
    getDb().prepare('UPDATE players_parties SET equipment_1=2010002 WHERE player_id=?').run(p.id)
    await load('data/domains/session').insertSessionWithToken({token:String(p.viewerId),accountId:p.accountId,
        expires:new Date(Date.now()+86400000),type:2})
    getDb().transaction(()=>rivens.insertWeaponRivenSync(p.id,2010002,[[15990001,quality]],'p2-card',()=>0,3))()
    getDb().prepare('UPDATE player_weapon_rivens SET pending_json=? WHERE player_id=?').run(JSON.stringify({draw_id:'private-pending',affix_version:3,affixes:[[15990002,1]]}),p.id)
    const token=`test-${p.id}`; caps.set(token,{p1:true,p2:true,catalog:resources.id})
    return {p,wire:{viewerId:p.viewerId,playerId:p.id,connectionId:`127.0.0.1:${p.id}`,partyId:1,admissionToken:token,session:'bound',
        mate:{viewerId:1,playerId:999,party:{weapon_rivens:[[0,[16000001,999,15990001,100]]],abilitySoulIds:[[0,16000001],[1],[1]]}}}}
}
function request(members) { return {identity:{ownerEpoch:'parent-test',roomInstanceId:'room',sourceLobbyGeneration:1,preparationId:`prep-${++sequence}`},category:mode.category,questId:mode.visibleQuestId,members:members.map(m=>m.wire)} }

test('one authoritative transaction freezes all owners, q-to-L, unknown conversion and excludes pending/injected party',async()=>{
    const a=await member(1),b=await member(.1,1),input=request([a,b])
    const value=await handleRivenBusiness('riven.freeze',input)
    assert.equal(value.mode,1); assert.equal(value.members[0].party.characters[0][1].id,111001)
    const rows=value.members.map((m,i)=>m.party.weapon_rivens[i][1])
    assert.equal(rows[0][0],rows[1][0]); assert.notEqual(rows[0][3],rows[1][3])
    assert.deepEqual(rows[0],[16000001,2010002,...displayWeaponRivenAffixes(2010002,[[15990001,1]],3).flatMap(([k,l])=>[k,l])])
    assert.equal(JSON.stringify(value.members).includes('private-pending'),false)
    assert.deepEqual(value.conversionLoadouts[1].loadout.abilitySoulIds,[16000000,16000001,0])
    const frozen=value.canonical
    getDb().prepare('UPDATE player_weapon_rivens SET affixes_json=?,revision=revision+1 WHERE player_id=?').run('[[15990001,0]]',a.p.id)
    assert.equal((await handleRivenBusiness('riven.freeze',input)).canonical,frozen)
    assert.notEqual((await buildRivenSnapshot(request([a,b]))).canonical,frozen)
    await handleRivenBusiness('riven.commit',{identity:input.identity,snapshotId:value.snapshotId,battleSessionId:'battle-db'})
    getDb().prepare('DELETE FROM player_weapon_rivens WHERE player_id=?').run(a.p.id)
    getDb().transaction(()=>rivens.insertWeaponRivenSync(a.p.id,2010002,[[15990002,.2]],'reused-item',()=>0,3))()
    assert.equal((await handleRivenBusiness('riven.get',{identity:input.identity,snapshotId:value.snapshotId,battleSessionId:'battle-db'})).canonical,frozen)
    assert.equal(value.audit[0].rivenId,1)
    assert.equal(getDb().prepare('SELECT riven_id FROM player_weapon_rivens WHERE player_id=?').get(a.p.id).riven_id,2)
})

test('normalization is persisted inside freeze but disabled leaves owned cards and unknown conversion intact',async()=>{
    const a=await member(1),b=await member(.5)
    getDb().prepare('UPDATE players_parties SET ability_soul_2=16000002,ability_soul_3=16000000 WHERE player_id=?').run(a.p.id)
    caps.set(b.wire.admissionToken,{p1:true,p2:false,catalog:'none'})
    const value=await buildRivenSnapshot(request([a,b]))
    assert.equal(value.mode,0); assert.equal(value.reason,'mixed_version'); assert.equal(value.catalog,'none')
    assert.deepEqual(value.ackConnectionIds,[a.wire.connectionId])
    // Author 2026-10-27 15:17: two revealed rivens in one party make both ineffective; the cards stay owned.
    assert.deepEqual(savedSouls(a.p),[null,null,16000000])
    assert.deepEqual(value.members[0].party.abilitySoulIds,[[1],[1],[0,16000000]])
    assert.equal(value.conversionLoadouts[0].loadout.abilitySoulIds[0],0)
})

test('forged identity, missing ownership/resource and revoked pending capability reject before commit',async()=>{
    const a=await member(1),b=await member(.5),input=request([a,b])
    const forged=structuredClone(input); forged.members[0].playerId=b.p.id
    await assert.rejects(buildRivenSnapshot(forged),/DUPLICATE|AUTHORIZATION/)
    const value=await handleRivenBusiness('riven.freeze',input)
    caps.set(b.wire.admissionToken,{p1:true,p2:true,catalog:'wrong'})
    await assert.rejects(handleRivenBusiness('riven.validate',{identity:input.identity,snapshotId:value.snapshotId}),/ADMISSION_CHANGED/)
    await assert.rejects(handleRivenBusiness('riven.commit',{identity:input.identity,snapshotId:value.snapshotId,battleSessionId:'forbidden'}),/ADMISSION_CHANGED/)
    caps.set(b.wire.admissionToken,{p1:true,p2:true,catalog:resources.id})
    getDb().prepare('DELETE FROM player_weapon_rivens WHERE player_id=?').run(a.p.id)
    await assert.rejects(buildRivenSnapshot(request([a,b])),/OWNERSHIP/)
    assert.equal(resources.soulKeys.has(16000001),true); assert.equal(resources.weaponIds.has(2010002),true)
})

test('four ordered affixes, no-main and binding mismatch retain data for existing client activation checks',async()=>{
    const a=await member(1), affixes=[[15990001,0],[15990002,1],[15990003,.5],[15990004,1]]
    getDb().prepare('UPDATE player_weapon_rivens SET affixes_json=? WHERE player_id=?').run(JSON.stringify(affixes),a.p.id)
    load('data/domains/equipment').insertPlayerEquipmentSync(a.p.id,100001,{level:1,enhancementLevel:0,protection:false,stack:0})
    getDb().prepare('UPDATE players_parties SET character_id_1=NULL,equipment_1=100001 WHERE player_id=?').run(a.p.id)
    const value=await buildRivenSnapshot(request([a])),party=value.members[0].party
    assert.equal(value.mode,1); assert.deepEqual(party.characters[0],[1]); assert.equal(party.equipments[0][1].equipmentId,100001)
    assert.deepEqual(party.weapon_rivens[0][1],[16000001,2010002,...displayWeaponRivenAffixes(2010002,affixes,3).flatMap(([k,l])=>[k,l])])
    assert.equal(party.weapon_rivens[0][1].length,10); assert.equal(party.weapon_rivens[0][1][3],1)
})

test('missing carrier, affix or weapon resources prevent enabled snapshot construction',async()=>{
    const a=await member(1),module=load('lib/weapon-riven/multi-catalog')
    for (const [field,id] of [['soulKeys',16000001],['soulKeys',15990001],['weaponIds',2010002]]) {
        const reduced={...resources,[field]:new Set(resources[field])}; reduced[field].delete(id)
        const patched=mock.method(module,'readRivenResourceCatalog',()=>reduced)
        try { await assert.rejects(buildRivenSnapshot(request([a])),/RESOURCE|AFFIX/) }
        finally { patched.mock.restore() }
    }
})

test('all-member transaction rolls normalization back when a later member has no saved selected party',async()=>{
    const a=await member(1),b=await member(.5)
    getDb().prepare('UPDATE players_parties SET ability_soul_2=16000002 WHERE player_id=?').run(a.p.id)
    b.wire.partyId=120
    getDb().prepare('DELETE FROM players_parties WHERE player_id=? AND category=1 AND group_id=12 AND slot=10').run(b.p.id)
    await assert.rejects(buildRivenSnapshot(request([a,b])),/SAVED_PARTY_MISSING/)
    assert.deepEqual(savedSouls(a.p),[16000001,16000002,null])
    const forged=request([a]);forged.members[0].playerId=987654321
    await assert.rejects(buildRivenSnapshot(forged),/AUTHORIZATION/)
    await assert.rejects(load('multi/coordinator/business-rpc').runWithRealtimeBusinessAdmission({ownerEpoch:'forged-owner'},
        ()=>handleRivenBusiness('riven.freeze',request([a]))),/OWNER_EPOCH_MISMATCH/)
})

test('legacy migration completes in the same all-member transaction before confirmed rows are read',async()=>{
    const a=await member(1)
    getDb().prepare('UPDATE player_weapon_rivens SET affix_version=1,affixes_json=?,pending_json=? WHERE player_id=?')
        .run('[[15990001,80]]',JSON.stringify({draw_id:'legacy-pending',affix_version:1,affixes:[[15990002,50]]}),a.p.id)
    const value=await buildRivenSnapshot(request([a]))
    const row=getDb().prepare('SELECT affix_version,affixes_json,pending_json FROM player_weapon_rivens WHERE player_id=?').get(a.p.id)
    assert.equal(row.affix_version,3);assert.equal(JSON.parse(row.pending_json).affix_version,3)
    assert.deepEqual(value.members[0].party.weapon_rivens[0][1],
        [16000001,2010002,...displayWeaponRivenAffixes(2010002,JSON.parse(row.affixes_json),3).flatMap(([k,l])=>[k,l])])
    assert.equal(JSON.stringify(value).includes('legacy-pending'),false)
})

test('resource hashes and catalog mismatch select a new disabled decision while committed rows stay unchanged',async()=>{
    const a=await member(1)
    caps.set(a.wire.admissionToken,{p1:true,p2:true,catalog:'other-catalog'})
    const value=await buildRivenSnapshot(request([a]))
    assert.equal(value.mode,0);assert.equal(value.reason,'catalog_mismatch')
    assert.deepEqual(value.ackConnectionIds,[a.wire.connectionId])
    assert.equal(JSON.stringify(value.members).includes('15990001'),false)
    const module=load('lib/weapon-riven/multi-catalog'),manifest=require('../assets/weapon_riven_multi_catalog.json')
    const changed=structuredClone(manifest);changed.resources[0].sha256='0'.repeat(64)
    assert.throws(()=>module.verifyRivenCatalog(changed,path.resolve(__dirname,'../assets')),/RESOURCE_CHANGED/)
    assert.equal(resources.id,'riven-multi-v1-fcf6de9c6aee669eda6a0560be58b862')
})

test('owner catalog downgrade: disabledReason freezes a mode-0 catalog_mismatch snapshot with the full P2 ACK set',async()=>{
    const a=await member(1),b=await member(.5,1),input=request([a,b])
    const enabled=await handleRivenBusiness('riven.freeze',input)
    assert.equal(enabled.mode,1)
    const downgraded={...request([a,b]),disabledReason:'catalog_mismatch'}
    const value=await handleRivenBusiness('riven.freeze',downgraded)
    assert.equal(value.mode,0);assert.equal(value.catalog,'none');assert.equal(value.reason,'catalog_mismatch')
    assert.deepEqual(value.ackConnectionIds,[a.wire.connectionId,b.wire.connectionId])
    assert.equal(JSON.stringify(value.members).includes('15990001'),false)
    assert.ok(value.members.every(m=>m.party.weapon_riven_reason==='catalog_mismatch'&&m.party.weapon_riven_mode===0))
    assert.deepEqual(value.conversionLoadouts,enabled.conversionLoadouts,'unknown conversion kept')
    assert.equal(value.conversionLoadouts[1].loadout.abilitySoulIds[0],16000000)
    assert.deepEqual((await handleRivenBusiness('riven.validate',{identity:downgraded.identity,snapshotId:value.snapshotId})),{ok:true})
    // Same identity with a different decision input is a conflicting retry, never a silent reuse.
    await assert.rejects(handleRivenBusiness('riven.freeze',{...downgraded,disabledReason:undefined}),/PREPARATION_CONFLICT/)
    await assert.rejects(handleRivenBusiness('riven.freeze',{...request([a,b]),disabledReason:'client_rejected'}),/INVALID_DISABLED_REASON/)
    await handleRivenBusiness('riven.commit',{identity:downgraded.identity,snapshotId:value.snapshotId,battleSessionId:'battle-downgraded'})
    // A server-side reason still wins over the owner's request.
    caps.set(b.wire.admissionToken,{p1:true,p2:false,catalog:'none'})
    assert.equal((await buildRivenSnapshot({...request([a,b]),disabledReason:'catalog_mismatch'})).reason,'mixed_version')
})

test('gate on and no member holds any riven: no_rivens with an empty ACK set; any riven item keeps the normal decision',async()=>{
    const a=await member(1),b=await member(.5)
    for (const m of [a,b]) getDb().prepare('UPDATE players_parties SET ability_soul_1=NULL,ability_soul_2=NULL,ability_soul_3=NULL WHERE player_id=?').run(m.p.id)
    const input=request([a,b]),value=await handleRivenBusiness('riven.freeze',input)
    assert.equal(value.mode,0);assert.equal(value.reason,'no_rivens');assert.equal(value.catalog,'none')
    assert.deepEqual(value.ackConnectionIds,[])
    assert.deepEqual((await handleRivenBusiness('riven.validate',{identity:input.identity,snapshotId:value.snapshotId})),{ok:true})
    caps.set(b.wire.admissionToken,{p1:true,p2:false,catalog:'none'})
    assert.equal((await buildRivenSnapshot(request([a,b]))).reason,'no_rivens','mixed versions need no ACK either when nothing is held')
    caps.set(b.wire.admissionToken,{p1:true,p2:true,catalog:resources.id})
    for (const [column,item] of [['ability_soul_3',16000000],['ability_soul_2',16000901],['ability_soul_1',16000001]]) {
        getDb().prepare(`UPDATE players_parties SET ${column}=? WHERE player_id=?`).run(item,b.p.id)
        const held=await buildRivenSnapshot(request([a,b]))
        assert.equal(held.reason,'',`${item} is a riven`);assert.equal(held.mode,1)
        assert.deepEqual(held.ackConnectionIds,[a.wire.connectionId,b.wire.connectionId])
        getDb().prepare(`UPDATE players_parties SET ${column}=NULL WHERE player_id=?`).run(b.p.id)
    }
})
