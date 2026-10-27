import type { Database } from "better-sqlite3"
import { weaponRivenRuleSet, WeaponRivenRuleSet } from "../../lib/weapon-riven/rules"
import { migrateWeaponRivenAffixes, WeaponRivenQualityMigration } from "../../lib/weapon-riven/migrate-quality"

interface MigrationRecord extends WeaponRivenQualityMigration {
    player_id: number; riven_id: number; item_id: number; weapon_id: number
    state: "current" | "pending"; draw_id?: string
}

/** One atomic pass for current and pending legacy levels. Imported rows use the same path. */
export function migrateWeaponRivenQualities(
    db: Database, playerId?: number, configuration: WeaponRivenRuleSet = weaponRivenRuleSet,
): number {
    if (configuration.rules.schema_version !== 3) return 0
    const records: MigrationRecord[] = []
    const changed = db.transaction(() => {
        const rows = db.prepare(`SELECT player_id,riven_id,item_id,weapon_id,affixes_json,pending_json,affix_version
            FROM player_weapon_rivens${playerId === undefined ? "" : " WHERE player_id=?"}`)
            .all(...(playerId === undefined ? [] : [playerId])) as {
                player_id: number; riven_id: number; item_id: number; weapon_id: number; affixes_json: string;
                pending_json: string | null; affix_version: 1 | 3;
            }[]
        const update = db.prepare(`UPDATE player_weapon_rivens SET affixes_json=?,pending_json=?,affix_version=3
            WHERE player_id=? AND riven_id=?`)
        let changed = 0
        for (const row of rows) {
            const pending = row.pending_json === null ? null : JSON.parse(row.pending_json)
            if (row.affix_version === 3 && (pending === null || pending.affix_version === 3)) continue
            const record = (state: "current" | "pending") => (change: WeaponRivenQualityMigration) => {
                records.push({player_id: row.player_id, riven_id: row.riven_id, item_id: row.item_id,
                    weapon_id: row.weapon_id, state, ...(state === "pending" ? {draw_id: pending.draw_id} : {}),
                    ...change})
            }
            const affixes = row.affix_version === 3 ? JSON.parse(row.affixes_json)
                : migrateWeaponRivenAffixes(row.weapon_id,JSON.parse(row.affixes_json),configuration,record("current"))
            if (pending !== null && pending.affix_version !== 3) {
                pending.affixes = migrateWeaponRivenAffixes(row.weapon_id,pending.affixes,configuration,record("pending"))
                pending.affix_version = 3
            }
            update.run(JSON.stringify(affixes),pending === null ? null : JSON.stringify(pending),row.player_id,row.riven_id)
            changed++
        }
        return changed
    })()
    // Emit conversion records only after this pass succeeds; never add audit metadata to card storage.
    for (const record of records) console.info("[weapon-riven:migrate-quality]", JSON.stringify(record))
    return changed
}
