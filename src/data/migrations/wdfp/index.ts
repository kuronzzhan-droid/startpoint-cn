import type { Database } from "better-sqlite3"
import { awakeDegreeMigration } from "./awake-degree"
import { categoryMissionMigration } from "./category-mission"
import type { DormantWdfpMigration } from "./contract"
import { degreeQueryIndexMigration } from "./degree-query-index"
import { missionFactsMigration } from "./mission-facts"
import { passCardMigration } from "./pass-card"

const migrations: readonly DormantWdfpMigration[] = Object.freeze([
    categoryMissionMigration,
    passCardMigration,
    missionFactsMigration,
    awakeDegreeMigration,
    degreeQueryIndexMigration,
])

export const WDFP_MIGRATION_IDS: readonly string[] = Object.freeze(
    migrations.map(migration => migration.id),
)

/** Apply the reviewed Wave2a schema closure as one all-or-nothing unit. */
export function applyWdfpMigrations(database: Database): void {
    database.transaction(() => {
        for (const migration of migrations) migration.apply(database)
    })()
}
