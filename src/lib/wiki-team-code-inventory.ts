import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PlayerCharacter, PlayerEquipment } from "../data/types"
import { PublicTeam, TEAM_GROUPS, TeamCodeError, wikiPublicId } from "./wiki-team-code-client"

export interface NativeTeam { main: (number | null)[]; unison: (number | null)[]; weapon: (number | null)[]; soul: (number | null)[] }
export interface TeamInventory {
    characters: Record<string, PlayerCharacter>
    equipment: Record<string, PlayerEquipment>
    items: Record<string, number>
    nodes: (characterId: number) => number[]
}
export interface TeamAssets { characters: Map<string, number>; equipment: Map<string, number>; souls: Map<number, number>; maxLevels: Record<string, number> }
export function loadTeamCodeAssets(): TeamAssets {
    const read = (name: string) => JSON.parse(readFileSync(join(__dirname, "..", "..", "assets", name), "utf8"))
    const characters = read("character.json"), maxLevels = read("equipment_max_level.json"), dissolve = read("equipment_dissolve.json")
    const map = (kind: "c" | "w", entries: object) => new Map(Object.keys(entries).filter((id) => /^[1-9]\d*$/.test(id))
        .map((id) => [wikiPublicId(kind, id), Number(id)]))
    const souls = new Map<number, number>()
    for (const [id, raw] of Object.entries(dissolve)) {
        const item = raw as {generate_ability_soul?: boolean; ability_soul_id?: number}
        if (item.generate_ability_soul === true && Number.isSafeInteger(item.ability_soul_id) && item.ability_soul_id! > 0)
            souls.set(Number(id), item.ability_soul_id!)
    }
    return {characters: map("c", characters), equipment: map("w", maxLevels), souls, maxLevels}
}
export function resolvePublicTeam(team: PublicTeam, assets: TeamAssets): NativeTeam {
    const native = {} as NativeTeam
    for (const group of TEAM_GROUPS) native[group] = team[group].map((id) => {
        if (!id) return null
        const value = (group === "main" || group === "unison" ? assets.characters : assets.equipment).get(id)
        if (value === undefined) throw new TeamCodeError("incompatible")
        if (group !== "soul") return value
        const soul = assets.souls.get(value)
        if (soul === undefined) throw new TeamCodeError("incompatible")
        return soul
    })
    return native
}
/** A save row is the first equipment; stack counts only its extra copies. No inventory is consumed. */
export function ownedTeam(team: NativeTeam, inventory: TeamInventory, assets: TeamAssets): NativeTeam {
    const result = {} as NativeTeam, seen = new Set<number>(), equipmentUse = new Map<number, number>(), soulUse = new Map<number, number>()
    const characters = new Set(assets.characters.values()), equipment = new Set(assets.equipment.values()), souls = new Set(assets.souls.values())
    for (const group of TEAM_GROUPS) result[group] = Array.from({length: 3}, (_, index) => {
        const id = team[group]?.[index]
        if (!Number.isSafeInteger(id) || !id || id < 0) return null
        if (group === "main" || group === "unison") {
            if (!characters.has(id) || !inventory.characters[id] || seen.has(id)) return null
            seen.add(id); return id
        }
        if (group === "weapon") {
            const owned = inventory.equipment[id], count = (equipmentUse.get(id) || 0) + 1
            if (!equipment.has(id) || !owned || !Number.isSafeInteger(owned.stack) || owned.stack < 0 || count > owned.stack + 1) return null
            equipmentUse.set(id, count); return id
        }
        const count = (soulUse.get(id) || 0) + 1
        if (!souls.has(id) || !Number.isSafeInteger(inventory.items[id]) || count > inventory.items[id]) return null
        soulUse.set(id, count); return id
    })
    return result
}
export function nativeBattleParty(team: NativeTeam, inventory: TeamInventory, assets: TeamAssets) {
    const own = ownedTeam(team, inventory, assets)
    const character = (id: number | null) => {
        if (id === null) return null
        const data = inventory.characters[id]
        return {id, evolution_level: data.evolutionLevel, exp: data.exp, over_limit_step: data.overLimitStep,
            mana_node_ids: inventory.nodes(id), illustration_settings: data.illustrationSettings || null,
            ex_boost: data.exBoost ? {status_id: data.exBoost.statusId, ability_id_list: data.exBoost.abilityIdList} : null}
    }
    return {characters: own.main.map(character), unison_characters: own.unison.map(character), ability_soul_ids: own.soul,
        equipments: own.weapon.map((id) => id === null ? null : {equipment_id: id,
            level: Math.min(Math.max(1, inventory.equipment[id].level), assets.maxLevels[id] || 1)})}
}
