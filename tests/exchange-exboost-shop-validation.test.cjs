const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const tempRoot = path.resolve(os.tmpdir())
const isolated = fs.mkdtempSync(path.join(tempRoot, 'startpoint-exchange-exboost-'))
process.env.DATA_DIR = isolated

const Fastify = require('fastify')
const exchangeRoutes = require('../out/routes/api/multiSpecialExchange').default
const exBoostRoutes = require('../out/routes/api/exBoost').default
const shopRoutes = require('../out/routes/api/shop').default
const { insertAccountSync } = require('../out/data/domains/account')
const { insertDefaultPlayerSync, getPlayerSync, updatePlayerSync } = require('../out/data/domains/player')
const { saveAccountDefaultPlayer } = require('../out/data/activeAccount')
const { insertSessionWithToken } = require('../out/data/domains/session')
const { getPlayerItemSync, setPlayerItemSync } = require('../out/data/domains/item')
const { getPlayerCharacterSync, updatePlayerCharacterSync } = require('../out/data/domains/character')
const {
    getPlayerMultiSpecialExchangeCampaignsSync,
    updatePlayerMultiSpecialExchangeCampaignSync,
} = require('../out/data/domains/campaign')
const { givePlayerCharacterSync } = require('../out/lib/character')
const { isMultiSpecialExchangeCharacter } = require('../out/lib/multi-special-exchange')
const { getDb } = require('../out/data/db')
const exchangeTable = require('../assets/multi_special_exchange_campaign_character.json')

let nextViewer = 77450100
async function createPlayer() {
    const account = insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'leiting', idpId: '', status: 'normal' })
    const player = insertDefaultPlayerSync(account.id)
    saveAccountDefaultPlayer(account.id, player.id)
    const viewer = nextViewer++
    await insertSessionWithToken({
        token: String(viewer), accountId: account.id, expires: new Date(Date.now() + 86_400_000), type: 2,
    })
    return { playerId: player.id, viewer }
}

test('交换券角色白名单、EX 抽取并发扣料与商店购买数量校验', async t => {
    const app = Fastify({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type') || '').startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await app.register(exchangeRoutes, { prefix: '/multi_special_exchange' })
    await app.register(exBoostRoutes, { prefix: '/ex_boost' })
    await app.register(shopRoutes, { prefix: '/shop' })
    await app.ready()
    t.after(async () => {
        await app.close()
        getDb().close()
        const target = path.resolve(isolated)
        assert.ok(target.startsWith(tempRoot + path.sep) && target !== tempRoot)
        fs.rmSync(target, { recursive: true, force: true })
    })

    const post = (url, payload) => app.inject({
        method: 'POST', url, headers: { 'content-type': 'application/json' }, payload,
    })
    const resultCode = res => JSON.parse(res.payload).data_headers.result_code

    await t.test('白名单与客户端主表一致（五张券，按券分组）', () => {
        assert.deepEqual(Object.keys(exchangeTable).sort(), ['980001', '980002', '980003', '980004', '980005'])
        assert.equal(exchangeTable['980005'].length, 152)
        assert.equal(isMultiSpecialExchangeCharacter(980005, 111015), true)
        assert.equal(isMultiSpecialExchangeCharacter(980001, 111015), false)
        assert.equal(isMultiSpecialExchangeCharacter(980007, 111015), false)
    })

    async function playerHoldingTicket(ticketItemId, campaignId) {
        const ctx = await createPlayer()
        updatePlayerMultiSpecialExchangeCampaignSync(ctx.playerId, { campaignId, status: 3, ticketItemId })
        setPlayerItemSync(ctx.playerId, ticketItemId, 1)
        return ctx
    }
    const exchange = (ctx, campaign_id, ticket_item_id, character_id) => post('/multi_special_exchange/exchange_character', {
        viewer_id: ctx.viewer, campaign_id, ticket_item_id, character_id, api_count: 1,
    })

    await t.test('券表外的角色被拒绝，券和活动状态保持不变', async () => {
        const ctx = await playerHoldingTicket(980005, 3)
        for (const characterId of [111015 + 999, 119999, 261089]) {
            if (isMultiSpecialExchangeCharacter(980005, characterId)) continue
            const res = await exchange(ctx, 3, 980005, characterId)
            assert.equal(res.statusCode, 200)
            assert.equal(resultCode(res), 4902)
            assert.equal(getPlayerCharacterSync(ctx.playerId, characterId), null)
        }
        assert.equal(getPlayerItemSync(ctx.playerId, 980005), 1)
        const campaign = getPlayerMultiSpecialExchangeCampaignsSync(ctx.playerId).find(c => c.campaignId === 3)
        assert.equal(campaign.status, 3)
        assert.equal(campaign.ticketItemId, 980005)
    })

    await t.test('券表内每个角色仍可正常兑换并扣除一张券', async () => {
        for (const [ticket, campaignId] of [['980005', 3], ['980004', 2], ['980001', 1]]) {
            for (const characterId of exchangeTable[ticket]) {
                const ctx = await playerHoldingTicket(Number(ticket), campaignId)
                const res = await exchange(ctx, campaignId, Number(ticket), characterId)
                assert.equal(res.statusCode, 200, res.payload)
                assert.equal(resultCode(res), 1, `${ticket}/${characterId}`)
                assert.ok(getPlayerCharacterSync(ctx.playerId, characterId), `${ticket}/${characterId} reward absent`)
                assert.equal(getPlayerItemSync(ctx.playerId, Number(ticket)), 0)
            }
        }
    })

    await t.test('同一张券上的角色不能跨券使用', async () => {
        const ctx = await playerHoldingTicket(980001, 1)
        const otherTicketOnly = exchangeTable['980002'].find(id => !exchangeTable['980001'].includes(id))
        const res = await exchange(ctx, 1, 980001, otherTicketOnly)
        assert.equal(resultCode(res), 4902)
        assert.equal(getPlayerItemSync(ctx.playerId, 980001), 1)
    })

    async function exBoostReadyPlayer(materialAmount) {
        const ctx = await createPlayer()
        assert.ok(givePlayerCharacterSync(ctx.playerId, 111015))
        updatePlayerCharacterSync(ctx.playerId, 111015, { overLimitStep: 4 })
        setPlayerItemSync(ctx.playerId, 10001, materialAmount)
        return ctx
    }
    const exDraw = (ctx, route) => post(`/ex_boost/${route}`, {
        viewer_id: ctx.viewer, character_id: 111015, cost_item_id: 10001, api_count: 1,
    })

    for (const route of ['draw', 'first_draw']) {
        await t.test(`EX ${route} 并发请求按实际余量依次扣料`, async () => {
            const ctx = await exBoostReadyPlayer(5)
            const results = await Promise.all([exDraw(ctx, route), exDraw(ctx, route), exDraw(ctx, route)])
            const ok = results.filter(r => r.statusCode === 200)
            const rejected = results.filter(r => r.statusCode === 400)
            assert.equal(ok.length, 1, results.map(r => r.payload).join('\n'))
            assert.equal(rejected.length, 2)
            for (const r of rejected) assert.equal(JSON.parse(r.payload).message, 'Not enough of item.')
            assert.equal(getPlayerItemSync(ctx.playerId, 10001), 0)
            assert.equal(JSON.parse(ok[0].payload).data.item_list['10001'], 0)
        })
    }

    await t.test('EX 抽取余量充足时并发请求各自扣料，结果与余量一致', async () => {
        const ctx = await exBoostReadyPlayer(15)
        const results = await Promise.all([exDraw(ctx, 'draw'), exDraw(ctx, 'draw'), exDraw(ctx, 'draw')])
        assert.deepEqual(results.map(r => r.statusCode), [200, 200, 200])
        const remaining = results.map(r => JSON.parse(r.payload).data.item_list['10001']).sort((a, b) => a - b)
        assert.deepEqual(remaining, [0, 5, 10])
        assert.equal(getPlayerItemSync(ctx.playerId, 10001), 0)
    })

    await t.test('EX 抽取前置校验的错误响应保持原样', async () => {
        const ctx = await exBoostReadyPlayer(5)
        updatePlayerCharacterSync(ctx.playerId, 111015, { overLimitStep: 3 })
        const notMax = await exDraw(ctx, 'draw')
        assert.equal(notMax.statusCode, 400)
        assert.equal(JSON.parse(notMax.payload).message, 'Character not at max over limit step.')
        const notOwned = await post('/ex_boost/draw', { viewer_id: ctx.viewer, character_id: 111009, cost_item_id: 10001, api_count: 1 })
        assert.equal(notOwned.statusCode, 400)
        assert.equal(JSON.parse(notOwned.payload).message, 'Player does not own character.')
        const badItem = await post('/ex_boost/draw', { viewer_id: ctx.viewer, character_id: 111015, cost_item_id: 1, api_count: 1 })
        assert.equal(badItem.statusCode, 400)
        assert.equal(JSON.parse(badItem.payload).message, 'Attempt to use invalid cost item.')
        assert.equal(getPlayerItemSync(ctx.playerId, 10001), 5)
    })

    await t.test('商店购买数量必须为正整数，非法数量返回 400 且不扣款', async () => {
        const ctx = await createPlayer()
        updatePlayerSync({ id: ctx.playerId, freeVmoney: 5_000_000, vmoney: 0 })
        const buy = number => post('/shop/buy', {
            viewer_id: ctx.viewer, api_count: 1, shop_type: 4, shop_item_id: 9700118, number,
        })
        for (const number of [1.5, 0, -2, 2 ** 60]) {
            const res = await buy(number)
            assert.equal(res.statusCode, 400, `${number}: ${res.payload}`)
            assert.equal(JSON.parse(res.payload).message, 'Invalid purchase amount.')
            assert.equal(getPlayerSync(ctx.playerId).freeVmoney, 5_000_000)
        }
        const ok = await buy(1)
        assert.equal(ok.statusCode, 200, ok.payload)
        assert.equal(getPlayerSync(ctx.playerId).freeVmoney, 0)
    })
})
