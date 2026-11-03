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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCharacterLookup = void 0;
const character_table_json_1 = __importDefault(require("../../../docs/generated/character_table.json"));
const content_master_1 = require("../../lib/content-master");
const item_lookup_json_1 = __importDefault(require("../../../assets/item_lookup.json"));
const item_lookup_cnmod_json_1 = __importDefault(require("../../../assets/item_lookup_cnmod.json"));
const equipment_lookup_json_1 = __importDefault(require("../../../assets/equipment_lookup.json"));
const quest_lookup_json_1 = __importDefault(require("../../../assets/quest_lookup.json"));
const ELEMENT_NAMES = {
    0: "火",
    1: "水",
    2: "雷",
    3: "风",
    4: "光",
    5: "暗",
};
/**
 * Build the admin/mail lookup from the descriptive generated table, then fill
 * any newly-added server characters that the static table has not caught up
 * with yet.  The fallback deliberately leaves the title empty instead of
 * inventing metadata; the character remains selectable and identifiable.
 */
function buildCharacterLookup(generatedRows, serverRows) {
    var _a, _b;
    const result = {};
    for (const character of generatedRows) {
        result[character.id] = {
            name: character.name,
            title: character.title,
            rarity: character.rarity,
            element: character.element,
        };
    }
    for (const [characterIdText, character] of Object.entries(serverRows)) {
        const characterId = Number.parseInt(characterIdText, 10);
        if (!Number.isSafeInteger(characterId) || result[characterId] !== undefined)
            continue;
        result[characterId] = {
            name: ((_a = character.name) === null || _a === void 0 ? void 0 : _a.trim()) || characterIdText,
            title: "",
            rarity: Number.isFinite(character.rarity) ? `${character.rarity}★` : "",
            element: (_b = ELEMENT_NAMES[Number(character.element)]) !== null && _b !== void 0 ? _b : "",
        };
    }
    return result;
}
exports.buildCharacterLookup = buildCharacterLookup;
const charMap = buildCharacterLookup(character_table_json_1.default, content_master_1.serverCharacters);
const mergedItemLookup = Object.assign(Object.assign({}, item_lookup_json_1.default), item_lookup_cnmod_json_1.default);
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.get("/characters", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        return reply.send(charMap);
    }));
    fastify.get("/items", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        return reply.send(mergedItemLookup);
    }));
    fastify.get("/equipment", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        return reply.send(equipment_lookup_json_1.default);
    }));
    fastify.get("/quests", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        return reply.send(quest_lookup_json_1.default);
    }));
});
exports.default = routes;
