// Character race lookup — loaded from the server-bundled CDN master at startup.
// CDN character.json: row[4] = comma-separated race names (e.g., "Human,Beast")

import characterMaster from "../../../../assets/cdndata/character.json"

const charRaceMap: Record<string, string[]> = {}

function init() {
    for (const [charId, rows] of Object.entries(characterMaster as Record<string, unknown>)) {
        if (!Array.isArray(rows)) continue
        const r = rows[0]
        if (!r || !Array.isArray(r)) continue
        const raceStr = String(r[4] || "")
        const races = raceStr ? raceStr.split(",").map((s: string) => s.trim()).filter((s: string) => s !== "") : []
        if (races.length > 0) charRaceMap[charId] = races
    }
}
init()

/** Returns the races for a character by ID (numeric or string) */
export function getCharacterRaces(charId: number | string): string[] {
    return charRaceMap[String(charId)] || []
}

/** Build a sorted unique race key (e.g., "Dragon+Human") */
export function getRaceKey(races: string[]): string[] {
    return [...new Set(races.filter((r) => r !== ""))].sort()
}

/** Build a race key string from races */
export function getRaceKeyString(races: string[]): string {
    return getRaceKey(races).join("+")
}
