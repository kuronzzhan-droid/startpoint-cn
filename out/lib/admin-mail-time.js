"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAdminMailTimestamps = void 0;
const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
function formatSecondPrecision(date) {
    return date.toISOString().replace("T", " ").substring(0, 19);
}
/**
 * Builds the two timestamp representations used by the admin mail flow.
 *
 * Database timestamps stay in UTC because the game API later rebases them
 * onto the virtual server clock. The admin history is a human-facing China
 * wall-clock value and must therefore include the UTC+8 shift explicitly.
 */
function buildAdminMailTimestamps(now = new Date()) {
    return {
        databaseTime: formatSecondPrecision(now),
        chinaDisplayTime: formatSecondPrecision(new Date(now.getTime() + CHINA_UTC_OFFSET_MS)),
    };
}
exports.buildAdminMailTimestamps = buildAdminMailTimestamps;
