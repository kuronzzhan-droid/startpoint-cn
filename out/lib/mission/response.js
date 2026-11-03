"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeMissionSettlementResponse = void 0;
function mergeCharacterList(existing, added) {
    var _a, _b;
    const result = existing.map(character => (Object.assign({}, character)));
    const indexById = new Map();
    for (let index = 0; index < result.length; index++) {
        const id = Number((_a = result[index].character_id) !== null && _a !== void 0 ? _a : result[index].id);
        if (Number.isFinite(id))
            indexById.set(id, index);
    }
    for (const rawCharacter of added) {
        const character = Object.assign({}, rawCharacter);
        const id = Number((_b = character.character_id) !== null && _b !== void 0 ? _b : character.id);
        const existingIndex = indexById.get(id);
        if (existingIndex === undefined || !Number.isFinite(id)) {
            result.push(character);
            if (Number.isFinite(id))
                indexById.set(id, result.length - 1);
            continue;
        }
        const previous = result[existingIndex];
        const previousAwake = previous.mana_board_awake;
        const nextAwake = character.mana_board_awake;
        result[existingIndex] = Object.assign(Object.assign(Object.assign({}, previous), character), (previousAwake || nextAwake
            ? { mana_board_awake: Object.assign(Object.assign({}, (previousAwake !== null && previousAwake !== void 0 ? previousAwake : {})), (nextAwake !== null && nextAwake !== void 0 ? nextAwake : {})) }
            : {}));
    }
    return result;
}
function mergeEquipmentList(existing, added) {
    var _a, _b;
    const result = existing.map(equipment => (Object.assign({}, equipment)));
    const indexById = new Map();
    for (let index = 0; index < result.length; index++) {
        const id = Number((_a = result[index].equipment_id) !== null && _a !== void 0 ? _a : result[index].id);
        if (Number.isFinite(id))
            indexById.set(id, index);
    }
    for (const rawEquipment of added) {
        const equipment = Object.assign({}, rawEquipment);
        const id = Number((_b = equipment.equipment_id) !== null && _b !== void 0 ? _b : equipment.id);
        const existingIndex = indexById.get(id);
        if (existingIndex === undefined || !Number.isFinite(id)) {
            result.push(equipment);
            if (Number.isFinite(id))
                indexById.set(id, result.length - 1);
        }
        else {
            result[existingIndex] = Object.assign(Object.assign({}, result[existingIndex]), equipment);
        }
    }
    return result;
}
function mergeMissionSettlementResponse(data, settlement, viewerId) {
    var _a, _b, _c, _d, _e, _f;
    data.mission_info = [...((_a = data.mission_info) !== null && _a !== void 0 ? _a : []), ...settlement.missionInfo];
    data.item_list = Object.assign(Object.assign({}, ((_b = data.item_list) !== null && _b !== void 0 ? _b : {})), settlement.itemList);
    data.character_list = mergeCharacterList((_c = data.character_list) !== null && _c !== void 0 ? _c : [], settlement.characterList);
    data.equipment_list = mergeEquipmentList((_d = data.equipment_list) !== null && _d !== void 0 ? _d : [], settlement.equipmentList);
    if (settlement.userInfo) {
        data.user_info = Object.assign(Object.assign({}, ((_e = data.user_info) !== null && _e !== void 0 ? _e : {})), settlement.userInfo);
    }
    const degreeById = new Map();
    for (const degree of (_f = data.degree_list) !== null && _f !== void 0 ? _f : []) {
        const degreeId = Number(degree.degree_id);
        if (Number.isFinite(degreeId))
            degreeById.set(degreeId, degree);
    }
    for (const degreeId of settlement.degreeIds) {
        degreeById.set(degreeId, { viewer_id: viewerId, degree_id: degreeId });
    }
    data.degree_list = [...degreeById.values()];
}
exports.mergeMissionSettlementResponse = mergeMissionSettlementResponse;
