// Fresh process: only persisted progress survives; there is no lounge room.
const assert = require('node:assert/strict')
const path = require('node:path')
const [root, mode, rawGroup, rawAccess] = process.argv.slice(2)
if (mode === 'src') require('ts-node/register/transpile-only')
const load = name => require(path.join(root, mode, name))
const interval = global.setInterval
global.setInterval = (...args) => { const timer = interval(...args); timer.unref(); return timer }
const app = require('fastify')()
const db = load('data/db'), item = load('data/domains/item')
app.addHook('onSend', (_r, reply, payload, done) => done(null,
    String(reply.getHeader('content-type') || '').startsWith('application/x-msgpack') && typeof payload === 'object'
        ? JSON.stringify(payload) : payload))
async function main() {
    await app.register(load('routes/cn/load').default)
    await app.register(load('routes/api/lounge').default, { prefix: '/lounge' })
    await app.register(load('routes/api/multiSpecialExchange').default, { prefix: '/exchange' })
    const post = async (url, payload) => (await app.inject({ method: 'POST', url, payload })).json()
    for (const player of JSON.parse(rawGroup)) {
        const loaded = await post('/load', { viewer_id: player.viewer })
        const saved = loaded.data.multi_special_exchange_campaign_list.find(c => c.campaign_id === player.campaignId)
        assert.equal(saved.status, 2)
        assert.equal(saved.ticket_item_id, player.ticketItemId)
        const restored = await post('/lounge/restore', { ...JSON.parse(rawAccess), viewer_id: player.viewer })
        assert.equal(restored.data_headers.result_code, 1)
        assert.equal(restored.data.raising_state, 99)
        const responses = await Promise.all([1, 2].map(() => post('/exchange/multi_draw_ticket',
            { viewer_id: player.viewer, campaign_id: player.campaignId })))
        for (const response of responses) {
            assert.equal(response.data.multi_special_exchange_campaign_list[0].ticket_item_id, player.ticketItemId)
        }
        assert.equal(item.getPlayerItemSync(player.playerId, player.ticketItemId), 1)
    }
    await app.close()
    await load('multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker()
    db.getDb().close()
    console.log('FRESH_PROCESS_RECOVERY_PASSED')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
