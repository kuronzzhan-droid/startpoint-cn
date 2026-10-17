const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-character-reward-'));
process.env.DATA_DIR = path.join(directory, 'database');
process.env.GACHA_SEED_DIR = path.join(directory, 'seeds');
process.env.GAME_VERBOSE_LOGS = 'false';
fs.mkdirSync(process.env.GACHA_SEED_DIR);

const Fastify = require('fastify');
const { pack, unpack } = require('msgpackr');
const { getDb } = require('../out/data/db');
const { insertAccountSync } = require('../out/data/domains/account');
const { insertDefaultPlayerSync } = require('../out/data/domains/player');
const characters = require('../out/data/domains/character');
const items = require('../out/data/domains/item');
const { getPlayerShopPurchaseCountSync } = require('../out/data/domains/shopPurchase');
const { insertSessionWithToken } = require('../out/data/domains/session');
const { saveAccountDefaultPlayer } = require('../out/data/activeAccount');
const { givePlayerRewardsSync } = require('../out/lib/quest');
const { getShopPurchaseKey } = require('../out/lib/shop-sales');
const { RewardType, ShopType, ShopItemRewardType } = require('../out/lib/types');
const catalog = require('../assets/star_grain_shop.json');
const products = Object.entries(catalog).filter(([, value]) =>
    value.rewards.some(reward => reward.type === ShopItemRewardType.CHARACTER));
const characterId = product => product.rewards.find(reward =>
    reward.type === ShopItemRewardType.CHARACTER).id;
const [repeatableId, repeatableProduct] = products.find(([, product]) => product.stock > 1);
const firstCharacterId = characterId(repeatableProduct);
const secondCharacterId = characterId(products.find(([, product]) =>
    characterId(product) !== firstCharacterId)[1]);
const initialGrains = 100_000;
const app = Fastify({ logger: false });

// Match production's binary response contract instead of substituting JSON.
app.addHook('onSend', (_request, reply, body, done) => done(null,
    String(reply.getHeader('content-type')).startsWith('application/x-msgpack')
        && typeof body === 'object' ? pack(body) : body));

test.before(async () => {
    await app.register(require('../out/routes/api/shop').default, { prefix: '/shop' });
    await app.ready();
});
test.after(async () => {
    await app.close();
    const seedModule = require.cache[require.resolve('../out/lib/seed-validator')];
    if (seedModule) await seedModule.exports.default.close();
    getDb().close();
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(directory, { recursive: true });
});

let sequence = 0;
async function freshPlayer() {
    const account = insertAccountSync({
        appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `shop-character-${++sequence}`, status: 'normal',
    });
    const player = insertDefaultPlayerSync(account.id);
    saveAccountDefaultPlayer(account.id, player.id);
    const viewerId = 870000000 + player.id;
    await insertSessionWithToken({
        token: String(viewerId), accountId: account.id,
        expires: new Date(Date.now() + 86_400_000), type: 2,
    });
    items.givePlayerItemSync(player.id, 990008, initialGrains);
    return { id: player.id, viewerId };
}

function reward(id) { return { type: RewardType.CHARACTER, id }; }
function assertNewCharacter(entry, id, stack) {
    assert.equal(entry.character_id, id);
    for (const key of ['entry_count', 'exp', 'exp_total', 'bond_token_list',
        'mana_board_index', 'create_time', 'update_time', 'join_time']) {
        assert.ok(Object.hasOwn(entry, key), `missing ${key}`);
    }
    assert.equal(entry.entry_count, 1);
    assert.equal(entry.exp, 0);
    assert.equal(entry.exp_total, 0);
    assert.equal(entry.mana_board_index, 1);
    assert.equal(entry.stack ?? 0, stack);
    assert.ok(entry.bond_token_list.length > 0);
}
function assertPersistedCharacter(playerId, id, stack) {
    const character = characters.getPlayerCharacterSync(playerId, id);
    assert.ok(character);
    assert.equal(character.stack, stack);
    assert.equal(character.entryCount, 1);
}
function assertInventoryTotals(playerId, returnedItems) {
    for (const [id, count] of Object.entries(returnedItems)) {
        assert.equal(items.getPlayerItemSync(playerId, Number(id)), count);
    }
}
function assertPurchase(player, shopItemId, product, quantity, returnedItems) {
    assert.equal(items.getPlayerItemSync(player.id, 990008),
        initialGrains - product.costs[0].amount * quantity);
    assert.equal(getPlayerShopPurchaseCountSync(player.id,
        getShopPurchaseKey(ShopType.STAR_GRAIN, Number(shopItemId))), quantity);
    assertInventoryTotals(player.id, returnedItems);
}
async function buy(player, shopItemId, quantity, bulk = false) {
    return app.inject({
        method: 'POST', url: bulk ? '/shop/bulk_buy' : '/shop/buy',
        payload: {
            viewer_id: player.viewerId, api_count: 1, shop_type: ShopType.STAR_GRAIN,
            ...(bulk ? { buy_item_list: { [shopItemId]: quantity } }
                : { shop_item_id: Number(shopItemId), number: quantity }),
        },
    });
}
function data(response) {
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.headers['content-type'], /^application\/x-msgpack/);
    return unpack(response.rawPayload).data;
}

for (const [shopItemId, product] of products) {
    const id = characterId(product);
    test(`first single character purchase retains creation fields: ${shopItemId}`, async () => {
        const player = await freshPlayer();
        assert.equal(characters.getPlayerCharacterSync(player.id, id), null);
        const result = data(await buy(player, shopItemId, 1));
        assert.equal(result.character_list.length, 1);
        assertNewCharacter(result.character_list[0], id, 0);
        assertPersistedCharacter(player.id, id, 0);
        assertPurchase(player, shopItemId, product, 1, result.item_list);
    });
    if (product.stock > 1) {
        test(`first multiple character purchase retains creation fields and final stack: ${shopItemId}`, async () => {
            const player = await freshPlayer();
            const quantity = product.stock;
            const result = data(await buy(player, shopItemId, quantity));
            assert.equal(result.character_list.length, 1);
            assertNewCharacter(result.character_list[0], id, quantity - 1);
            assertPersistedCharacter(player.id, id, quantity - 1);
            assertPurchase(player, shopItemId, product, quantity, result.item_list);
            assert.equal((await buy(player, shopItemId, 1)).statusCode, 400);
            assertPersistedCharacter(player.id, id, quantity - 1);
            assertPurchase(player, shopItemId, product, quantity, result.item_list);
        });
    }
}

test('bulk first character purchase retains creation fields and final stack', async () => {
    const player = await freshPlayer();
    const result = data(await buy(player, repeatableId, 3, true));
    assert.equal(result.character_list.length, 1);
    assertNewCharacter(result.character_list[0], firstCharacterId, 2);
    assertPersistedCharacter(player.id, firstCharacterId, 2);
    assertPurchase(player, repeatableId, repeatableProduct, 3, result.item_list);
});

test('interleaved character IDs retain independent fields, final stacks and duplicate compensation', async () => {
    const player = await freshPlayer();
    const result = unpack(pack(givePlayerRewardsSync(player.id, [
        reward(firstCharacterId), reward(secondCharacterId), reward(firstCharacterId),
        reward(secondCharacterId), reward(firstCharacterId),
    ])));
    assert.deepEqual(result.character_list.map(entry => entry.character_id),
        [firstCharacterId, secondCharacterId]);
    assertNewCharacter(result.character_list[0], firstCharacterId, 2);
    assertNewCharacter(result.character_list[1], secondCharacterId, 1);
    assertPersistedCharacter(player.id, firstCharacterId, 2);
    assertPersistedCharacter(player.id, secondCharacterId, 1);
    assertInventoryTotals(player.id, result.items);
    assert.equal(Object.values(result.items).reduce((sum, count) => sum + count, 0), 3);
});

test('existing trained character keeps progression, protection, EX, bond tokens and mana nodes', async () => {
    const player = await freshPlayer();
    givePlayerRewardsSync(player.id, [reward(firstCharacterId)]);
    characters.updatePlayerCharacterSync(player.id, firstCharacterId, {
        entryCount: 3, evolutionLevel: 1, overLimitStep: 4, protection: true,
        exp: 123456, stack: 7, manaBoardIndex: 2,
        exBoost: { statusId: 1001, abilityIdList: [1002, 1003] },
        illustrationSettings: [1, 0],
    });
    characters.updatePlayerCharacterBondTokenSync(player.id, firstCharacterId,
        { manaBoardIndex: 1, status: 2 });
    characters.insertPlayerCharacterManaNodesSync(player.id, firstCharacterId, [1, 2]);
    const before = characters.getPlayerCharacterSync(player.id, firstCharacterId);
    const nodes = characters.getPlayerCharactersManaNodesSync(player.id);
    const result = data(await buy(player, repeatableId, 3));
    assert.equal(result.character_list.length, 1);
    assert.equal(result.character_list[0].stack, 10);
    // Existing ownership must remain a partial update, never reset to new defaults.
    for (const key of ['entry_count', 'exp', 'exp_total', 'bond_token_list', 'mana_board_index']) {
        assert.equal(Object.hasOwn(result.character_list[0], key), false, key);
    }
    const after = characters.getPlayerCharacterSync(player.id, firstCharacterId);
    assert.deepEqual({ ...after, stack: before.stack, updateTime: before.updateTime }, before);
    assert.deepEqual(characters.getPlayerCharactersManaNodesSync(player.id), nodes);
    assertPurchase(player, repeatableId, repeatableProduct, 3, result.item_list);
});

test('unknown character between valid copies cannot discard valid creation data', async () => {
    const player = await freshPlayer();
    const result = givePlayerRewardsSync(player.id, [
        reward(firstCharacterId), reward(999999999), reward(firstCharacterId),
    ]);
    assert.equal(result.character_list.length, 1);
    assertNewCharacter(result.character_list[0], firstCharacterId, 1);
    assertPersistedCharacter(player.id, firstCharacterId, 1);
});
