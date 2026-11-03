"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBoxGacha1001PeriodError = exports.getBoxGacha1001Settings = exports.BOX_GACHA_1001_ID = void 0;
const box_gacha_1001_settings_json_1 = __importDefault(require("../../assets/box_gacha_1001_settings.json"));
// Original master/box_gacha/{box_gacha,box}.orderedmap rows for 1001.
// This policy intentionally applies only to the ended Golden Week activity.
exports.BOX_GACHA_1001_ID = 1001;
function epochSeconds(value) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        throw new Error("Invalid 1001 box availability date.");
    }
    const seconds = Date.parse(value.replace(" ", "T") + box_gacha_1001_settings_json_1.default.timeZoneOffset) / 1000;
    if (!Number.isSafeInteger(seconds))
        throw new Error("Invalid 1001 box availability date.");
    return seconds;
}
if (box_gacha_1001_settings_json_1.default.boxGachaId !== exports.BOX_GACHA_1001_ID || box_gacha_1001_settings_json_1.default.timeZoneOffset !== "+08:00"
    || Object.keys(box_gacha_1001_settings_json_1.default.boxSettings).length !== 9) {
    throw new Error("Invalid 1001 box metadata.");
}
const activityFrom = epochSeconds(box_gacha_1001_settings_json_1.default.availableFrom);
const activityUntil = epochSeconds(box_gacha_1001_settings_json_1.default.availableUntil);
if (activityFrom > activityUntil)
    throw new Error("Invalid 1001 activity period.");
const settings = new Map();
const periods = new Map();
for (const [boxId, value] of Object.entries(box_gacha_1001_settings_json_1.default.boxSettings)) {
    const id = Number(boxId);
    if (!Number.isSafeInteger(id) || id < 1 || id > 9
        || (value.requiredBoxId !== null && (!Number.isSafeInteger(value.requiredBoxId)
            || value.requiredBoxId < 1 || value.requiredBoxId >= id))
        || value.resetKind !== 0 || value.resetLimit !== null || value.closeKind !== 0) {
        throw new Error("Invalid 1001 box settings.");
    }
    const from = Math.max(activityFrom, epochSeconds(value.availableFrom));
    const until = Math.min(activityUntil, epochSeconds(value.availableUntil));
    if (from > until)
        throw new Error("Invalid 1001 box period.");
    settings.set(id, Object.freeze(Object.assign({}, value)));
    periods.set(id, Object.freeze({ from, until }));
}
function getBoxGacha1001Settings(boxId) {
    var _a;
    return (_a = settings.get(boxId)) !== null && _a !== void 0 ? _a : null;
}
exports.getBoxGacha1001Settings = getBoxGacha1001Settings;
/** Match the client's inclusive, whole-second availability boundaries. */
function getBoxGacha1001PeriodError(boxId, nowSeconds) {
    const period = periods.get(boxId);
    if (period === undefined)
        return "Missing box availability settings.";
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < period.from || nowSeconds > period.until) {
        return "Box gacha is outside its availability period.";
    }
    return null;
}
exports.getBoxGacha1001PeriodError = getBoxGacha1001PeriodError;
