import { stripWeaponRivenPartySouls } from "./client"

/** Room preview keeps unknown souls for conversion but never exposes private rows/context. */
export function stripWeaponRivenRoomPreview<T>(value: T): T {
    const visit = (node: any): any => {
        if (!node || typeof node !== "object") return node
        if (Array.isArray(node)) return node.map(visit)
        return Object.fromEntries(Object.entries(node)
            .filter(([key]) => !/^weapon_riven(?:s|_|$)/.test(key) && !/^user_weapon_riven/.test(key))
            .map(([key, child]) => [key, visit(child)]))
    }
    return visit(stripWeaponRivenPartySouls(value))
}
