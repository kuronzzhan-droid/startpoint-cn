"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGachaTicketCost = exports.GACHA_TICKET_ITEM_IDS = void 0;
const gacha_rules_1 = require("./gacha-rules");
exports.GACHA_TICKET_ITEM_IDS = {
    characterMulti: 999001,
    characterSingle: 999003,
    equipmentMulti: 999004,
    equipmentSingle: 999005,
};
function getFallbackTicketItemId(gacha, type) {
    if (gacha && !gacha.wildcardTicketAvailable)
        return null;
    switch (type) {
        case gacha_rules_1.GACHA_EXEC_TYPES.WILDCARD_CHARACTER_MULTI_TICKET:
            return exports.GACHA_TICKET_ITEM_IDS.characterMulti;
        case gacha_rules_1.GACHA_EXEC_TYPES.WILDCARD_CHARACTER_SINGLE_TICKET:
            return exports.GACHA_TICKET_ITEM_IDS.characterSingle;
        case gacha_rules_1.GACHA_EXEC_TYPES.WILDCARD_EQUIPMENT_SINGLE_TICKET:
            return exports.GACHA_TICKET_ITEM_IDS.equipmentSingle;
        case gacha_rules_1.GACHA_EXEC_TYPES.WILDCARD_EQUIPMENT_MULTI_TICKET:
            return exports.GACHA_TICKET_ITEM_IDS.equipmentMulti;
        default:
            return null;
    }
}
function getConfiguredTicketItemId(gacha, type) {
    if (!gacha)
        return getFallbackTicketItemId(undefined, type);
    if (!(0, gacha_rules_1.ticketExecMatchesGachaType)(type, gacha))
        return null;
    if (type === gacha_rules_1.GACHA_EXEC_TYPES.CONFIGURED_SINGLE_TICKET) {
        return gacha.onceTicketItemId || null;
    }
    if (type === gacha_rules_1.GACHA_EXEC_TYPES.CONFIGURED_MULTI_TICKET) {
        return gacha.tenTicketItemId || null;
    }
    return getFallbackTicketItemId(gacha, type);
}
function getGachaTicketCost(type, numberOfExec, gacha) {
    const useTicketCount = Math.max(1, numberOfExec);
    const itemId = getConfiguredTicketItemId(gacha, type);
    if (itemId === null)
        return null;
    switch (type) {
        case gacha_rules_1.GACHA_EXEC_TYPES.CONFIGURED_MULTI_TICKET:
        case gacha_rules_1.GACHA_EXEC_TYPES.WILDCARD_CHARACTER_MULTI_TICKET:
        case gacha_rules_1.GACHA_EXEC_TYPES.WILDCARD_EQUIPMENT_MULTI_TICKET:
            return {
                itemId,
                useTicketCount,
                pullCount: useTicketCount * 10,
            };
        case gacha_rules_1.GACHA_EXEC_TYPES.CONFIGURED_SINGLE_TICKET:
        case gacha_rules_1.GACHA_EXEC_TYPES.WILDCARD_CHARACTER_SINGLE_TICKET:
        case gacha_rules_1.GACHA_EXEC_TYPES.WILDCARD_EQUIPMENT_SINGLE_TICKET:
            return {
                itemId,
                useTicketCount,
                pullCount: useTicketCount,
            };
        default:
            return null;
    }
}
exports.getGachaTicketCost = getGachaTicketCost;
