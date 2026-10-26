import { existsSync } from "../lib/file-exists";
/**
 * 默认存档模板：管理员上传一份存档快照，作为「账户新建存档」时的初始内容。
 * 持久化到 .database/default_save.json（与 active_account.json 同目录，均 gitignored）。
 * 快照格式与 GET /api/player/save 导出一致，只接受完整存档 V2。
 */
import * as fs from "fs";
import * as path from "path";
import { jsonFileIdentitySync, readValidatedJsonWithBackupSync, writeJsonAtomicSync } from "../lib/atomic-json-file";

const DATA_DIRECTORY = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(__dirname, "../../.database");
const FILE = path.join(DATA_DIRECTORY, "default_save.json");

export interface DefaultSaveSnapshot {
    schema: string;
    version: number;
    scope?: string;
    exportedAt?: string;
    playerId?: number;
    summary?: {
        playerName?: string;
        includedTableCount?: number;
        rowCount?: number;
    };
    data?: any;
}

export interface DefaultSaveMeta {
    exists: boolean;
    status?: "absent" | "valid" | "recovered" | "cleared" | "invalid";
    error?: string;
    warning?: string;
    playerName?: string | null;
    exportedAt?: string | null;
    sourcePlayerId?: number | null;
    version?: number | null;
    scope?: string | null;
    includedTableCount?: number | null;
    rowCount?: number | null;
}

let cachedMeta: { identity: string; value: DefaultSaveMeta } | null = null;

const clearedTemplate = { schema: "starpoint-cn-default-save", version: 1, cleared: true } as const;
type TemplateFile = DefaultSaveSnapshot | typeof clearedTemplate;
function isCleared(value: unknown): value is typeof clearedTemplate {
    const data = value as typeof clearedTemplate | null;
    return !!data && data.schema === clearedTemplate.schema && data.version === 1 && data.cleared === true
        && Object.keys(data).length === 3;
}
function validateSnapshot(value: unknown): void {
    const snapshot = value as DefaultSaveSnapshot | null;
    if (!snapshot || snapshot.schema !== "starpoint-cn-save" || snapshot.version !== 2 || snapshot.scope !== "player-archive") {
        throw new Error("默认存档模板不是受支持的 V2 完整存档，请重新上传或清除");
    }
    // Keep the current V2 fingerprint/structure checks, including legacy V2 compatibility.
    (require("./snapshots/player-snapshot") as typeof import("./snapshots/player-snapshot"))
        .validatePlayerSaveSnapshotV2Sync(snapshot);
}
function validateTemplateFile(value: unknown): void {
    if (!isCleared(value)) validateSnapshot(value);
}

function snapshotMeta(t: DefaultSaveSnapshot | null): DefaultSaveMeta {
    if (!t || t.schema !== "starpoint-cn-save" || t.version !== 2 || t.scope !== "player-archive") return { exists: false };
    return {
        exists: true, status: "valid",
        playerName: t.summary?.playerName ?? t.data?.player?.name ?? null,
        exportedAt: t.exportedAt ?? null,
        sourcePlayerId: t.playerId ?? null,
        version: t.version ?? null,
        scope: t.scope ?? null,
        includedTableCount: t.summary?.includedTableCount ?? null,
        rowCount: t.summary?.rowCount ?? null,
    };
}

export function saveDefaultSaveTemplate(snapshot: DefaultSaveSnapshot): void {
    validateSnapshot(snapshot);
    const dir = path.dirname(FILE);
    if (!existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    writeJsonAtomicSync(FILE, snapshot, { validate: validateTemplateFile });
    cachedMeta = null;
    try { cachedMeta = { identity: jsonFileIdentitySync(FILE), value: snapshotMeta(snapshot) }; } catch { /* Next read retries. */ }
}

export function loadDefaultSaveTemplate(): DefaultSaveSnapshot | null {
    const result = readValidatedJsonWithBackupSync<TemplateFile>(FILE, validateTemplateFile);
    return result.source === "absent" || isCleared(result.value) ? null : result.value;
}

export function clearDefaultSaveTemplate(): boolean {
    cachedMeta = null;
    if (!existsSync(FILE) && !existsSync(`${FILE}.bak`)) return false;
    let recovered: TemplateFile | undefined;
    try {
        const current = readValidatedJsonWithBackupSync<TemplateFile>(FILE, validateTemplateFile);
        if (current.source === "backup") recovered = current.value;
    } catch {
        // An explicit clear can also repair two unusable template files.
    }
    // When the backup is the only usable copy, first restore it to the primary.
    // A failed repair leaves the backup untouched; a later clear failure leaves
    // this primary configured. Never replace the last usable copy before that.
    if (recovered !== undefined) {
        writeJsonAtomicSync(FILE, recovered, { validate: validateTemplateFile, backup: false });
    }
    // Persist the clear in both recovery locations. If the second replacement
    // fails, a still-valid primary remains configured and the caller gets an
    // error. A successful clear can never recover the former template from .bak.
    writeJsonAtomicSync(`${FILE}.bak`, clearedTemplate, { validate: validateTemplateFile, backup: false });
    writeJsonAtomicSync(FILE, clearedTemplate, { validate: validateTemplateFile, backup: false });
    return true;
}

export function getDefaultSaveMeta(): DefaultSaveMeta {
    try {
        const identity = jsonFileIdentitySync(FILE);
        if (cachedMeta?.identity === identity) return { ...cachedMeta.value };
        let value: DefaultSaveMeta;
        try {
            const result = readValidatedJsonWithBackupSync<TemplateFile>(FILE, validateTemplateFile);
            value = result.source === "absent" ? { exists: false, status: "absent" }
                : isCleared(result.value) ? { exists: false, status: "cleared" }
                : { ...snapshotMeta(result.value), status: result.source === "backup" ? "recovered" : "valid" };
            if (result.source === "backup") value.warning = "主模板不可用，当前使用经过校验的备份；请重新上传或清除以修复主文件。";
        } catch (error) {
            value = { exists: true, status: "invalid", error: (error as Error).message };
        }
        cachedMeta = { identity, value };
        return { ...value };
    } catch (error) {
        cachedMeta = null;
        return { exists: true, status: "invalid", error: (error as Error).message };
    }
}
