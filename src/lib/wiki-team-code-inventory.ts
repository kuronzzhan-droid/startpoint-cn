import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { PlayerCharacter, PlayerEquipment } from "../data/types"
import { serverCharacters } from "./content-master"
import { PublicTeam, TEAM_GROUPS, TeamCodeError, wikiPublicId } from "./wiki-team-code-client"

export interface NativeTeam {
    main: (number | null)[]
    unison: (number | null)[]
    weapon: (number | null)[]
    soul: (number | null)[]
}

export interface TeamInventory {
    characters: Record<string, PlayerCharacter>
    equipment: Record<string, PlayerEquipment>
    items: Record<string, number>
    nodes: (characterId: number) => number[]
}

export interface TeamAssets {
    characters: Map<string, number>
    equipment: Map<string, number>
    souls: Map<number, number>
    maxLevels: Record<string, number>
}

let cachedAssets: TeamAssets | undefined

function readObject(name: string): Record<string, unknown> {
    const value: unknown = JSON.parse(readFileSync(
        join(__dirname, "..", "..", "assets", name),
        "utf8",
    ))
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid team code asset: ${name}`)
    }
    return value as Record<string, unknown>
}

export function loadTeamCodeAssets(): TeamAssets {
    if (cachedAssets) return cachedAssets
    // Same merged roster the rest of the server uses: base table plus the
    // rank_p5b overlay that carries later MOD characters.
    const characters: Record<string, unknown> = serverCharacters
    const maxLevels = readObject("equipment_max_level.json")
    const dissolve = readObject("equipment_dissolve.json")
    const map = (kind: "c" | "w", entries: Record<string, unknown>) =>
        new Map(Object.keys(entries)
            .filter(id => /^[1-9]\d*$/.test(id))
            .map(id => [wikiPublicId(kind, id), Number(id)] as [string, number]))
    const souls = new Map<number, number>()
    for (const [id, raw] of Object.entries(dissolve)) {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue
        const item = raw as { generate_ability_soul?: unknown; ability_soul_id?: unknown }
        if (item.generate_ability_soul === true
            && Number.isSafeInteger(item.ability_soul_id)
            && Number(item.ability_soul_id) > 0) {
            souls.set(Number(id), Number(item.ability_soul_id))
        }
    }
    cachedAssets = {
        characters: map("c", characters),
        equipment: map("w", maxLevels),
        souls,
        maxLevels: Object.fromEntries(Object.entries(maxLevels)
            .filter(([id, value]) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(value))
            .map(([id, value]) => [id, Number(value)])),
    }
    return cachedAssets
}

/**
 * Maps public IDs to this server's IDs. An ID this server does not know
 * (content that has not reached it yet) leaves that slot empty, like an
 * unowned slot; only an unknown leader makes the whole code incompatible.
 */
export function resolvePublicTeam(team: PublicTeam, assets: TeamAssets): NativeTeam {
    const native = {} as NativeTeam
    for (const group of TEAM_GROUPS) {
        native[group] = team[group].map((id) => {
            if (!id) return null
            const source = group === "main" || group === "unison"
                ? assets.characters
                : assets.equipment
            const value = source.get(id)
            if (value === undefined) return null
            if (group !== "soul") return value
            return assets.souls.get(value) ?? null
        })
    }
    if (native.main[0] === null) throw new TeamCodeError("incompatible")
    return native
}

/** Projects a code onto current inventory without consuming or mutating it. */
export function ownedTeam(
    team: NativeTeam,
    inventory: TeamInventory,
    assets: TeamAssets,
): NativeTeam {
    const result = {} as NativeTeam
    const seenCharacters = new Set<number>()
    const equipmentUse = new Map<number, number>()
    const soulUse = new Map<number, number>()
    const characters = new Set(assets.characters.values())
    const equipment = new Set(assets.equipment.values())
    const souls = new Set(assets.souls.values())

    for (const group of TEAM_GROUPS) {
        result[group] = Array.from({ length: 3 }, (_, index) => {
            const id = team[group]?.[index]
            if (!Number.isSafeInteger(id) || !id || id < 0) return null
            if (group === "main" || group === "unison") {
                if (!characters.has(id) || !inventory.characters[id] || seenCharacters.has(id)) return null
                seenCharacters.add(id)
                return id
            }
            if (group === "weapon") {
                const owned = inventory.equipment[id]
                const count = (equipmentUse.get(id) || 0) + 1
                if (!equipment.has(id)
                    || !owned
                    || !Number.isSafeInteger(owned.stack)
                    || owned.stack < 0
                    || count > owned.stack + 1) return null
                equipmentUse.set(id, count)
                return id
            }
            const count = (soulUse.get(id) || 0) + 1
            if (!souls.has(id)
                || !Number.isSafeInteger(inventory.items[id])
                || count > inventory.items[id]) return null
            soulUse.set(id, count)
            return id
        })
    }
    return result
}

export function nativeBattleParty(
    team: NativeTeam,
    inventory: TeamInventory,
    assets: TeamAssets,
) {
    const own = ownedTeam(team, inventory, assets)
    // A native battle party without a projected leader cannot be consumed by
    // the client. Reject it before reading any other character data.
    if (own.main[0] === null) throw new TeamCodeError("incompatible")
    const character = (id: number | null) => {
        if (id === null) return null
        const data = inventory.characters[id]
        return {
            id,
            evolution_level: data.evolutionLevel,
            exp: data.exp,
            over_limit_step: data.overLimitStep,
            mana_node_ids: inventory.nodes(id),
            illustration_settings: data.illustrationSettings || null,
            ex_boost: data.exBoost
                ? { status_id: data.exBoost.statusId, ability_id_list: data.exBoost.abilityIdList }
                : null,
        }
    }
    return {
        characters: own.main.map(character),
        unison_characters: own.unison.map(character),
        ability_soul_ids: own.soul,
        equipments: own.weapon.map(id => id === null ? null : {
            equipment_id: id,
            level: Math.min(Math.max(1, inventory.equipment[id].level), assets.maxLevels[id] || 1),
        }),
    }
}
