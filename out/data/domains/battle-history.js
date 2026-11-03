"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.battleHistoryProtocolValues = exports.BATTLE_HISTORY_COLUMNS = void 0;
exports.BATTLE_HISTORY_COLUMNS = `
    ability_soul_id_1, ability_soul_id_2, ability_soul_id_3,
    category_id,
    character_1_total_damage, character_2_total_damage, character_3_total_damage,
    character_id_1, character_id_2, character_id_3,
    clear_rank, create_time, elapsed_time_ms,
    enhancement_level_1, enhancement_level_2, enhancement_level_3,
    equipment1_id, equipment2_id, equipment3_id,
    equipment_level_1, equipment_level_2, equipment_level_3,
    finish_kind, quest_id, score, total_damage,
    unison_character_id_1, unison_character_id_2, unison_character_id_3
`;
function battleHistoryProtocolValues(record) {
    return [
        record.ability_soul_id_1, record.ability_soul_id_2, record.ability_soul_id_3,
        record.category_id,
        record.character_1_total_damage, record.character_2_total_damage,
        record.character_3_total_damage,
        record.character_id_1, record.character_id_2, record.character_id_3,
        record.clear_rank, record.create_time, record.elapsed_time_ms,
        record.enhancement_level_1, record.enhancement_level_2, record.enhancement_level_3,
        record.equipment1_id, record.equipment2_id, record.equipment3_id,
        record.equipment_level_1, record.equipment_level_2, record.equipment_level_3,
        record.finish_kind, record.quest_id, record.score, record.total_damage,
        record.unison_character_id_1, record.unison_character_id_2,
        record.unison_character_id_3,
    ];
}
exports.battleHistoryProtocolValues = battleHistoryProtocolValues;
