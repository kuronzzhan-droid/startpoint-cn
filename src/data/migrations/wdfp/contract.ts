import type { Database } from "better-sqlite3"

export interface DormantWdfpMigration {
    readonly id: string
    apply(database: Database): void
}
