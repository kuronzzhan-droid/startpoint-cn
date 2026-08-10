import {
    getMissionMasterDefinitions,
    isMissionDefinitionEnabledAt,
    MISSION_CATEGORIES,
    MissionMasterDefinition,
} from "./master-data"

const CLIENT_REPORTED_PATTERN_PREFIXES: Readonly<Record<string, readonly string[]>> = Object.freeze({
    character_detail_zoom_illust_for_1min_count: ["degree_sukimono"],
    character_detail_play_dot_sp_motion_count: ["degree_dot_image_looking"],
    home_tap_town_character_count: ["degree_character_tap"],
    home_change_voice_count: ["degree_voice_change_in_home"],
    twitter_check: ["twitter_check"],
})

export interface ClientProgressTarget {
    category: number
    missionId: number
    eventId?: number
}

function matchesClientPattern(masterPattern: string, clientPattern: string): boolean {
    const prefixes = CLIENT_REPORTED_PATTERN_PREFIXES[clientPattern]
    return prefixes?.some(prefix => (
        masterPattern === prefix || masterPattern.startsWith(`${prefix}_`)
    )) ?? false
}

export function resolveClientProgressTargetsFromDefinitions(
    clientPattern: string,
    evaluationTime: Date,
    definitions: readonly MissionMasterDefinition[],
): ClientProgressTarget[] {
    if (!Object.prototype.hasOwnProperty.call(CLIENT_REPORTED_PATTERN_PREFIXES, clientPattern)) return []

    const targets: ClientProgressTarget[] = []
    for (const definition of definitions) {
        if (!matchesClientPattern(definition.pattern, clientPattern)) continue
        if (definition.eventId !== undefined) continue
        if (!isMissionDefinitionEnabledAt(definition, evaluationTime)) continue
        targets.push({ category: definition.category, missionId: definition.missionId })
    }
    return targets
}

export function resolveClientProgressTargets(
    clientPattern: string,
    evaluationTime: Date,
): ClientProgressTarget[] {
    const definitions: MissionMasterDefinition[] = []
    for (const category of MISSION_CATEGORIES) {
        definitions.push(...getMissionMasterDefinitions(category))
    }
    return resolveClientProgressTargetsFromDefinitions(clientPattern, evaluationTime, definitions)
}
