"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCharacterDegreeEligible = exports.isCharacterDegreeActivation = exports.CHARACTER_DEGREE_MAX_OVER_LIMIT = exports.CHARACTER_DEGREE_LEVEL_100_EXP = exports.CHARACTER_DEGREE_CATALOG = exports.CHARACTER_DEGREE_CHARACTER_IDS = void 0;
/** Stable append-only nameplate roster, excluding bosses and minibosses. */
exports.CHARACTER_DEGREE_CHARACTER_IDS = Object.freeze([
    119989, 119996, 119997, 129952, 129992, 129997, 129999, 139995,
    139997, 139998, 139999, 149988, 149989, 149990, 149995, 149996,
    149997, 149999, 169989, 169996, 169997, 169998, 169999, 179999,
    139994, 139993, 159998, 159997, 159996, 169992, 129991,
    119992, 119991, 119990, 139992, 139991, 139990, 149987, 149986,
    159995, 159994, 169991, 169988, 169978,
]);
const CHARACTER_DEGREE_LEGACY_CATALOG = exports.CHARACTER_DEGREE_CHARACTER_IDS
    .slice(0, 31)
    .map((characterId, index) => Object.freeze({
    character_id: characterId,
    degree_ids: Object.freeze([9910001 + 2 * index, 9910002 + 2 * index]),
}));
const CHARACTER_DEGREE_AUTHOR_CATALOG = [
    [119992, [9910063, 9910064]],
    [119991, [9910065, 9910066]],
    [119990, [9910067, 9910068]],
    [139992, [9910069, 9910070]],
    [139991, [9910071, 9910072]],
    [139990, [9910073, 9910074, 9910087, 9910088, 9910089]],
    [149987, [9910075, 9910076]],
    [149986, [9910077, 9910078]],
    [159995, [9910079, 9910080]],
    [159994, [9910081, 9910082]],
    [169991, [9910083, 9910084]],
    [169988, [9910085, 9910086]],
    [169978, [9910090, 9910091]],
];
exports.CHARACTER_DEGREE_CATALOG = Object.freeze([
    ...CHARACTER_DEGREE_LEGACY_CATALOG,
    ...CHARACTER_DEGREE_AUTHOR_CATALOG.map(([character_id, degree_ids]) => Object.freeze({
        character_id,
        degree_ids: Object.freeze([...degree_ids]),
    })),
]);
exports.CHARACTER_DEGREE_LEVEL_100_EXP = 379988;
exports.CHARACTER_DEGREE_MAX_OVER_LIMIT = 4;
/** The activation switch cannot redirect rewards or expand the reviewed roster. */
function isCharacterDegreeActivation(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const config = value;
    if (Object.keys(config).sort().join(",") !== "characters,enabled,schema_version"
        || config.schema_version !== 1 || typeof config.enabled !== "boolean"
        || !Array.isArray(config.characters)
        || config.characters.length !== exports.CHARACTER_DEGREE_CATALOG.length)
        return false;
    return config.characters.every((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            return false;
        const entry = raw;
        const expected = exports.CHARACTER_DEGREE_CATALOG[index];
        return Object.keys(entry).sort().join(",") === "character_id,degree_ids"
            && entry.character_id === expected.character_id
            && Array.isArray(entry.degree_ids)
            && entry.degree_ids.length === expected.degree_ids.length
            && entry.degree_ids.every((id, variant) => id === expected.degree_ids[variant]);
    });
}
exports.isCharacterDegreeActivation = isCharacterDegreeActivation;
function isCharacterDegreeEligible(character) {
    return Number.isSafeInteger(character.exp)
        && character.exp >= exports.CHARACTER_DEGREE_LEVEL_100_EXP
        && character.over_limit_step === exports.CHARACTER_DEGREE_MAX_OVER_LIMIT;
}
exports.isCharacterDegreeEligible = isCharacterDegreeEligible;
