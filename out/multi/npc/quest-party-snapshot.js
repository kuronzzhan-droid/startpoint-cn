"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureQuestNpcPartySnapshot = void 0;
const db_1 = require("../../data/db");
const types_1 = require("../../data/types");
const content_master_1 = require("../../lib/content-master");
const special_event_parties_1 = require("../../lib/special-event-parties");
const client_1 = require("../../lib/weapon-riven/client");
const quest_party_pool_shared_1 = require("./quest-party-pool-shared");
function wireId(option, field) {
    var _a;
    if (!Array.isArray(option))
        return undefined;
    if (option[0] === 1 && option.length === 1)
        return null;
    if (option[0] !== 0 || option.length !== 2)
        return undefined;
    const id = field ? (_a = option[1]) === null || _a === void 0 ? void 0 : _a[field] : option[1];
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
/** Capture before BATTLE, never reconstruct a clear from the mutable saved SET. */
function captureQuestNpcPartySnapshot(playerId, questCategory, questId, partySlot, party) {
    const selected = (0, special_event_parties_1.parseGlobalPartyId)(partySlot);
    if (!selected || !(0, quest_party_pool_shared_1.isQuestNpcPartyPoolEligibleCategory)(questCategory) || !party)
        return null;
    party = (0, client_1.stripWeaponRivenPartySouls)(party);
    const fields = [
        ["characters", "character_id", "id"],
        ["unison_characters", "unison_character", "id"],
        ["equipments", "equipment", "equipmentId"],
        ["abilitySoulIds", "ability_soul", undefined],
    ];
    if (fields.some(([field]) => !Array.isArray(party[field]) || party[field].length !== 3))
        return null;
    const saved = (0, db_1.getDb)().prepare(`
        SELECT character_id_1, character_id_2, character_id_3,
            unison_character_1, unison_character_2, unison_character_3,
            equipment_1, equipment_2, equipment_3,
            ability_soul_1, ability_soul_2, ability_soul_3, current_battle_power
        FROM players_parties
        WHERE player_id = ? AND category = ? AND group_id = ? AND slot = ?
        LIMIT 1
    `).get(playerId, types_1.PartyCategory.NORMAL, selected.groupId, selected.slot);
    const battlePower = Number(saved === null || saved === void 0 ? void 0 : saved.current_battle_power);
    if (!saved || !Number.isFinite(battlePower) || battlePower < quest_party_pool_shared_1.QUEST_NPC_POOL_MIN_POWER)
        return null;
    const characterIds = [];
    for (const [field, column, idField] of fields) {
        for (let slot = 0; slot < 3; slot++) {
            const id = wireId(party[field][slot], idField);
            const rawSavedId = saved[`${column}_${slot + 1}`] || null;
            const savedId = field === "abilitySoulIds" && (0, client_1.isWeaponRivenInstanceId)(rawSavedId) ? null : rawSavedId;
            if (id === undefined || id !== savedId || (field === "characters" && id === null))
                return null;
            if (id !== null && (field === "characters" || field === "unison_characters"))
                characterIds.push(id);
        }
    }
    const elements = characterIds.map(id => { var _a; return (_a = content_master_1.serverCharacters[String(id)]) === null || _a === void 0 ? void 0 : _a.element; });
    const partyElement = elements.every(element => Number.isInteger(element) && element === elements[0])
        ? Number(elements[0]) : null;
    return (0, quest_party_pool_shared_1.cloneQuestNpcPartySnapshot)({
        questCategory, questId, sourcePlayerId: playerId, partySlot, battlePower,
        partyElement, clearedAt: 0, party,
    });
}
exports.captureQuestNpcPartySnapshot = captureQuestNpcPartySnapshot;
