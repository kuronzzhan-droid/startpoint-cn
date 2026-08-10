// ─── Active mission ID filter (C8601 prevention) ────────────────────────

import activeRewards from "../../../assets/mission_active_reward.json"
import type { ReadonlyContentRepository } from "../../content/runtime/content-snapshot"
import { getActiveMissionMasterDefinitions } from "./active-master-data"

const activeMissionIdSet: Set<number> = new Set(
    Object.keys(activeRewards as Record<string, any>).map(Number)
)

function getActiveMissionIdSet(repository?: ReadonlyContentRepository): ReadonlySet<number> {
    if (repository === undefined) return activeMissionIdSet
    return new Set(
        getActiveMissionMasterDefinitions(repository).map(definition => definition.missionId),
    )
}

export function isActiveMissionId(
    id: number | string,
    repository?: ReadonlyContentRepository,
): boolean {
    return getActiveMissionIdSet(repository).has(Number(id))
}

export function filterToActiveMissions<T>(
    missions: Record<string, T>,
    repository?: ReadonlyContentRepository,
): Record<string, T> {
    const out: Record<string, T> = {}
    const missionIdSet = getActiveMissionIdSet(repository)
    for (const [id, value] of Object.entries(missions)) {
        if (missionIdSet.has(Number(id))) out[id] = value
    }
    return out
}
