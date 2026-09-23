/** Existing IDs retain their order; append new characters to keep awarded degree IDs stable. */
export const CHARACTER_DEGREE_CHARACTER_IDS: readonly number[] = Object.freeze([
    119989, 119996, 119997, 129952, 129992, 129997, 129999, 139995,
    139997, 139998, 139999, 149988, 149989, 149990, 149995, 149996,
    149997, 149999, 169989, 169996, 169997, 169998, 169999, 179999,
    119992, 119991, 119990, 139992, 139991, 139990,
    149987, 149986, 159995, 159994, 169991, 169988,
]);

export const CHARACTER_DEGREE_CATALOG = Object.freeze(
    CHARACTER_DEGREE_CHARACTER_IDS.map((characterId, index) => Object.freeze({
        character_id: characterId,
        degree_ids: Object.freeze([
            9_910_001 + 2 * index, 9_910_002 + 2 * index,
            ...(characterId === 139990 ? [9_910_073, 9_910_074, 9_910_075] : []),
        ]),
    })),
);

export const CHARACTER_DEGREE_LEVEL_100_EXP = 379_988;
export const CHARACTER_DEGREE_MAX_OVER_LIMIT = 4;

/** Match the reviewed client rows exactly; an activation file cannot expand the roster. */
export function isCharacterDegreeActivation(value: unknown): value is { enabled: boolean } {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const config = value as Record<string, unknown>;
    if (Object.keys(config).sort().join(",") !== "characters,enabled,schema_version"
        || config.schema_version !== 1 || typeof config.enabled !== "boolean"
        || !Array.isArray(config.characters)
        || config.characters.length !== CHARACTER_DEGREE_CATALOG.length) return false;
    return config.characters.every((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
        const entry = raw as Record<string, unknown>;
        const expected = CHARACTER_DEGREE_CATALOG[index];
        return Object.keys(entry).sort().join(",") === "character_id,degree_ids"
            && entry.character_id === expected.character_id
            && Array.isArray(entry.degree_ids) && entry.degree_ids.length === expected.degree_ids.length
            && entry.degree_ids.every((id, variant) => id === expected.degree_ids[variant]);
    });
}

export function isCharacterDegreeEligible(character: {
    exp: number;
    over_limit_step: number;
}): boolean {
    return Number.isSafeInteger(character.exp)
        && character.exp >= CHARACTER_DEGREE_LEVEL_100_EXP
        && character.over_limit_step === CHARACTER_DEGREE_MAX_OVER_LIMIT;
}
