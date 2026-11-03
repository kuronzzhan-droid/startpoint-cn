"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordActiveMissionLoadoutBattleFactsSync = exports.collectActiveMissionLoadoutBattleFacts = exports.collectBattleEquipmentElements = exports.getCharacterCapabilityCategories = exports.hasRegenerationCapability = exports.hasDirectHealCapability = exports.hasEnemyElementResistanceDownCapability = void 0;
const content_snapshot_1 = require("../../content/runtime/content-snapshot");
const active_mission_battle_facts_1 = require("../../data/domains/active_mission_battle_facts");
const content_master_1 = require("../content-master");
const assets_1 = require("../assets");
const active_master_data_1 = require("./active-master-data");
const active_reconciliation_1 = require("./active-reconciliation");
const ELEMENT_LOADOUT_PATTERN = 89;
const CHARACTER_CAPABILITY_PATTERN = 90;
const FULL_SKILL_START_PATTERN = 91;
const ELEMENT_RESISTANCE_DOWN_CATEGORY = "ACToleranceOfElement_Down";
const DIRECT_HEAL_CATEGORIES = Object.freeze(["CreateNormalHeal", "CreateRatioHeal"]);
const REGENERATION_CATEGORY = "ACRegeneration";
const SUPPORTED_CHARACTER_CAPABILITY_CATEGORIES = new Set([
    ELEMENT_RESISTANCE_DOWN_CATEGORY,
    ...DIRECT_HEAL_CATEGORIES,
    REGENERATION_CATEGORY,
]);
const LOADOUT_PATTERNS = new Set([
    ELEMENT_LOADOUT_PATTERN,
    CHARACTER_CAPABILITY_PATTERN,
    FULL_SKILL_START_PATTERN,
]);
const ELEMENT_RESISTANCE_DOWN_TEXT = /属性(?:抗性|耐性)(?:降低|下降)/;
const OWN_SIDE_RESISTANCE_DOWN_TEXT = /(?:自身|队伍全体)[^。；]{0,80}全?属性(?:抗性|耐性)(?:降低|下降)/;
const DIRECT_HEAL_TEXT = /(?:(?:回复|恢复)[^。；／\n]{0,48}(?:生命值|HP)|(?:生命值|HP)[^。；／\n]{0,48}(?:回复|恢复))/i;
const REGENERATION_TEXT = /再生(?:效果)?/;
function flattenText(value, output = []) {
    if (typeof value === "string")
        output.push(value);
    else if (Array.isArray(value)) {
        for (const item of value)
            flattenText(item, output);
    }
    else if (value && typeof value === "object") {
        for (const item of Object.values(value))
            flattenText(item, output);
    }
    return output;
}
function hasEnemyElementResistanceDownCapability(value) {
    return flattenText(value).some(text => ELEMENT_RESISTANCE_DOWN_TEXT.test(text)
        && (!OWN_SIDE_RESISTANCE_DOWN_TEXT.test(text) || /(?:敌人|敌方)/.test(text)));
}
exports.hasEnemyElementResistanceDownCapability = hasEnemyElementResistanceDownCapability;
function hasDirectHealCapability(value) {
    return flattenText(value).some(text => DIRECT_HEAL_TEXT.test(text));
}
exports.hasDirectHealCapability = hasDirectHealCapability;
function hasRegenerationCapability(value) {
    return flattenText(value).some(text => REGENERATION_TEXT.test(text));
}
exports.hasRegenerationCapability = hasRegenerationCapability;
const ELEMENT_RESISTANCE_DOWN_CHARACTER_IDS = new Set(Object.entries(content_master_1.cdnCharacterTexts)
    .filter(([, value]) => hasEnemyElementResistanceDownCapability(value))
    .map(([characterId]) => Number(characterId))
    .filter(characterId => Number.isSafeInteger(characterId) && characterId > 0));
const DIRECT_HEAL_CHARACTER_IDS = new Set(Object.entries(content_master_1.cdnCharacterTexts)
    .filter(([, value]) => hasDirectHealCapability(value))
    .map(([characterId]) => Number(characterId))
    .filter(characterId => Number.isSafeInteger(characterId) && characterId > 0));
const REGENERATION_CHARACTER_IDS = new Set(Object.entries(content_master_1.cdnCharacterTexts)
    .filter(([, value]) => hasRegenerationCapability(value))
    .map(([characterId]) => Number(characterId))
    .filter(characterId => Number.isSafeInteger(characterId) && characterId > 0));
const CHARACTER_STRING_IDS = new Map(Object.entries(content_master_1.cdnCharacters).flatMap(([rawCharacterId, value]) => {
    const characterId = Number(rawCharacterId);
    const stringId = Array.isArray(value) && Array.isArray(value[0]) ? value[0][0] : undefined;
    return Number.isSafeInteger(characterId) && characterId > 0
        && typeof stringId === "string" && stringId.length > 0
        ? [[characterId, stringId]]
        : [];
}));
function getCharacterCapabilityCategories(characterId) {
    const categories = new Set();
    if (ELEMENT_RESISTANCE_DOWN_CHARACTER_IDS.has(characterId)) {
        categories.add(ELEMENT_RESISTANCE_DOWN_CATEGORY);
    }
    if (DIRECT_HEAL_CHARACTER_IDS.has(characterId)) {
        for (const category of DIRECT_HEAL_CATEGORIES)
            categories.add(category);
    }
    if (REGENERATION_CHARACTER_IDS.has(characterId)) {
        categories.add(REGENERATION_CATEGORY);
    }
    return categories;
}
exports.getCharacterCapabilityCategories = getCharacterCapabilityCategories;
function collectBattleEquipmentElements(equipments) {
    if (!equipments)
        return [];
    const elements = new Set();
    for (const equipment of equipments) {
        const equipmentId = Number(equipment === null || equipment === void 0 ? void 0 : equipment.id);
        if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0)
            continue;
        const element = (0, assets_1.getEquipmentElement)(equipmentId);
        if (Number.isSafeInteger(element) && element >= 0 && element <= 5)
            elements.add(element);
    }
    return [...elements];
}
exports.collectBattleEquipmentElements = collectBattleEquipmentElements;
function matchesBattleKind(battleKind, isMulti) {
    return battleKind === 3 || battleKind === 2 && isMulti || battleKind === 1 && !isMulti;
}
function parseTargetElement(value) {
    const target = Number(value);
    return Number.isSafeInteger(target) && target >= 1 && target <= 6 ? target : null;
}
function matchesCharacterElement(targetElement, partyCharacterIds, characters) {
    if (targetElement === null)
        return false;
    for (const characterId of partyCharacterIds) {
        const character = characters[String(characterId)];
        if (character && typeof character.element === "number" && character.element + 1 === targetElement)
            return true;
    }
    return false;
}
function matchesEquipmentElement(rawTargetElement, equipmentElements) {
    if (rawTargetElement === undefined || rawTargetElement === null || rawTargetElement === "(None)")
        return true;
    const targetElement = parseTargetElement(rawTargetElement);
    if (targetElement === null || equipmentElements === undefined)
        return false;
    // The finish request contains ElementKind (0-based); the mission master uses ElementTargetKind (1-based).
    return equipmentElements.some(element => Number(element) + 1 === targetElement);
}
function parseAbilityCategories(value) {
    if (typeof value !== "string")
        return [];
    return value.split(",")
        .map(category => category.trim())
        .filter(category => category.length > 0 && category !== "(None)");
}
function matchesCharacterAbilityCategory(rawCategories, rawIgnoredCharacterStringIds, partyCharacterIds, characters) {
    const requiredCategories = parseAbilityCategories(rawCategories);
    if (requiredCategories.length === 0)
        return false;
    const ignoredCharacterStringIds = new Set(parseAbilityCategories(rawIgnoredCharacterStringIds));
    return [...partyCharacterIds].some(characterId => {
        const character = characters[String(characterId)];
        if ((character === null || character === void 0 ? void 0 : character.stringId) && ignoredCharacterStringIds.has(character.stringId))
            return false;
        const categories = character === null || character === void 0 ? void 0 : character.abilityCategories;
        return categories !== undefined && requiredCategories.some(category => categories.has(category));
    });
}
function hasThreeFullSkillGaugesOnStart(zones) {
    if (!Array.isArray(zones) || zones.length === 0)
        return false;
    let total = 0;
    for (const zone of zones) {
        const count = zone === null || zone === void 0 ? void 0 : zone.skill_point_over_on_start;
        if (!Number.isSafeInteger(count) || count < 0 || count > 3)
            return false;
        total += count;
        if (total > 3)
            return false;
    }
    return total === 3;
}
function collectActiveMissionLoadoutBattleFacts(definitions, context, characters) {
    if (!context.questAccomplished)
        return [];
    const partyCharacterIds = new Set(context.partyCharacterIds);
    const matched = [];
    for (const definition of definitions) {
        try {
            const pattern = Number(definition.row[29]);
            const battleKind = Number(definition.row[32]);
            if (!LOADOUT_PATTERNS.has(pattern)
                || !Number.isSafeInteger(battleKind)
                || !matchesBattleKind(battleKind, context.isMulti)
                || !(0, active_reconciliation_1.matchesActiveMissionQuestRange)(definition.row, context.questCategory, context.questId))
                continue;
            if (pattern === ELEMENT_LOADOUT_PATTERN && (!matchesCharacterElement(parseTargetElement(definition.row[69]), partyCharacterIds, characters)
                || !matchesEquipmentElement(definition.row[70], context.equipmentElements)))
                continue;
            if (pattern === CHARACTER_CAPABILITY_PATTERN
                && !matchesCharacterAbilityCategory(definition.row[71], definition.row[72], partyCharacterIds, characters))
                continue;
            if (pattern === FULL_SKILL_START_PATTERN
                && !hasThreeFullSkillGaugesOnStart(context.zones))
                continue;
            matched.push({ missionId: definition.missionId });
        }
        catch (_a) {
            continue;
        }
    }
    return matched.sort((left, right) => left.missionId - right.missionId);
}
exports.collectActiveMissionLoadoutBattleFacts = collectActiveMissionLoadoutBattleFacts;
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
        return (0, active_master_data_1.getActiveMissionMasterDefinitionsByPatterns)([89, 90, 91]);
    try {
        return (0, active_master_data_1.getActiveMissionMasterDefinitionsByPatterns)([89, 90, 91], repository);
    }
    catch (_a) {
        return (0, active_master_data_1.getActiveMissionMasterDefinitionsByPatterns)([89, 90, 91]);
    }
}
function recordActiveMissionLoadoutBattleFactsSync(context) {
    var _a, _b;
    if (!context.questAccomplished)
        return;
    const repository = resolveRepository();
    const definitions = resolveDefinitions(repository);
    const partyCharacterIds = [...context.party.characters, ...context.party.unison_characters]
        .flatMap(character => (character === null || character === void 0 ? void 0 : character.id) ? [character.id] : []);
    const targetCharacterIds = new Set(definitions.flatMap(definition => {
        const pattern = Number(definition.row[29]);
        const targetElement = parseTargetElement(definition.row[69]);
        const requiredCategories = parseAbilityCategories(definition.row[71]);
        return pattern === ELEMENT_LOADOUT_PATTERN && targetElement !== null
            || pattern === CHARACTER_CAPABILITY_PATTERN
                && requiredCategories.some(category => SUPPORTED_CHARACTER_CAPABILITY_CATEGORIES.has(category))
            ? partyCharacterIds
            : [];
    }));
    let characterTable = {};
    if (repository) {
        try {
            characterTable = repository.table("character.json");
        }
        catch (_c) {
            characterTable = {};
        }
    }
    const characters = {};
    for (const characterId of targetCharacterIds) {
        const element = (_a = characterTable === null || characterTable === void 0 ? void 0 : characterTable[String(characterId)]) === null || _a === void 0 ? void 0 : _a.element;
        const abilityCategories = getCharacterCapabilityCategories(characterId);
        const stringId = CHARACTER_STRING_IDS.get(characterId);
        if (Number.isSafeInteger(element) || abilityCategories.size > 0 || stringId !== undefined) {
            characters[String(characterId)] = {
                element: Number.isSafeInteger(element) ? element : undefined,
                stringId,
                abilityCategories,
            };
        }
    }
    const equipmentElements = (_b = context.equipmentElements) !== null && _b !== void 0 ? _b : collectBattleEquipmentElements(context.party.equipments);
    const facts = collectActiveMissionLoadoutBattleFacts(definitions, {
        questAccomplished: context.questAccomplished,
        isMulti: context.isMulti === true,
        questCategory: context.questCategory,
        questId: context.questId,
        partyCharacterIds,
        equipmentElements,
        zones: context.statistics.zones,
    }, characters);
    for (const fact of facts) {
        (0, active_mission_battle_facts_1.incrementActiveMissionBattleFactSync)(context.playerId, fact.missionId);
    }
}
exports.recordActiveMissionLoadoutBattleFactsSync = recordActiveMissionLoadoutBattleFactsSync;
