import { stripIneffectiveWeaponRivenSouls } from "./party-limit"

/** Only the three original battle slots can consume an unknown riven. */
export interface WeaponRivenBattleLoadout {
    /** Saved NORMAL party selected at battle start; absent in historical loadouts. */
    partyId?: number
    abilitySoulIds: number[]
    equipmentIds: number[]
}

function slots(value: unknown): number[] {
    return [0, 1, 2].map(index => {
        const id = Array.isArray(value) ? value[index] : undefined
        return Number.isSafeInteger(id) && id > 0 ? id : 0
    })
}

export function normalizeWeaponRivenLoadout(value: unknown): WeaponRivenBattleLoadout {
    const input = value as Partial<WeaponRivenBattleLoadout> | null | undefined
    const loadout: WeaponRivenBattleLoadout = {
        abilitySoulIds: stripIneffectiveWeaponRivenSouls(slots(input?.abilitySoulIds)).map(id => id ?? 0),
        equipmentIds: slots(input?.equipmentIds),
    }
    // Keep this owner-side module independent of data modules, including data/types enums.
    if (typeof input?.partyId === "number" && Number.isInteger(input.partyId)
        && input.partyId >= 1 && input.partyId <= 120) loadout.partyId = input.partyId
    return loadout
}

export function parseWeaponRivenLoadout(json: string): WeaponRivenBattleLoadout {
    // Migration defaults are empty: never reconstruct an old battle from its current party.
    return normalizeWeaponRivenLoadout(JSON.parse(json))
}
