"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
exports.failRealtimeOwner = exports.stopRealtimeSessionServer = exports.drainRealtimeWork = exports.quiesceRealtimeSessionServer = exports.startRealtimeSessionServer = exports.realtimeOwnerStatus = exports.assertRealtimeOwnerEpoch = exports.getRoomCommandGateway = exports.registerRealtimeDomainHandlers = void 0;
const path = __importStar(require("node:path"));
const command_process_1 = require("./command-process");
const business_rpc_1 = require("./business-rpc");
const runtime_role_1 = require("./runtime-role");
const shutdown_state_1 = require("../../lib/shutdown-state");
const parent_business_admission_1 = require("./parent-business-admission");
let gateway;
let executor;
let processTransport;
let starting;
let phase = "idle";
let quiesced;
let stopped;
function assertOwnerAdmission() {
    (0, shutdown_state_1.assertServerAcceptingWork)();
    if (phase === "stopped" || phase === "failed" || (phase === "quiescing" && !(0, shutdown_state_1.hasServerWorkAdmission)())) {
        throw Object.assign(new Error("REALTIME_OWNER_UNAVAILABLE"), { code: "REALTIME_OWNER_UNAVAILABLE" });
    }
}
function registerRealtimeDomainHandlers(owner) {
    const modules = [
        ["./room-command-handlers", "registerRoomCommandHandlers"],
        ["./battle-command-handlers", "registerBattleCommandHandlers"],
        ["./lobby-command-handlers", "registerLobbyCommandHandlers"],
        ["./lounge-command-handlers", "registerLoungeCommandHandlers"],
        ["./five-boss-command-handlers", "registerFiveBossCommandHandlers"],
        ["./runtime-command-handlers", "registerRuntimeCommandHandlers"],
    ];
    for (const [module, method] of modules)
        require(module)[method](owner);
}
exports.registerRealtimeDomainHandlers = registerRealtimeDomainHandlers;
/** One configured owner. A failed remote owner never creates embedded authority. */
function getRoomCommandGateway() {
    if (gateway)
        return gateway;
    assertOwnerAdmission();
    const { RoomCommandGateway } = require("./command-gateway");
    if ((0, runtime_role_1.isRealtimeParent)()) {
        const lazy = {
            get ownerEpoch() { return processTransport === null || processTransport === void 0 ? void 0 : processTransport.ownerEpoch; },
            submit: (command) => __awaiter(this, void 0, void 0, function* () { assertOwnerAdmission(); yield startRealtimeOwner(); return processTransport.submit(command); }),
            queryResult: (id) => __awaiter(this, void 0, void 0, function* () {
                if (!processTransport && phase !== "idle")
                    throw new Error("REALTIME_OWNER_UNAVAILABLE");
                yield startRealtimeOwner();
                return processTransport.queryResult(id);
            }),
        };
        gateway = new RoomCommandGateway(lazy, { timeoutMs: 8000, maxAgeMs: 10000 });
    }
    else {
        const { RoomCommandExecutor } = require("./command-executor");
        executor = new RoomCommandExecutor();
        const owner = executor;
        const admissions = new Map();
        owner.setHandlerContext((id, operation) => {
            const admission = admissions.get(id);
            if (!admission)
                throw new Error("REALTIME_BUSINESS_ADMISSION_INVALID");
            return admission.run(() => __awaiter(this, void 0, void 0, function* () { return operation(); }));
        });
        registerRealtimeDomainHandlers(executor);
        const embeddedTransport = {
            ownerEpoch: owner.ownerEpoch,
            submit(command) {
                return __awaiter(this, void 0, void 0, function* () {
                    assertOwnerAdmission();
                    const ownsAdmission = !admissions.has(command.commandId);
                    const scope = ownsAdmission ? (0, parent_business_admission_1.createAcceptedRealtimeBusinessScope)({ ownerEpoch: owner.ownerEpoch, commandId: command.commandId }) : admissions.get(command.commandId);
                    if (ownsAdmission)
                        admissions.set(command.commandId, scope);
                    try {
                        return yield owner.submit(command, (0, shutdown_state_1.hasServerWorkAdmission)());
                    }
                    finally {
                        if (ownsAdmission) {
                            admissions.delete(command.commandId);
                            scope.release();
                        }
                    }
                });
            },
            queryResult: id => owner.queryResult(id),
        };
        gateway = new RoomCommandGateway(embeddedTransport);
    }
    return gateway;
}
exports.getRoomCommandGateway = getRoomCommandGateway;
function assertRealtimeOwnerEpoch(epoch, claimToken, ordinary = false) {
    if ((0, runtime_role_1.isRealtimeParent)()) {
        if (!(processTransport === null || processTransport === void 0 ? void 0 : processTransport.isReady) || processTransport.ownerEpoch !== epoch)
            throw new Error("REALTIME_OWNER_UNAVAILABLE");
    }
    else {
        getRoomCommandGateway();
        if ((executor === null || executor === void 0 ? void 0 : executor.ownerEpoch) !== epoch)
            throw new Error("REALTIME_OWNER_EPOCH_CHANGED");
        if (claimToken) {
            if (ordinary) {
                require("./battle-command-handlers").assertOrdinaryStartClaim(claimToken);
                return;
            }
            const { assertFiveBossStartClaim } = require("./five-boss-command-handlers");
            assertFiveBossStartClaim(claimToken);
        }
    }
}
exports.assertRealtimeOwnerEpoch = assertRealtimeOwnerEpoch;
function realtimeOwnerStatus() {
    var _a, _b, _c, _d, _e;
    return { mode: (0, runtime_role_1.isRealtimeParent)() ? "process" : "embedded", pid: (_a = processTransport === null || processTransport === void 0 ? void 0 : processTransport.pid) !== null && _a !== void 0 ? _a : process.pid,
        ownerEpoch: (_c = (_b = processTransport === null || processTransport === void 0 ? void 0 : processTransport.ownerEpoch) !== null && _b !== void 0 ? _b : executor === null || executor === void 0 ? void 0 : executor.ownerEpoch) !== null && _c !== void 0 ? _c : null,
        phase, ready: phase !== "stopped" && phase !== "failed" && ((0, runtime_role_1.isRealtimeParent)() ? !!(processTransport === null || processTransport === void 0 ? void 0 : processTransport.isReady) : !!executor),
        endpoint: (_d = processTransport === null || processTransport === void 0 ? void 0 : processTransport.bootstrapMetadata()) !== null && _d !== void 0 ? _d : null,
        transport: (_e = processTransport === null || processTransport === void 0 ? void 0 : processTransport.diagnostics()) !== null && _e !== void 0 ? _e : null };
}
exports.realtimeOwnerStatus = realtimeOwnerStatus;
function startRealtimeOwner() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!starting) {
            assertOwnerAdmission();
            if (phase === "quiescing")
                throw new Error("REALTIME_OWNER_UNAVAILABLE");
            phase = "starting";
            processTransport = new command_process_1.CommandProcessTransport({
                registerModule: path.join(__dirname, "realtime-owner-bootstrap.js"),
                childEnv: { MULTI_REALTIME_OWNER_CHILD: "1", MULTI_REALTIME_PROCESS: "0", MULTI_BATTLE_RELAY_PROCESS: "0",
                    CN_WRITER_THREAD: "0", PROCESS_MEMORY_DIAGNOSTICS: "false" },
                businessHandler: business_rpc_1.handleParentBusiness, startTimeoutMs: 15000, inheritOutput: true,
                maxPending: 128, maxPendingBytes: 4 * 1024 * 1024,
            });
            starting = processTransport.start().then(() => { if (phase === "starting")
                phase = "running"; }, error => {
                phase = "failed";
                gateway === null || gateway === void 0 ? void 0 : gateway.close();
                throw error;
            });
        }
        yield starting;
    });
}
function startRealtimeSessionServer() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        var _b;
        if ((0, shutdown_state_1.isServerShuttingDown)())
            throw Object.assign(new Error("SERVER_CLOSING"), { code: "SERVER_CLOSING" });
        if (phase === "quiescing")
            throw new Error("REALTIME_OWNER_UNAVAILABLE");
        if (phase === "stopped" || phase === "failed") {
            gateway = undefined;
            executor = undefined;
            processTransport = undefined;
            starting = undefined;
            quiesced = undefined;
            stopped = undefined;
            phase = "idle";
            require("./durable-owner-event").resumeDurableOwnerEvents();
        }
        (_a = (_b = process.env).MULTI_REALTIME_PROCESS) !== null && _a !== void 0 ? _a : (_b.MULTI_REALTIME_PROCESS = "1");
        if (!(0, runtime_role_1.isRealtimeParent)()) {
            getRoomCommandGateway();
            yield require("../tcp/server").startSessionServer();
            phase = "running";
            return;
        }
        yield startRealtimeOwner();
        getRoomCommandGateway();
        console.log(`[MULTI-REALTIME] owner ready pid=${processTransport.pid} epoch=${processTransport.ownerEpoch}`);
        startRealtimeOwnerWatchdog();
    });
}
exports.startRealtimeSessionServer = startRealtimeSessionServer;
function quiesceRealtimeSessionServer() {
    if (!quiesced) {
        if (phase !== "stopped" && phase !== "failed")
            phase = "quiescing";
        executor === null || executor === void 0 ? void 0 : executor.quiesce();
        quiesced = (() => __awaiter(this, void 0, void 0, function* () {
            if ((0, runtime_role_1.isRealtimeParent)()) {
                yield (starting === null || starting === void 0 ? void 0 : starting.catch(() => { }));
                yield (processTransport === null || processTransport === void 0 ? void 0 : processTransport.quiesce());
            }
            else
                require("../tcp/server").quiesceSessionServer();
        }))();
    }
    return quiesced;
}
exports.quiesceRealtimeSessionServer = quiesceRealtimeSessionServer;
function drainRealtimeWork() {
    return __awaiter(this, void 0, void 0, function* () {
        yield (executor === null || executor === void 0 ? void 0 : executor.drain());
        yield (gateway === null || gateway === void 0 ? void 0 : gateway.drain());
        if ((0, runtime_role_1.isRealtimeParent)())
            yield (processTransport === null || processTransport === void 0 ? void 0 : processTransport.drain());
        else {
            yield require("./embedded").embeddedMultiCoordinator.drain();
            yield require("../five-boss/lobby-runtime").drainFiveBossSignalPersistence();
        }
    });
}
exports.drainRealtimeWork = drainRealtimeWork;
function stopRealtimeSessionServer() {
    if (!stopped)
        stopped = (() => __awaiter(this, void 0, void 0, function* () {
            require("./durable-owner-event").quiesceDurableOwnerEvents();
            yield quiesceRealtimeSessionServer();
            yield require("./durable-owner-event").drainDurableOwnerEvents();
            yield drainRealtimeWork();
            gateway === null || gateway === void 0 ? void 0 : gateway.close();
            executor === null || executor === void 0 ? void 0 : executor.close();
            if ((0, runtime_role_1.isRealtimeParent)())
                yield (processTransport === null || processTransport === void 0 ? void 0 : processTransport.stop());
            else
                yield require("../tcp/server").stopSessionServer();
            phase = "stopped";
        }))();
    return stopped;
}
exports.stopRealtimeSessionServer = stopRealtimeSessionServer;
/** Security/channel failure seals this owner; a process owner is then rebuilt by the respawn supervisor. */
function failRealtimeOwner() {
    return __awaiter(this, void 0, void 0, function* () {
        if (phase === "failed")
            return;
        phase = "failed";
        gateway === null || gateway === void 0 ? void 0 : gateway.close();
        executor === null || executor === void 0 ? void 0 : executor.close();
        if (!(0, runtime_role_1.isRealtimeParent)()) {
            yield require("../tcp/server").stopSessionServer();
            return;
        }
        yield (processTransport === null || processTransport === void 0 ? void 0 : processTransport.abort());
        scheduleRealtimeOwnerRespawn();
    });
}
exports.failRealtimeOwner = failRealtimeOwner;
// A sealed owner used to stay down until a manual restart, leaving the session port closed (live 2026-10-16).
// The old child is aborted before a new owner epoch starts, so two owners never hold authority at once.
const RESPAWN_DELAY_MS = boundedEnvInt("MULTI_REALTIME_RESPAWN_DELAY_MS", 5000, 500, 120000);
const RESPAWN_MAX = boundedEnvInt("MULTI_REALTIME_RESPAWN_MAX", 5, 0, 100);
const RESPAWN_WINDOW_MS = 10 * 60000;
const respawnHistory = [];
let respawnTimer;
let watchdog;
function boundedEnvInt(name, fallback, min, max) {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}
function scheduleRealtimeOwnerRespawn() {
    var _a;
    if (respawnTimer || (0, shutdown_state_1.isServerShuttingDown)())
        return;
    const now = Date.now();
    while (respawnHistory.length && now - respawnHistory[0] > RESPAWN_WINDOW_MS)
        respawnHistory.shift();
    if (respawnHistory.length >= RESPAWN_MAX) {
        console.error(`[MULTI-REALTIME] owner respawn limit reached (${RESPAWN_MAX} per 10 min); manual restart required`);
        return;
    }
    respawnHistory.push(now);
    console.error(`[MULTI-REALTIME] owner sealed; respawning in ${RESPAWN_DELAY_MS}ms (attempt ${respawnHistory.length}/${RESPAWN_MAX})`);
    respawnTimer = setTimeout(() => {
        respawnTimer = undefined;
        if ((0, shutdown_state_1.isServerShuttingDown)() || phase !== "failed")
            return;
        startRealtimeSessionServer().then(() => console.log("[MULTI-REALTIME] owner respawned"), error => { console.error("[MULTI-REALTIME] owner respawn failed", error); phase = "failed"; scheduleRealtimeOwnerRespawn(); });
    }, RESPAWN_DELAY_MS);
    (_a = respawnTimer.unref) === null || _a === void 0 ? void 0 : _a.call(respawnTimer);
}
/** A process owner that exits on its own is treated like a sealed owner. */
function startRealtimeOwnerWatchdog() {
    var _a;
    if (watchdog)
        return;
    watchdog = setInterval(() => {
        if ((0, shutdown_state_1.isServerShuttingDown)()) {
            clearInterval(watchdog);
            watchdog = undefined;
            return;
        }
        if (phase === "running" && (0, runtime_role_1.isRealtimeParent)() && processTransport && !processTransport.isReady) {
            console.error("[MULTI-REALTIME] owner process is no longer ready; sealing for respawn");
            void failRealtimeOwner();
        }
    }, 5000);
    (_a = watchdog.unref) === null || _a === void 0 ? void 0 : _a.call(watchdog);
}
