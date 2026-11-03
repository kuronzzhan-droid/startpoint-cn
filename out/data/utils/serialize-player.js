"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializePlayerData = exports.preparePlayerSerialization = void 0;
const utils_1 = require("../../utils");
const asset_1 = require("../../routes/api/asset");
const mail_1 = require("../domains/mail");
const mission_1 = require("../domains/mission");
const player_1 = require("../domains/player");
const stamina_1 = require("../../lib/stamina");
const mode15_optional_1 = require("../../lib/mode15-optional");
const client_player_snapshot_1 = require("./client-player-snapshot");
function preparePlayerSerialization(toSerialize, options) {
    var _a;
    const playerData = toSerialize.player;
    const realTimeStamina = (0, stamina_1.computeRealTimeStamina)(playerData);
    if (realTimeStamina !== playerData.stamina) {
        (0, player_1.updatePlayerSync)({ id: playerData.id, stamina: realTimeStamina, staminaHealTime: new Date() });
        playerData.stamina = realTimeStamina;
    }
    const context = {
        assetVersion: asset_1.availableAssetVersion, timeOffset: (_a = (0, utils_1.getTimeOffset)()) !== null && _a !== void 0 ? _a : 0,
        mailArrived: (0, mail_1.getPlayerMailCountSync)(playerData.id, true) > 0,
        clearedCollectMissions: (0, mission_1.getPlayerClearedCollectItemEventMissionListSync)(playerData.id),
        summonComSeconds: parseInt(process.env.SUMMON_COM_SECONDS || "5"),
        mode15Enabled: (0, mode15_optional_1.isMode15RuntimeLoaded)(), mode15EventId: mode15_optional_1.MODE15_RUSH_EVENT_ID,
        mode15Reuse: process.env.MODE15_ALLOW_CHARACTER_REUSE === "true",
    };
    return { data: toSerialize, context, options };
}
exports.preparePlayerSerialization = preparePlayerSerialization;
function serializePlayerData(data, options) {
    const prepared = preparePlayerSerialization(data, options);
    return (0, client_player_snapshot_1.serializePlayerSnapshot)(prepared.data, prepared.context, prepared.options);
}
exports.serializePlayerData = serializePlayerData;
