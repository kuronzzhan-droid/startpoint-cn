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
exports.validateSessionAndPlayer = void 0;
const player_1 = require("../../../data/domains/player");
const session_1 = require("../../../data/domains/session");
const activeAccount_1 = require("../../../data/activeAccount");
function validateSessionAndPlayer(viewerId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!viewerId || isNaN(viewerId))
            return null;
        const session = yield (0, session_1.getSession)(String(viewerId));
        if (!session)
            return null;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (!playerId)
            return null;
        const playerData = (0, player_1.getPlayerSync)(playerId);
        if (!playerData)
            return null;
        return { playerId, playerData };
    });
}
exports.validateSessionAndPlayer = validateSessionAndPlayer;
