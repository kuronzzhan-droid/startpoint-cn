"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviveMergedPlayerDates = exports.deserializeClientDate = exports.clientSerializeDate = void 0;
/**
 * Serializes a date in a format expected by the client.
 * Format: YYYY-MM-DD HH:MM:SS
 *
 * @param date The date to serialize.
 * @returns A serialized date as a string.
 */
function clientSerializeDate(date) {
    return `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")} ${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}:${date.getUTCSeconds().toString().padStart(2, "0")}`;
}
exports.clientSerializeDate = clientSerializeDate;
/**
 * Deserializes a date from a format expected by the client into a Date.
 * Format: YYYY-MM-DD HH:MM:SS
 *
 * @param date A serialized date as a string.
 * @returns The deserialized date.
 */
function deserializeClientDate(serializedDate) {
    return new Date(`${serializedDate.replace(' ', 'T')}.000Z`);
}
exports.deserializeClientDate = deserializeClientDate;
/**
 * Revives Date fields in a MergedPlayerData parsed from JSON (where Dates are ISO strings)
 * back into Date objects, so the restore/insert path receives the expected types.
 * Mutates and returns the same object.
 */
function reviveMergedPlayerDates(data) {
    const toDate = (v) => (v === null || v === undefined) ? v : new Date(v);
    if (data.player) {
        data.player.staminaHealTime = toDate(data.player.staminaHealTime);
        data.player.lastLoginTime = toDate(data.player.lastLoginTime);
        data.player.expPooledTime = toDate(data.player.expPooledTime);
    }
    for (const c of Object.values(data.characterList || {})) {
        if (!c)
            continue;
        c.joinTime = toDate(c.joinTime);
        c.updateTime = toDate(c.updateTime);
    }
    for (const c of (data.startDashExchangeCampaignList || [])) {
        if (!c)
            continue;
        c.periodStartTime = toDate(c.periodStartTime);
        c.periodEndTime = toDate(c.periodEndTime);
    }
    return data;
}
exports.reviveMergedPlayerDates = reviveMergedPlayerDates;
