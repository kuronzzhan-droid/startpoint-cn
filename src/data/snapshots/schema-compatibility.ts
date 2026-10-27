import { createHash } from "crypto"

interface SnapshotSchemaColumn {
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
}

export interface SnapshotSchemaCompatibility {
    beforeAbyssTowerRevision?: boolean
    beforeWeaponRiven?: boolean
    beforeWeaponRivenFlags?: boolean
    beforeWeaponRivenQuality?: boolean
}

type GetTableInfo = (table: string) => SnapshotSchemaColumn[]

export function compatibleSnapshotColumns<T extends SnapshotSchemaColumn>(
    table: string, columns: T[], compatibility: SnapshotSchemaCompatibility,
): T[] {
    return columns.filter(column =>
        !(compatibility.beforeAbyssTowerRevision && table === "players_rush_events" && column.name === "tower_revision")
        && !(compatibility.beforeWeaponRivenFlags && table === "player_weapon_rivens"
            && (column.name === "locked" || column.name === "seen"))
        && !(compatibility.beforeWeaponRivenQuality && table === "player_weapon_rivens" && column.name === "affix_version"))
}

export function getPlayerSnapshotSchemaFingerprint(
    tables: readonly string[], getTableInfo: GetTableInfo, compatibility: SnapshotSchemaCompatibility = {},
): string {
    const schema = tables.filter(table => !(compatibility.beforeWeaponRiven && table === "player_weapon_rivens"))
        .map(table => ({ table, columns: compatibleSnapshotColumns(table, getTableInfo(table), compatibility)
            .map(column => ({ name: column.name, type: column.type, notnull: column.notnull,
                defaultValue: column.dflt_value, pk: column.pk })) }))
    return createHash("sha256").update(JSON.stringify(schema)).digest("hex")
}

/** Accept only exact historical schemas; never infer compatibility from missing columns. */
export function resolvePlayerSnapshotSchemaCompatibility(
    fingerprint: string, tables: readonly string[], getTableInfo: GetTableInfo,
): SnapshotSchemaCompatibility {
    const versions: SnapshotSchemaCompatibility[] = [
        {},
        { beforeAbyssTowerRevision: true },
        { beforeWeaponRivenQuality: true },
        { beforeAbyssTowerRevision: true, beforeWeaponRivenQuality: true },
        { beforeWeaponRivenFlags: true },
        { beforeAbyssTowerRevision: true, beforeWeaponRivenFlags: true },
        { beforeWeaponRivenFlags: true, beforeWeaponRivenQuality: true },
        { beforeAbyssTowerRevision: true, beforeWeaponRivenFlags: true, beforeWeaponRivenQuality: true },
        { beforeWeaponRiven: true },
        { beforeAbyssTowerRevision: true, beforeWeaponRiven: true },
    ]
    const version = versions.find(candidate =>
        fingerprint === getPlayerSnapshotSchemaFingerprint(tables, getTableInfo, candidate))
    if (!version) throw new Error("存档数据库结构与当前服务器不一致，拒绝执行覆盖；请先使用匹配版本迁移")
    return version
}
