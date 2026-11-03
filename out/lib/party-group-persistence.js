"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertMissingPartyGroupListSync = void 0;
const party_limit_1 = require("./weapon-riven/party-limit");
function insertMissingPartySync(db, playerId, groupId, slot, party) {
    var _a, _b;
    const souls = (0, party_limit_1.limitWeaponRivenPartySouls)(party.abilitySoulIds);
    db.prepare(`
    INSERT OR IGNORE INTO players_parties (slot, name, character_id_1, character_id_2, character_id_3,
        unison_character_1, unison_character_2, unison_character_3, equipment_1, equipment_2,
        equipment_3, ability_soul_1, ability_soul_2, ability_soul_3, edited, player_id, group_id, category,
        current_battle_power, before_battle_power)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(Number(slot), party.name, party.characterIds[0] || null, party.characterIds[1] || null, party.characterIds[2] || null, party.unisonCharacterIds[0] || null, party.unisonCharacterIds[1] || null, party.unisonCharacterIds[2] || null, party.equipmentIds[0] || null, party.equipmentIds[1] || null, party.equipmentIds[2] || null, souls[0] || null, souls[1] || null, souls[2] || null, party.edited ? 1 : 0, playerId, Number(groupId), party.category, (_a = party.currentBattlePower) !== null && _a !== void 0 ? _a : 0, (_b = party.beforeBattlePower) !== null && _b !== void 0 ? _b : 0);
}
function insertMissingPartyGroupListSync(db, playerId, groups) {
    const insertGroup = db.prepare(`
    INSERT OR IGNORE INTO players_party_groups (id, color_id, player_id, category)
    VALUES (?, ?, ?, ?)
    `);
    db.transaction(() => {
        for (const [groupId, group] of Object.entries(groups)) {
            insertGroup.run(Number(groupId), group.colorId, playerId, group.category);
            for (const [slot, party] of Object.entries(group.list)) {
                insertMissingPartySync(db, playerId, groupId, slot, party);
            }
        }
    })();
}
exports.insertMissingPartyGroupListSync = insertMissingPartyGroupListSync;
