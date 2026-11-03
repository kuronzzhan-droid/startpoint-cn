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
exports.register = void 0;
const default_runtime_1 = require("./default-runtime");
const server_1 = require("../tcp/server");
const lobby_runtime_1 = require("../five-boss/lobby-runtime");
const embedded_1 = require("./embedded");
const runtime_role_1 = require("./runtime-role");
function register(executor, lifecycle) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!(0, runtime_role_1.isRealtimeOwnerChild)())
            throw new Error("Realtime bootstrap requires child role");
        (0, default_runtime_1.registerRealtimeDomainHandlers)(executor);
        lifecycle.onQuiesce(server_1.quiesceSessionServer);
        lifecycle.onDrain(() => __awaiter(this, void 0, void 0, function* () { yield embedded_1.embeddedMultiCoordinator.drain(); yield (0, lobby_runtime_1.drainFiveBossSignalPersistence)(); }));
        lifecycle.onShutdown(server_1.stopSessionServer);
        yield (0, server_1.startSessionServer)();
        const address = (_a = (0, server_1.getSessionServer)()) === null || _a === void 0 ? void 0 : _a.address();
        return { port: typeof address === "object" && address ? address.port : null, pid: process.pid,
            ownerEpoch: executor.ownerEpoch, authority: "tcp-room-barrier-lease", database: "business-rpc-only" };
    });
}
exports.register = register;
