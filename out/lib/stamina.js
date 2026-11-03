"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRankDegree = exports.computeRealTimeStamina = exports.getHealRate = exports.getMaxStamina = void 0;
const player_rank_full_json_1 = __importDefault(require("../../assets/cdndata/player_rank_full.json"));
const assets_1 = require("./assets");
const STAMINA_OVERFLOW_MAX = 999;
const rankMap = new Map();
const sortedDegrees = [];
for (const [degreeStr, rows] of Object.entries(player_rank_full_json_1.default)) {
    const degree = parseInt(degreeStr);
    const row = rows[0];
    rankMap.set(degree, {
        stamina: parseInt(row[0]),
        threshold: parseInt(row[1]),
        healRate: parseFloat(row[2]) || 0,
    });
    sortedDegrees.push(degree);
}
sortedDegrees.sort((a, b) => a - b);
function getMaxStamina(degreeId) {
    var _a, _b, _c, _d, _e, _f;
    if (degreeId <= 0)
        return (_b = (_a = rankMap.get(1)) === null || _a === void 0 ? void 0 : _a.stamina) !== null && _b !== void 0 ? _b : 22;
    return (_f = (_d = (_c = rankMap.get(degreeId)) === null || _c === void 0 ? void 0 : _c.stamina) !== null && _d !== void 0 ? _d : (_e = rankMap.get(250)) === null || _e === void 0 ? void 0 : _e.stamina) !== null && _f !== void 0 ? _f : 125;
}
exports.getMaxStamina = getMaxStamina;
function getHealRate(degree) {
    var _a, _b;
    return (_b = (_a = rankMap.get(degree)) === null || _a === void 0 ? void 0 : _a.healRate) !== null && _b !== void 0 ? _b : 0;
}
exports.getHealRate = getHealRate;
function computeRealTimeStamina(player) {
    const config = (0, assets_1.getConfigSync)();
    const degree = getRankDegree(player.rankPoint);
    const healRate = getHealRate(degree);
    const recoverySeconds = config.stamina_recovery_seconds * (1 - healRate);
    const healSec = player.staminaHealTime.getTime() / 1000;
    const nowSec = Math.floor(Date.now() / 1000);
    const elapsed = (nowSec - healSec) / recoverySeconds;
    const maxStamina = Math.max(getMaxStamina(degree), player.stamina);
    return Math.min(Math.max(0, player.stamina + Math.floor(elapsed)), maxStamina, STAMINA_OVERFLOW_MAX);
}
exports.computeRealTimeStamina = computeRealTimeStamina;
function getRankDegree(rankPoint) {
    let result = 1;
    for (const degree of sortedDegrees) {
        const entry = rankMap.get(degree);
        if (rankPoint >= entry.threshold) {
            result = degree;
        }
        else {
            break;
        }
    }
    return result;
}
exports.getRankDegree = getRankDegree;
