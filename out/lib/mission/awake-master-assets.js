"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.characterAwakeRewards = exports.characterAwakeDefinitions = void 0;
const mission_char_awake_json_1 = __importDefault(require("../../../assets/mission_char_awake.json"));
const mission_char_awake_cnmod_json_1 = __importDefault(require("../../../assets/mission_char_awake_cnmod.json"));
const mission_char_awake_reward_json_1 = __importDefault(require("../../../assets/mission_char_awake_reward.json"));
const mission_char_awake_reward_cnmod_json_1 = __importDefault(require("../../../assets/mission_char_awake_reward_cnmod.json"));
function mergeDisjoint(label, base, extension) {
    const duplicated = Object.keys(extension).filter(key => (Object.prototype.hasOwnProperty.call(base, key)));
    if (duplicated.length > 0) {
        throw new Error(`${label} extension duplicates base mission IDs: ${duplicated.join(",")}`);
    }
    return Object.assign(Object.assign({}, base), extension);
}
exports.characterAwakeDefinitions = mergeDisjoint("character awake definition", mission_char_awake_json_1.default, mission_char_awake_cnmod_json_1.default);
exports.characterAwakeRewards = mergeDisjoint("character awake reward", mission_char_awake_reward_json_1.default, mission_char_awake_reward_cnmod_json_1.default);
