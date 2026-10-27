import type { Database } from "better-sqlite3"
import { migrateWeaponRivenQualities } from "./weapon-riven-quality"

/** Additive migration; runs before any HTTP or writer-worker requests. */
export function initializeWeaponRivens(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS player_weapon_riven_sequences (
            player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
            last_id INTEGER NOT NULL CHECK(last_id >= 0)
        );
        CREATE TABLE IF NOT EXISTS player_weapon_rivens (
            player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            riven_id INTEGER NOT NULL CHECK(riven_id > 0),
            item_id INTEGER NOT NULL CHECK(item_id BETWEEN 16000001 AND 16000200),
            weapon_id INTEGER NOT NULL CHECK(weapon_id > 0),
            affixes_json TEXT NOT NULL,
            roll_count INTEGER NOT NULL DEFAULT 0 CHECK(roll_count >= 0),
            revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
            pending_json TEXT,
            source_key TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(player_id, riven_id),
            UNIQUE(player_id, item_id),
            UNIQUE(player_id, source_key)
        );
    `)
    const rivenColumns = db.prepare("PRAGMA table_info(player_weapon_rivens)").all() as { name: string }[]
    // Append on fresh databases too, keeping their portable column order equal
    // to an upgraded v1.1 database without rebuilding any existing card rows.
    for (const column of ["locked", "seen"]) {
        if (!rivenColumns.some(existing => existing.name === column)) {
            db.exec(`ALTER TABLE player_weapon_rivens ADD COLUMN ${column}
                INTEGER NOT NULL DEFAULT 0 CHECK(${column} IN (0,1))`)
        }
    }
    if (!rivenColumns.some(existing => existing.name === "affix_version")) {
        db.exec(`ALTER TABLE player_weapon_rivens ADD COLUMN affix_version
            INTEGER NOT NULL DEFAULT 1 CHECK(affix_version IN (1,3))`)
    }
    for (const table of ["five_boss_solo_runs", "five_boss_gauntlet_members"]) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        if (!columns.some(column => column.name === "riven_loadout_json")) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN riven_loadout_json TEXT NOT NULL DEFAULT '{}'`)
        }
    }
    migrateWeaponRivenQualities(db)
}
