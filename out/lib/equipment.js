"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.givePlayerEquipmentSync = exports.buildFullEquipmentList = exports.clientSerializeEquipment = void 0;
const equipment_1 = require("../data/domains/equipment");
/**
 * Serializes a PlayerEquipment object for sending to the game client.
 *
 * @param equipmentId The ID of the equipment to serialize.
 * @param toSerialize The data of the equipment to serialize.
 * @returns A serialized equipment object for returning to the game client.
 */
function clientSerializeEquipment(equipmentId, toSerialize) {
    return {
        "equipment_id": equipmentId,
        "protection": toSerialize.protection,
        "level": toSerialize.level,
        "enhancement_level": toSerialize.enhancementLevel,
        "stack": toSerialize.stack
    };
}
exports.clientSerializeEquipment = clientSerializeEquipment;
/**
 * Builds a full equipment list array for client response.
 * Used by all equipment endpoints (sell, upgrade, dismantle) to return a
 * complete snapshot of the player's equipment after any modifications.
 */
function buildFullEquipmentList(playerId) {
    const allEquipment = (0, equipment_1.getPlayerEquipmentListSync)(playerId);
    const list = [];
    for (const [equipId, equip] of Object.entries(allEquipment)) {
        list.push(clientSerializeEquipment(parseInt(equipId), equip));
    }
    return list;
}
exports.buildFullEquipmentList = buildFullEquipmentList;
/**
 * Gives a player an amount of equipment.
 *
 * @param playerId The ID of the player to give the equipment to.
 * @param equipmentId The ID of the equipment to give.
 * @param amount The amount of equipment to give.
 * @returns A serialized equipment object for returning to the game client.
 */
function givePlayerEquipmentSync(playerId, equipmentId, amount) {
    amount = Math.abs(amount); // ensure that amount isn't negative.
    let owned = (0, equipment_1.getPlayerEquipmentSync)(playerId, equipmentId);
    if (owned === null) {
        // insert into inventory since it's not owned.
        owned = {
            enhancementLevel: 0,
            level: 1,
            protection: false,
            stack: amount - 1
        };
        (0, equipment_1.insertPlayerEquipmentSync)(playerId, equipmentId, owned);
    }
    else {
        // simply increase the stack
        const newStack = owned.stack + amount;
        (0, equipment_1.updatePlayerEquipmentSync)(playerId, equipmentId, {
            stack: newStack
        });
        owned.stack = newStack;
    }
    return clientSerializeEquipment(equipmentId, owned);
}
exports.givePlayerEquipmentSync = givePlayerEquipmentSync;
