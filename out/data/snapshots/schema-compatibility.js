"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePlayerSnapshotSchemaCompatibility = exports.getPlayerSnapshotSchemaFingerprint = exports.compatibleSnapshotColumns = void 0;
const crypto_1 = require("crypto");
function compatibleSnapshotColumns(table, columns, compatibility) {
    return columns.filter(column => !(compatibility.beforeAbyssTowerRevision && table === "players_rush_events" && column.name === "tower_revision")
        && !(compatibility.beforeWeaponRivenFlags && table === "player_weapon_rivens"
            && (column.name === "locked" || column.name === "seen"))
        && !(compatibility.beforeWeaponRivenQuality && table === "player_weapon_rivens" && column.name === "affix_version"));
}
exports.compatibleSnapshotColumns = compatibleSnapshotColumns;
function getPlayerSnapshotSchemaFingerprint(tables, getTableInfo, compatibility = {}) {
    const schema = tables.filter(table => !(compatibility.beforeWeaponRiven && table === "player_weapon_rivens"))
        .map(table => ({ table, columns: compatibleSnapshotColumns(table, getTableInfo(table), compatibility)
            .map(column => ({ name: column.name, type: column.type, notnull: column.notnull,
            defaultValue: column.dflt_value, pk: column.pk })) }));
    return (0, crypto_1.createHash)("sha256").update(JSON.stringify(schema)).digest("hex");
}
exports.getPlayerSnapshotSchemaFingerprint = getPlayerSnapshotSchemaFingerprint;
/** Accept only exact historical schemas; never infer compatibility from missing columns. */
function resolvePlayerSnapshotSchemaCompatibility(fingerprint, tables, getTableInfo) {
    const versions = [
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
    ];
    const version = versions.find(candidate => fingerprint === getPlayerSnapshotSchemaFingerprint(tables, getTableInfo, candidate));
    if (!version)
        throw new Error("存档数据库结构与当前服务器不一致，拒绝执行覆盖；请先使用匹配版本迁移");
    return version;
}
exports.resolvePlayerSnapshotSchemaCompatibility = resolvePlayerSnapshotSchemaCompatibility;
