import type { Database } from "better-sqlite3"

export interface AdminAccountBinding {
    account_id: number
    name: string | null
}

interface ForeignKeyRow {
    id: number
    seq: number
    table: string
    from: string
    to: string
    on_delete: string
}

interface IndexListRow {
    name: string
}

interface IndexInfoRow {
    seqno: number
    name: string
}

export function accountHasNote(bindings: AdminAccountBinding[]): boolean {
    return bindings.some(binding => typeof binding.name === "string" && binding.name.trim().length > 0)
}

export function selectUnnotedAccountIds(
    accountIds: number[],
    bindings: AdminAccountBinding[],
    activeAccountId: number | null,
): number[] {
    return accountIds.filter(accountId =>
        accountId !== activeAccountId
        && !accountHasNote(bindings.filter(binding => binding.account_id === accountId)),
    )
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, "\"\"")}"`
}

function hasSupportingIndex(database: Database, table: string, columns: string[]): boolean {
    const indexes = database.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all() as IndexListRow[]
    return indexes.some(index => {
        const indexedColumns = (
            database.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`).all() as IndexInfoRow[]
        )
            .sort((left, right) => left.seqno - right.seqno)
            .map(column => column.name)
        return columns.every((column, index) => indexedColumns[index] === column)
    })
}

/**
 * SQLite has to scan a child table for every cascaded parent-row deletion when
 * the child key is not indexed. Account cleanup touches many related tables, so
 * those scans become quadratic on a populated server. Add only the missing
 * indexes required by ON DELETE CASCADE constraints.
 */
export function ensureCascadeDeleteIndexes(database: Database): number {
    const tables = database.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all() as { name: string }[]

    let created = 0
    for (const { name: table } of tables) {
        const foreignKeys = database
            .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)
            .all() as ForeignKeyRow[]
        const cascadeGroups = new Map<number, ForeignKeyRow[]>()
        for (const foreignKey of foreignKeys) {
            if (foreignKey.on_delete.toUpperCase() !== "CASCADE") continue
            const group = cascadeGroups.get(foreignKey.id) ?? []
            group.push(foreignKey)
            cascadeGroups.set(foreignKey.id, group)
        }

        for (const [foreignKeyId, group] of cascadeGroups) {
            const columns = group
                .sort((left, right) => left.seq - right.seq)
                .map(foreignKey => foreignKey.from)
            if (columns.length === 0 || hasSupportingIndex(database, table, columns)) continue

            const safeTable = table.replace(/[^a-zA-Z0-9_]/g, "_")
            const indexName = `idx_cleanup_fk_${safeTable}_${foreignKeyId}`
            database.prepare(
                `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)}
                 ON ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})`,
            ).run()
            created += 1
        }
    }
    return created
}
