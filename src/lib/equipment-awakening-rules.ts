// Which item may pay for one level of equipment awakening (POST /equipment/upgrade with use_stack=false).
//
// The client picks the awakening item by equipment rarity only
// (OwnedItemRepository.getEquipmentAwakingCrystal: "c11 && rarity <= c10" or "rarity == c10"), and the
// server used to accept any owned item. Data lives in assets/equipment_awakening_material.json:
//
//   materialByEquipment  equipment id -> the one item that awakens it (the cursed weapons and PARADOX take
//                        禁忌星铁 10000311 only). Mirrors custom_ability_string "awakening_material_<id>".
//   officialCrystals     item id -> { maxRarity } (item c11 = true) or { exactRarity } (c11 = false); the only
//                        items allowed on every other equipment (12001 ★4 星铁钢, 12002 ★5 星铁钢).
//   rarityOverrides      equipment id -> client rarity (equipment c11) wherever it differs from
//                        floor(id / 1e6); e.g. abyss weapons 80001xx and fantasy weapons 1000xx are ★5.
//
// Duplicate copies (use_stack=true) never consume an item, so they are always allowed here.

export type CrystalRarityRule =
    | { readonly kind: "max", readonly rarity: number }
    | { readonly kind: "exact", readonly rarity: number }

export interface AwakeningMaterialRules {
    readonly materialByEquipment: ReadonlyMap<number, number>
    readonly officialCrystals: ReadonlyMap<number, CrystalRarityRule>
    readonly rarityOverrides: ReadonlyMap<number, number>
}

export interface AwakeningItemRequest {
    /** Request body value; a numeric string is normalised so it cannot dodge the per-equipment lookup. */
    readonly equipmentId: unknown
    readonly useStack: unknown
    readonly itemId?: unknown
}

export type AwakeningItemCheck =
    | { readonly ok: true }
    | { readonly ok: false, readonly message: string }

const OK: AwakeningItemCheck = { ok: true }

function reject(message: string): AwakeningItemCheck {
    return { ok: false, message }
}

function isPositiveId(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isRarity(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5
}

function parseIdKey(key: string, where: string): number {
    const id = Number(key)
    if (!/^[1-9][0-9]*$/.test(key) || !isPositiveId(id)) {
        throw new Error(`equipment_awakening_material: ${where} key "${key}" is not a positive integer id`)
    }
    return id
}

function objectField(raw: Record<string, unknown>, name: string): Record<string, unknown> {
    const value = raw[name]
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`equipment_awakening_material: "${name}" must be an object`)
    }
    return value as Record<string, unknown>
}

/**
 * Validates the raw JSON of assets/equipment_awakening_material.json. Throws on any malformed entry so a
 * broken file fails at startup instead of silently opening or closing the whitelist.
 */
export function parseAwakeningMaterialRules(raw: unknown): AwakeningMaterialRules {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("equipment_awakening_material: top level must be an object")
    }
    const root = raw as Record<string, unknown>

    const materialByEquipment = new Map<number, number>()
    for (const [key, value] of Object.entries(objectField(root, "materialByEquipment"))) {
        const equipmentId = parseIdKey(key, "materialByEquipment")
        if (!isPositiveId(value)) {
            throw new Error(`equipment_awakening_material: materialByEquipment["${key}"] must be a positive integer item id`)
        }
        materialByEquipment.set(equipmentId, value)
    }

    const officialCrystals = new Map<number, CrystalRarityRule>()
    for (const [key, value] of Object.entries(objectField(root, "officialCrystals"))) {
        const itemId = parseIdKey(key, "officialCrystals")
        const rule = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>
        const keys = Object.keys(rule)
        if (keys.length === 1 && keys[0] === "maxRarity" && isRarity(rule.maxRarity)) {
            officialCrystals.set(itemId, { kind: "max", rarity: rule.maxRarity })
        } else if (keys.length === 1 && keys[0] === "exactRarity" && isRarity(rule.exactRarity)) {
            officialCrystals.set(itemId, { kind: "exact", rarity: rule.exactRarity })
        } else {
            throw new Error(`equipment_awakening_material: officialCrystals["${key}"] must be {"maxRarity": 1-5} or {"exactRarity": 1-5}`)
        }
    }
    if (officialCrystals.size === 0) {
        throw new Error("equipment_awakening_material: officialCrystals is empty")
    }

    // A material that is also an official crystal would be offered by the native client logic to every
    // equipment of that rarity, which is exactly what the per-equipment material exists to prevent.
    for (const [equipmentId, itemId] of materialByEquipment) {
        if (officialCrystals.has(itemId)) {
            throw new Error(`equipment_awakening_material: material ${itemId} of equipment ${equipmentId} is also an official crystal`)
        }
    }

    // Required (may be {}): without it abyss/fantasy ★5 weapons would read as rarity 8/0 and lose 12002.
    const rarityOverrides = new Map<number, number>()
    for (const [key, value] of Object.entries(objectField(root, "rarityOverrides"))) {
        const equipmentId = parseIdKey(key, "rarityOverrides")
        if (!isRarity(value)) {
            throw new Error(`equipment_awakening_material: rarityOverrides["${key}"] must be a rarity 1-5`)
        }
        rarityOverrides.set(equipmentId, value)
    }

    return { materialByEquipment, officialCrystals, rarityOverrides }
}

/**
 * The equipment's rarity as the client sees it (equipment c11). Most ids carry it in the millions digit.
 */
export function resolveEquipmentRarity(rules: AwakeningMaterialRules, equipmentId: number): number {
    return rules.rarityOverrides.get(equipmentId) ?? Math.floor(equipmentId / 1_000_000)
}

function crystalFits(rule: CrystalRarityRule, rarity: number): boolean {
    return rule.kind === "max" ? rarity <= rule.rarity : rarity === rule.rarity
}

/**
 * Decides whether `itemId` may pay for awakening `equipmentId`. Restricted equipment accepts only its own
 * material; everything else accepts only an official crystal that fits its rarity. Duplicates are always fine.
 */
export function checkAwakeningItem(rules: AwakeningMaterialRules, request: AwakeningItemRequest): AwakeningItemCheck {
    // Same truthiness the route uses to pick the duplicate path.
    if (request.useStack) return OK

    const equipmentId = typeof request.equipmentId === "string" && request.equipmentId.trim() !== ""
        ? Number(request.equipmentId)
        : request.equipmentId
    if (!isPositiveId(equipmentId)) return reject("Invalid equipment_id.")
    const { itemId } = request
    if (!isPositiveId(itemId)) return reject("Awakening without duplicates needs an item_id.")

    const material = rules.materialByEquipment.get(equipmentId)
    if (material !== undefined) {
        return itemId === material
            ? OK
            : reject(`Equipment ${equipmentId} can only be awakened with duplicates or item ${material}.`)
    }

    const crystal = rules.officialCrystals.get(itemId)
    if (crystal === undefined) return reject(`Item ${itemId} is not an awakening item for equipment ${equipmentId}.`)

    const rarity = resolveEquipmentRarity(rules, equipmentId)
    return crystalFits(crystal, rarity)
        ? OK
        : reject(`Item ${itemId} does not fit equipment ${equipmentId} (rarity ${rarity}).`)
}
