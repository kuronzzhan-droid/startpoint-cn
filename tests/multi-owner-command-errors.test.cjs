const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const { installRealtimeHttpFailureHandler } = require(path.join(out, 'multi/http/command-error'))
const { RoomCommandError } = require(path.join(out, 'multi/coordinator/command-protocol'))

test('unknown, busy and closed owner responses use native unavailable wire without reporting dissolved rooms', async t => {
    const app = require('fastify')()
    t.after(() => app.close())
    app.addHook('onSend', (_req, reply, payload, done) => done(null, reply.getHeader('content-type') === 'application/x-msgpack' ? JSON.stringify(payload) : payload))
    installRealtimeHttpFailureHandler(app)
    let calls = 0
    app.post('/restore', async req => { calls++; throw new RoomCommandError(req.body.code, 'unavailable', 'original-id', req.body.unknown) })
    for (const [code, unknown] of [['OUTCOME_UNKNOWN', true], ['PENDING_BUDGET', false], ['GATEWAY_CLOSED', false]]) {
        const response = await app.inject({ method: 'POST', url: '/restore', payload: { viewer_id: 77, code, unknown } })
        assert.equal(response.statusCode, 200)
        assert.equal(response.headers['content-type'].split(';')[0], 'application/x-msgpack')
        assert.equal(response.json().data_headers.result_code, 4050)
        assert.deepEqual(response.json().data, {})
    }
    assert.equal(calls, 3, 'mapping the failure must not issue a retry or create a replacement authority')
})
test('unrelated validation and business exceptions retain the original Fastify error handler', async t => {
    const app = require('fastify')(); t.after(() => app.close())
    installRealtimeHttpFailureHandler(app)
    app.get('/business', async () => { throw Error('business failure') })
    app.get('/invalid', async () => { throw Object.assign(Error('invalid input'), { statusCode: 400 }) })
    const business = await app.inject('/business'), invalid = await app.inject('/invalid')
    assert.equal(business.statusCode, 500); assert.equal(invalid.statusCode, 400)
    assert.equal(business.json().data_headers, undefined)
})
