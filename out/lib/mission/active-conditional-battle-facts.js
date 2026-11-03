"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordActiveMissionConditionalBattleFactsSync = exports.collectActiveMissionConditionalBattleFacts = exports.hasCompletedSecondManaBoardAbilities = void 0;
const content_snapshot_1 = require("../../content/runtime/content-snapshot");
const character_1 = require("../../data/domains/character");
const active_mission_battle_condition_facts_1 = require("../../data/domains/active_mission_battle_condition_facts");
const assets_1 = require("../assets");
const active_master_data_1 = require("./active-master-data");
const active_reconciliation_1 = require("./active-reconciliation");
const CONDITIONAL_PATTERNS = new Set([71, 72, 73]);
const SECOND_MANA_BOARD_ABILITY_SLOTS = new Set(["4", "5", "6"]);
function hasCompletedSecondManaBoardAbilities(secondBoard, unlockedNodeIds) {
    const abilityNodeIds = Object.entries(secondBoard)
        .filter(([, node]) => { var _a; return SECOND_MANA_BOARD_ABILITY_SLOTS.has((_a = node.field6) !== null && _a !== void 0 ? _a : ""); })
        .map(([nodeId]) => Number(nodeId))
        .filter(nodeId => Number.isSafeInteger(nodeId) && nodeId > 0);
    if (abilityNodeIds.length === 0)
        return false;
    const unlockedNodes = new Set(unlockedNodeIds);
    return abilityNodeIds.every(nodeId => unlockedNodes.has(nodeId));
}
exports.hasCompletedSecondManaBoardAbilities = hasCompletedSecondManaBoardAbilities;
function matchesBattleKind(battleKind, isMulti) {
    return battleKind === 3 || battleKind === 2 && isMulti || battleKind === 1 && !isMulti;
}
function collectActiveMissionConditionalBattleFacts(definitions, context, characters) {
    if (!context.questAccomplished)
        return [];
    const partyCharacterIds = new Set(context.partyCharacterIds);
    const matched = new Map();
    for (const definition of definitions) {
        try {
            const pattern = Number(definition.row[29]);
            if (!CONDITIONAL_PATTERNS.has(pattern))
                continue;
            const battleKind = Number(definition.row[32]);
            const characterId = Number(definition.row[43]);
            if (!Number.isSafeInteger(battleKind)
                || !Number.isSafeInteger(characterId)
                || !matchesBattleKind(battleKind, context.isMulti)
                || !partyCharacterIds.has(characterId)
                || !(0, active_reconciliation_1.matchesActiveMissionQuestRange)(definition.row, context.questCategory, context.questId))
                continue;
            const character = characters[String(characterId)];
            if (!character)
                continue;
            if (pattern === 71 && !character.secondBoardAbilitiesComplete)
                continue;
            if (pattern === 72 && character.level < 80)
                continue;
            if (pattern === 73 && character.level < 100)
                continue;
            matched.set(`${pattern}:${characterId}`, { pattern, characterId });
        }
        catch (_a) {
            continue;
        }
    }
    return [...matched.values()].sort((left, right) => (left.pattern - right.pattern || left.characterId - right.characterId));
}
exports.collectActiveMissionConditionalBattleFacts = collectActiveMissionConditionalBattleFacts;
function resolveRepository() {
    try {
        return (0, content_snapshot_1.getContentSnapshot)().repository;
    }
    catch (_a) {
        return undefined;
    }
}
function resolveDefinitions(repository) {
    if (!repository)
        return (0, active_master_data_1.getActiveMissionMasterDefinitionsByPatterns)([71, 72, 73]);
    try {
        return (0, active_master_data_1.getActiveMissionMasterDefinitionsByPatterns)([71, 72, 73], repository);
    }
    catch (_a) {
        return (0, active_master_data_1.getActiveMissionMasterDefinitionsByPatterns)([71, 72, 73]);
    }
}
function buildCharacterState(playerId, characterId, repository) {
    var _a, _b, _c, _d;
    const character = (0, character_1.getPlayerCharacterSync)(playerId, characterId);
    if (!character)
        return null;
    let rarity = (_a = (0, assets_1.getCharacterDataSync)(characterId)) === null || _a === void 0 ? void 0 : _a.rarity;
    if (repository) {
        try {
            rarity = (_c = (_b = repository.table("character.json")[String(characterId)]) === null || _b === void 0 ? void 0 : _b.rarity) !== null && _c !== void 0 ? _c : rarity;
        }
        catch (_e) {
            // Bundled character data remains the compatibility fallback.
        }
    }
    const secondBoard = (_d = (0, assets_1.getCharacterManaNodesSync)(characterId, 2)) !== null && _d !== void 0 ? _d : {};
    return {
        level: (0, active_reconciliation_1.estimateActiveMissionCharacterLevel)(Object.assign(Object.assign({}, character), { rarity })),
        secondBoardAbilitiesComplete: hasCompletedSecondManaBoardAbilities(secondBoard, (0, character_1.getPlayerCharacterManaNodesSync)(playerId, characterId)),
    };
}
function recordActiveMissionConditionalBattleFactsSync(context) {
    if (!context.questAccomplished)
        return;
    const repository = resolveRepository();
    const definitions = resolveDefinitions(repository);
    const partyCharacterIds = [...context.party.characters, ...context.party.unison_characters]
        .flatMap(character => (character === null || character === void 0 ? void 0 : character.id) ? [character.id] : []);
    const partyCharacterIdSet = new Set(partyCharacterIds);
    const targetCharacterIds = new Set(definitions.flatMap(definition => {
        const pattern = Number(definition.row[29]);
        const characterId = Number(definition.row[43]);
        return CONDITIONAL_PATTERNS.has(pattern)
            && Number.isSafeInteger(characterId)
            && partyCharacterIdSet.has(characterId)
            ? [characterId]
            : [];
    }));
    const characters = Object.fromEntries([...targetCharacterIds].flatMap(characterId => {
        const state = buildCharacterState(context.playerId, characterId, repository);
        return state ? [[String(characterId), state]] : [];
    }));
    const facts = collectActiveMissionConditionalBattleFacts(definitions, {
        questAccomplished: context.questAccomplished,
        isMulti: context.isMulti === true,
        questCategory: context.questCategory,
        questId: context.questId,
        partyCharacterIds,
    }, characters);
    for (const fact of facts) {
        (0, active_mission_battle_condition_facts_1.incrementActiveMissionConditionalBattleFactSync)(context.playerId, fact.pattern, fact.characterId);
    }
}
exports.recordActiveMissionConditionalBattleFactsSync = recordActiveMissionConditionalBattleFactsSync;
