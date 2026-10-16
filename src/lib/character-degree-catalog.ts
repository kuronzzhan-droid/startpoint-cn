/** Stable append-only nameplate roster, excluding bosses and minibosses. */
export const CHARACTER_DEGREE_CHARACTER_IDS: readonly number[] = Object.freeze([
    119989, 119996, 119997, 129952, 129992, 129997, 129999, 139995,
    139997, 139998, 139999, 149988, 149989, 149990, 149995, 149996,
    149997, 149999, 169989, 169996, 169997, 169998, 169999, 179999,
    139994, 139993, 159998, 159997, 159996, 169992, 129991,
    119992, 119991, 119990, 139992, 139991, 139990, 149987, 149986,
    159995, 159994, 169991, 169988, 169978,
])

const CHARACTER_DEGREE_LEGACY_CATALOG = CHARACTER_DEGREE_CHARACTER_IDS
    .slice(0, 31)
    .map((characterId, index) => Object.freeze({
        character_id: characterId,
        degree_ids: Object.freeze([9_910_001 + 2 * index, 9_910_002 + 2 * index]),
    }))

const CHARACTER_DEGREE_AUTHOR_CATALOG = [
    [119992, [9_910_063, 9_910_064]],
    [119991, [9_910_065, 9_910_066]],
    [119990, [9_910_067, 9_910_068]],
    [139992, [9_910_069, 9_910_070]],
    [139991, [9_910_071, 9_910_072]],
    [139990, [9_910_073, 9_910_074, 9_910_087, 9_910_088, 9_910_089]],
    [149987, [9_910_075, 9_910_076]],
    [149986, [9_910_077, 9_910_078]],
    [159995, [9_910_079, 9_910_080]],
    [159994, [9_910_081, 9_910_082]],
    [169991, [9_910_083, 9_910_084]],
    [169988, [9_910_085, 9_910_086]],
    [169978, [9_910_090, 9_910_091]],
] as const

export const CHARACTER_DEGREE_CATALOG = Object.freeze([
    ...CHARACTER_DEGREE_LEGACY_CATALOG,
    ...CHARACTER_DEGREE_AUTHOR_CATALOG.map(([character_id, degree_ids]) => Object.freeze({
        character_id,
        degree_ids: Object.freeze([...degree_ids]),
    })),
])

export const CHARACTER_DEGREE_LEVEL_100_EXP = 379_988
export const CHARACTER_DEGREE_MAX_OVER_LIMIT = 4

/** The activation switch cannot redirect rewards or expand the reviewed roster. */
export function isCharacterDegreeActivation(value: unknown): value is { enabled: boolean } {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const config = value as Record<string, unknown>
    if (Object.keys(config).sort().join(",") !== "characters,enabled,schema_version"
        || config.schema_version !== 1 || typeof config.enabled !== "boolean"
        || !Array.isArray(config.characters)
        || config.characters.length !== CHARACTER_DEGREE_CATALOG.length) return false
    return config.characters.every((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false
        const entry = raw as Record<string, unknown>
        const expected = CHARACTER_DEGREE_CATALOG[index]
        return Object.keys(entry).sort().join(",") === "character_id,degree_ids"
            && entry.character_id === expected.character_id
            && Array.isArray(entry.degree_ids)
            && entry.degree_ids.length === expected.degree_ids.length
            && entry.degree_ids.every((id, variant) => id === expected.degree_ids[variant])
    })
}

export function isCharacterDegreeEligible(character: {
    exp: number
    over_limit_step: number
}): boolean {
    return Number.isSafeInteger(character.exp)
        && character.exp >= CHARACTER_DEGREE_LEVEL_100_EXP
        && character.over_limit_step === CHARACTER_DEGREE_MAX_OVER_LIMIT
}
