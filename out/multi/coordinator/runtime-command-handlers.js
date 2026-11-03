"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRuntimeCommandHandlers = void 0;
const SessionManager_1 = require("../state/SessionManager");
const state_1 = require("../../lounge/state");
const battle_telemetry_1 = require("../battle-telemetry");
const realtime_diagnostics_1 = require("../../lib/realtime-diagnostics");
function registerRuntimeCommandHandlers(executor) {
    executor.register("runtime.disconnect", raw => {
        const p = raw;
        SessionManager_1.sessionManager.disconnectPlayerLogin(p.viewerId);
        (0, state_1.disconnectLoungePlayerLogin)(p.viewerId);
        return { applied: true };
    });
    executor.register("runtime.diagnostics", () => (0, realtime_diagnostics_1.getRealtimeDiagnostics)());
    executor.register("runtime.configureDiagnostics", raw => (0, realtime_diagnostics_1.configureRealtimeDiagnostics)(raw));
    executor.register("runtime.battles", () => ({ active: battle_telemetry_1.battleTelemetry.activeCount(), recent: battle_telemetry_1.battleTelemetry.recentSummaries() }));
    executor.register("runtime.partyChanged", (raw) => __awaiter(this, void 0, void 0, function* () {
        const p = raw;
        const { notifyEquipmentPartySaved } = require("../room/equipment-ready");
        yield notifyEquipmentPartySaved(p.playerId, p.changedPartyIds, p.selectionChanged);
        return { applied: true };
    }));
    executor.register("runtime.presence", raw => {
        const p = raw;
        return { hasClients: SessionManager_1.sessionManager.hasRoomClients(p.roomNumber), hostOnline: p.hostViewerId !== undefined
                ? SessionManager_1.sessionManager.isHostOnline(p.hostViewerId, p.roomNumber) : false };
    });
}
exports.registerRuntimeCommandHandlers = registerRuntimeCommandHandlers;
