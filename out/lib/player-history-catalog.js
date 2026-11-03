"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyPlayerHistoryTopicValues = exports.getPlayerHistoryCatalog = exports.PLAYER_HISTORY_END_MS = exports.PLAYER_HISTORY_START_MS = void 0;
// These dates and definitions are the player-history master bundled with the
// CN 1.4.84 client. Keep this compatibility catalog local because the source
// repository does not currently ship the extracted player_history tables.
exports.PLAYER_HISTORY_START_MS = Date.parse("2025-07-17T03:00:00.000Z");
exports.PLAYER_HISTORY_END_MS = Date.parse("2025-08-14T14:59:59.000Z");
const BACKGROUND_IDS = new Set([
    1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008,
    2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009,
    2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019,
    2021, 2022, 2023, 2024, 2025,
    3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008,
    3009, 3010, 3011, 3012, 3013, 3014, 3015, 3016,
    4001, 4002, 4003, 4004,
]);
const AGGREGATION_TARGETS = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    14, 15, 16, 26, 17, 18, 19, 20, 21, 22, 23, 24, 25,
];
const CATALOG = Object.freeze({
    playerHistoryId: 1,
    defaultBackgroundId: 1001,
    backgroundIds: BACKGROUND_IDS,
    topics: Object.freeze(AGGREGATION_TARGETS.map((aggregationTarget, offset) => Object.freeze({
        index: offset + 1,
        aggregationTarget,
        // The client's own dummy implementation initially displays the six
        // basic history rows and keeps optional/event rows hidden.
        toggleDefault: offset < 6,
    }))),
});
function getPlayerHistoryCatalog(nowMs) {
    if (!Number.isFinite(nowMs)
        || nowMs < exports.PLAYER_HISTORY_START_MS
        || nowMs > exports.PLAYER_HISTORY_END_MS)
        return null;
    return CATALOG;
}
exports.getPlayerHistoryCatalog = getPlayerHistoryCatalog;
function nulls(length) {
    return Array.from({ length }, () => null);
}
function createEmptyPlayerHistoryTopicValues(aggregationTarget) {
    const valueList = {
        int_values: null,
        string_values: null,
        date_values: null,
        character_id_values: null,
        equipment_id_values: null,
        quest_values: null,
        boss_id_values: null,
    };
    if ([0, 7, 8].includes(aggregationTarget))
        valueList.date_values = nulls(1);
    else if ([2, 3].includes(aggregationTarget))
        valueList.date_values = nulls(6);
    else if (aggregationTarget === 4) {
        valueList.date_values = nulls(1);
        valueList.character_id_values = nulls(1);
    }
    else if ([1, 5, 6, 9, 10, 11, 13, 14, 15, 21, 22, 23, 24, 25].includes(aggregationTarget)) {
        valueList.int_values = nulls(1);
    }
    else if (aggregationTarget === 12)
        valueList.int_values = nulls(2);
    else if (aggregationTarget === 16) {
        valueList.int_values = nulls(12);
        valueList.equipment_id_values = [5010045, 5040020, 5100011, 5030028, 5010032, 5010056];
    }
    else if (aggregationTarget === 17) {
        valueList.int_values = nulls(2);
        valueList.character_id_values = nulls(7);
    }
    else if ([18, 19, 20].includes(aggregationTarget))
        valueList.int_values = nulls(2);
    else if (aggregationTarget === 26) {
        valueList.date_values = nulls(1);
        valueList.boss_id_values = nulls(1);
    }
    else {
        throw new Error(`unsupported player-history aggregation target ${aggregationTarget}`);
    }
    return valueList;
}
exports.createEmptyPlayerHistoryTopicValues = createEmptyPlayerHistoryTopicValues;
