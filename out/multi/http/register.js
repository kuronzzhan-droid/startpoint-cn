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
exports.multiBattleRoutes = void 0;
const lobby_1 = require("./lobby");
const room_1 = require("./room");
const battle_1 = require("./battle");
const social_1 = require("./social");
const command_error_1 = require("./command-error");
function multiBattleRoutes(fastify) {
    return __awaiter(this, void 0, void 0, function* () {
        (0, command_error_1.installRealtimeHttpFailureHandler)(fastify);
        (0, lobby_1.registerLobbyRoutes)(fastify);
        (0, room_1.registerRoomRoutes)(fastify);
        (0, battle_1.registerBattleRoutes)(fastify);
        (0, social_1.registerSocialRoutes)(fastify);
    });
}
exports.multiBattleRoutes = multiBattleRoutes;
