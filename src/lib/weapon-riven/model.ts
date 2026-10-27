export type WeaponRivenAffix = [number, number]
/** cap_L is response metadata; legacy affixes without a known definition retain two elements. */
export type WeaponRivenDisplayAffix = [number, number, number?]
export interface WeaponRivenAutoDismantled {
    weapon_id: number
    affixes: WeaponRivenDisplayAffix[]
    rewards: [number, number][]
}
export interface WeaponRivenView {
    riven_id: number
    weapon_id: number
    affixes: WeaponRivenDisplayAffix[]
    locked: 0 | 1
    seen: 0 | 1
    disposition: number
    dismantle_return: [number, number][]
    roll_count: number
    revision: number
    next_cost: number
    cost_options: [number, number][]
    pending: null | { draw_id: string; affixes: WeaponRivenDisplayAffix[] }
}
export interface WeaponRivenChanges {
    weapon_riven_list: Record<string, WeaponRivenView>
    weapon_riven_deleted: number[]
    item_list: Record<string, number>
}
export class WeaponRivenError extends Error {
    constructor(public readonly code: string, message: string, public readonly status = 400) {
        super(message)
        this.name = "WeaponRivenError"
    }
}
