"use strict";
// Time utility — reset-hour-aware day/week boundary detection
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNewWeek = exports.isNewDay = exports.getWeekBucket = exports.getDayBucket = void 0;
const resetHour = parseInt(process.env.DAILY_RESET_HOUR || '5', 10);
const cnUtcOffsetHours = 8;
function shiftByResetHour(date) {
    return new Date(date.getTime() + (cnUtcOffsetHours - resetHour) * 3600000);
}
function getDayBucket(date) {
    const s = shiftByResetHour(date);
    return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate() };
}
exports.getDayBucket = getDayBucket;
function getWeekBucket(date) {
    // CN week resets at Monday 05:00 (UTC+8).
    const s = shiftByResetHour(date);
    const start = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
    const dayOfWeek = start.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(start.getTime() - daysSinceMonday * 86400000);
    return { y: monday.getUTCFullYear(), w: Math.floor(monday.getTime() / (7 * 86400000)) };
}
exports.getWeekBucket = getWeekBucket;
function isNewDay(now, last) {
    const a = getDayBucket(now);
    const b = getDayBucket(last);
    return Date.UTC(a.y, a.m, a.d) > Date.UTC(b.y, b.m, b.d);
}
exports.isNewDay = isNewDay;
function isNewWeek(now, last) {
    const a = getWeekBucket(now);
    const b = getWeekBucket(last);
    return a.w > b.w;
}
exports.isNewWeek = isNewWeek;
