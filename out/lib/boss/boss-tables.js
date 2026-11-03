"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serverBossBattleQuests = void 0;
const boss_battle_quest_json_1 = __importDefault(require("../../../assets/boss_battle_quest.json"));
const boss_battle_quest_cnmod_json_1 = __importDefault(require("../../../assets/boss_battle_quest_cnmod.json"));
/**
 * Server-side boss master data.  New permanent bosses are appended through a
 * cnmod table so the upstream master stays untouched and future bosses can
 * be added without rewriting the existing entries.
 */
exports.serverBossBattleQuests = Object.assign(Object.assign({}, boss_battle_quest_json_1.default), boss_battle_quest_cnmod_json_1.default);
