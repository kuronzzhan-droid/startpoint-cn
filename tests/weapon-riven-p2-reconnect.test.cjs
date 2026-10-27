'use strict'
process.env.MULTI_REALTIME_PROCESS = '0'
const { test, after } = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { fixture, Wire, load, until } = require('./helpers/weapon-riven-p2-wire.cjs')
after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })
function credentials(build, session) {
    const admission = load('lib/client-admission'), gate = admission.clientAdmission(), ip = `reconnect-${build}`
    const challenge = gate.challenge({ build, protocol: 1 }, ip).data
    const proof = crypto.createHmac('sha256', Buffer.from('7a'.repeat(32), 'hex'))
        .update(admission.proofMessage(build, challenge.challenge, challenge.nonce)).digest('hex')
    const token = gate.prove({ challenge: challenge.challenge, proof }, ip).data.token
    gate.bind(token, session); return token
}

test('same-battle authenticated reconnect preserves frozen Start and rejects new sockets missing P2 or using another catalog', { timeout: 20000 }, async t => {
    const x = await fixture(t); await x.prepare(); const prepared = structuredClone(x.wires[0].latest())
    x.wires.forEach(wire => wire.ack()); await x.started()
    await Promise.all(x.members.map(member => x.startHttp(member)))
    const battle = await x.battle(), member = x.members[0]
    const restored = new Wire(x.port, member, x.room, true); x.wires.push(restored); await restored.open()
    assert.ok(restored.frames.some(frame => frame[0] === 0), 'compatible authenticated new socket restores its existing seat')
    for (const build of ['p1-wire', 'p2-other']) {
        const changed = new Wire(x.port, { ...member, admissionToken: credentials(build, member.session) }, x.room, true)
        x.wires.push(changed)
        await until(() => !changed.socket.connecting, 'new incompatible socket connected')
        changed.send({ socklet: 'cooperation_battle', room_number: x.room, connection_id: member.cid,
            sp_admission: changed.member.admissionToken, sp_session: member.session })
        await until(() => changed.closed || changed.frames.some(frame => frame[0] === 3), 'incompatible reconnect rejected')
        assert.equal(changed.frames.some(frame => frame[0] === 0), false)
        assert.deepEqual(x.wires[0].messages(5)[0][1][1], prepared)
        assert.equal(x.wires[0].messages(5).length, 1, 'incompatible reconnect does not rewrite or resend Start')
    }
    const room = load('multi/room/manager').getRoom(x.room)
    assert.equal(room.lifecycle.phase, 'BATTLE')
    assert.ok(battle[1].socket.writable)
})
