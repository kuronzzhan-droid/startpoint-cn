'use strict'
const assert = require('node:assert/strict')

function seedParty(load, playerId, quality = 1, slot = 0, key = 15990001) {
    const equipmentIds = require('../../assets/equipment_ids.json')
    const weaponId = [2010002, 300101, 100001].find(id => Array.isArray(equipmentIds)
        ? equipmentIds.includes(id) || equipmentIds.includes(String(id)) : id in equipmentIds)
        ?? Number(Array.isArray(equipmentIds) ? equipmentIds[0] : Object.keys(equipmentIds)[0])
    assert.ok(Number.isSafeInteger(weaponId) && weaponId > 0)
    const { getDb } = load('data/db'), db = getDb()
    const insert = load('data/domains/weaponRiven').insertWeaponRivenSync
    const itemId = load('lib/persistence-coordinator').runPersistenceTransactionSync(
        { domain: 'player', playerId, operation: 'isolated_p2_fixture' }, () =>
            insert(playerId, weaponId, [[key, quality]], 'isolated-p2-fixture', () => 0, 3))
    assert.equal(itemId, 16000001)
    load('lib/character').givePlayerCharacterSync(playerId, 111001)
    const equipment = load('data/domains/equipment')
    if (!equipment.getPlayerEquipmentSync(playerId, weaponId)) equipment.insertPlayerEquipmentSync(playerId, weaponId,
        { level: 1, enhancementLevel: 0, protection: false, stack: 1 })
    const souls = [null, null, null], weapons = [null, null, null], characters = [null, null, null]
    souls[slot] = itemId; weapons[slot] = weaponId; characters[slot] = 111001
    load('data/domains/party').updatePlayerPartySync(playerId, 1, { category: 1, name: 'Riven P2 local fixture',
        characterIds: characters, unisonCharacterIds: [null, null, null], equipmentIds: weapons,
        abilitySoulIds: souls, edited: true, options: { allowOtherPlayersToHealMe: true } }, 1)
    load('data/domains/player').updatePlayerSync({ id: playerId, stamina: 100, staminaHealTime: new Date() })
    const fiveBoss = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET
    load('data/domains/item').setPlayerItemSync(playerId, fiveBoss.ticketItemId, 5)
    const view = load('data/domains/weaponRiven').getPlayerWeaponRivenSync(playerId, itemId)
    return { playerId, itemId, rivenId: view.riven_id, weaponId, slot, key, quality, level: view.affixes[0][1] }
}
module.exports = { seedParty }
