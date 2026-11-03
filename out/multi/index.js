"use strict";
// Barrel entry for multi battle / co-op system
// Re-exports for backward compatibility with cn-server.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopSessionServer = exports.startSessionServer = exports.multiBattleRoutes = void 0;
var register_1 = require("./http/register");
Object.defineProperty(exports, "multiBattleRoutes", { enumerable: true, get: function () { return register_1.multiBattleRoutes; } });
var default_runtime_1 = require("./coordinator/default-runtime");
Object.defineProperty(exports, "startSessionServer", { enumerable: true, get: function () { return default_runtime_1.startRealtimeSessionServer; } });
Object.defineProperty(exports, "stopSessionServer", { enumerable: true, get: function () { return default_runtime_1.stopRealtimeSessionServer; } });
