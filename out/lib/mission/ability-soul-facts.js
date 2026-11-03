"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countNewAbilitySoulEquipments = void 0;
function countNewAbilitySoulEquipments(previousIds, currentIds) {
    let count = 0;
    for (let slot = 0; slot < currentIds.length; slot++) {
        const nextId = currentIds[slot];
        if (Number.isSafeInteger(nextId)
            && Number(nextId) > 0
            && nextId !== previousIds[slot]) {
            count++;
        }
    }
    return count;
}
exports.countNewAbilitySoulEquipments = countNewAbilitySoulEquipments;
