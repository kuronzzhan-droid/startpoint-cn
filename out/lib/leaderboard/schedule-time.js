"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLeaderboardDeadlineInput = exports.formatLeaderboardDeadlineInput = void 0;
// Shared by the admin form and server display; never use the host's timezone.
function formatLeaderboardDeadlineInput(timestamp) {
    return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
exports.formatLeaderboardDeadlineInput = formatLeaderboardDeadlineInput;
function parseLeaderboardDeadlineInput(value) {
    if (value === "")
        return null;
    const timestamp = Date.parse(`${value}+08:00`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
        || !Number.isFinite(timestamp) || formatLeaderboardDeadlineInput(timestamp) !== value) {
        throw new Error("截止时间无效，请填写北京时间。");
    }
    return timestamp;
}
exports.parseLeaderboardDeadlineInput = parseLeaderboardDeadlineInput;
