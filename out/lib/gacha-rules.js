"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExchangeableGachaItem = exports.getGachaPoolItem = exports.isGachaExecAllowed = exports.ticketExecMatchesGachaType = exports.getTicketDrawKind = exports.GACHA_PAGE_KINDS = exports.GACHA_EXEC_TYPES = exports.GACHA_PAYMENT_TYPES = void 0;
const types_1 = require("./types");
exports.GACHA_PAYMENT_TYPES = {
    FREE_VMONEY: 1,
    VMONEY: 2,
    TICKET: 3,
    CAMPAIGN: 4,
};
exports.GACHA_EXEC_TYPES = {
    VMONEY_SINGLE: 1,
    VMONEY_MULTI: 2,
    CONFIGURED_SINGLE_TICKET: 3,
    CONFIGURED_MULTI_TICKET: 4,
    DAILY_SINGLE: 5,
    CAMPAIGN_SINGLE: 7,
    CAMPAIGN_MULTI: 8,
    WILDCARD_CHARACTER_MULTI_TICKET: 9,
    WILDCARD_CHARACTER_SINGLE_TICKET: 10,
    WILDCARD_EQUIPMENT_SINGLE_TICKET: 12,
    WILDCARD_EQUIPMENT_MULTI_TICKET: 13,
};
exports.GACHA_PAGE_KINDS = {
    NORMAL: 0,
    TEN_TIMES_PER_ACCOUNT: 1,
    TICKET_ONLY: 2,
    ONE_TIME_TICKET_ONLY: 3,
    TEN_TIMES_TICKET_ONLY: 4,
    CRAZY_TEN_TIMES_TICKET_ONLY: 5,
    ONE_TIME: 6,
    TEN_TIMES: 7,
    WITHOUT_DAILY: 8,
};
function getTicketDrawKind(type) {
    switch (type) {
        case exports.GACHA_EXEC_TYPES.CONFIGURED_SINGLE_TICKET:
        case exports.GACHA_EXEC_TYPES.WILDCARD_CHARACTER_SINGLE_TICKET:
        case exports.GACHA_EXEC_TYPES.WILDCARD_EQUIPMENT_SINGLE_TICKET:
            return "single";
        case exports.GACHA_EXEC_TYPES.CONFIGURED_MULTI_TICKET:
        case exports.GACHA_EXEC_TYPES.WILDCARD_CHARACTER_MULTI_TICKET:
        case exports.GACHA_EXEC_TYPES.WILDCARD_EQUIPMENT_MULTI_TICKET:
            return "multi";
        default:
            return null;
    }
}
exports.getTicketDrawKind = getTicketDrawKind;
function ticketExecMatchesGachaType(type, gacha) {
    if (type === exports.GACHA_EXEC_TYPES.CONFIGURED_SINGLE_TICKET ||
        type === exports.GACHA_EXEC_TYPES.CONFIGURED_MULTI_TICKET) {
        return true;
    }
    if (gacha.type === types_1.GachaType.WEAPON) {
        return type === exports.GACHA_EXEC_TYPES.WILDCARD_EQUIPMENT_SINGLE_TICKET ||
            type === exports.GACHA_EXEC_TYPES.WILDCARD_EQUIPMENT_MULTI_TICKET;
    }
    return type === exports.GACHA_EXEC_TYPES.WILDCARD_CHARACTER_SINGLE_TICKET ||
        type === exports.GACHA_EXEC_TYPES.WILDCARD_CHARACTER_MULTI_TICKET;
}
exports.ticketExecMatchesGachaType = ticketExecMatchesGachaType;
function ticketAllowedByPageKind(pageKind, drawKind) {
    switch (pageKind) {
        case exports.GACHA_PAGE_KINDS.ONE_TIME_TICKET_ONLY:
            return drawKind === "single";
        case exports.GACHA_PAGE_KINDS.TEN_TIMES_TICKET_ONLY:
        case exports.GACHA_PAGE_KINDS.CRAZY_TEN_TIMES_TICKET_ONLY:
            return drawKind === "multi";
        default:
            return true;
    }
}
function isGachaExecAllowed(gacha, paymentType, execType) {
    var _a;
    const pageKind = (_a = gacha.pageKind) !== null && _a !== void 0 ? _a : exports.GACHA_PAGE_KINDS.NORMAL;
    const ticketDrawKind = getTicketDrawKind(execType);
    if (paymentType === exports.GACHA_PAYMENT_TYPES.TICKET) {
        return ticketDrawKind !== null &&
            ticketExecMatchesGachaType(execType, gacha) &&
            ticketAllowedByPageKind(pageKind, ticketDrawKind);
    }
    switch (pageKind) {
        case exports.GACHA_PAGE_KINDS.TICKET_ONLY:
        case exports.GACHA_PAGE_KINDS.ONE_TIME_TICKET_ONLY:
        case exports.GACHA_PAGE_KINDS.TEN_TIMES_TICKET_ONLY:
        case exports.GACHA_PAGE_KINDS.CRAZY_TEN_TIMES_TICKET_ONLY:
            return false;
        case exports.GACHA_PAGE_KINDS.WITHOUT_DAILY:
            return paymentType !== exports.GACHA_PAYMENT_TYPES.VMONEY;
        case exports.GACHA_PAGE_KINDS.ONE_TIME:
            return execType === exports.GACHA_EXEC_TYPES.VMONEY_SINGLE ||
                execType === exports.GACHA_EXEC_TYPES.CAMPAIGN_SINGLE;
        case exports.GACHA_PAGE_KINDS.TEN_TIMES:
        case exports.GACHA_PAGE_KINDS.TEN_TIMES_PER_ACCOUNT:
            return execType === exports.GACHA_EXEC_TYPES.VMONEY_MULTI ||
                execType === exports.GACHA_EXEC_TYPES.CAMPAIGN_MULTI;
        default:
            return true;
    }
}
exports.isGachaExecAllowed = isGachaExecAllowed;
function getGachaPoolItem(gacha, itemId) {
    for (const pool of Object.values(gacha.pool || {})) {
        const item = pool.find((candidate) => candidate.id === itemId);
        if (item)
            return item;
    }
    return null;
}
exports.getGachaPoolItem = getGachaPoolItem;
function getExchangeableGachaItem(gacha, itemId) {
    const item = getGachaPoolItem(gacha, itemId);
    return (item === null || item === void 0 ? void 0 : item.isExchangeable) ? item : null;
}
exports.getExchangeableGachaItem = getExchangeableGachaItem;
