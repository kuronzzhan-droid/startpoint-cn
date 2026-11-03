"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultSaveMeta = exports.clearDefaultSaveTemplate = exports.loadDefaultSaveTemplate = exports.saveDefaultSaveTemplate = void 0;
const file_exists_1 = require("../lib/file-exists");
/**
 * 默认存档模板：管理员上传一份存档快照，作为「账户新建存档」时的初始内容。
 * 持久化到 .database/default_save.json（与 active_account.json 同目录，均 gitignored）。
 * 快照格式与 GET /api/player/save 导出一致，只接受完整存档 V2。
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DATA_DIRECTORY = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(__dirname, "../../.database");
const FILE = path.join(DATA_DIRECTORY, "default_save.json");
function saveDefaultSaveTemplate(snapshot) {
    const dir = path.dirname(FILE);
    if (!(0, file_exists_1.existsSync)(dir))
        fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(snapshot), "utf-8");
}
exports.saveDefaultSaveTemplate = saveDefaultSaveTemplate;
function loadDefaultSaveTemplate() {
    try {
        if (!(0, file_exists_1.existsSync)(FILE))
            return null;
        const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
        // A stale V1 template may remain on disk after an upgrade. Ignore it
        // instead of silently applying a partial snapshot to new accounts.
        if ((parsed === null || parsed === void 0 ? void 0 : parsed.schema) !== "starpoint-cn-save" || parsed.version !== 2 || parsed.scope !== "player-archive") {
            return null;
        }
        return parsed;
    }
    catch (_a) {
        return null;
    }
}
exports.loadDefaultSaveTemplate = loadDefaultSaveTemplate;
function clearDefaultSaveTemplate() {
    try {
        if ((0, file_exists_1.existsSync)(FILE)) {
            fs.unlinkSync(FILE);
            return true;
        }
    }
    catch ( /* ignore */_a) { /* ignore */ }
    return false;
}
exports.clearDefaultSaveTemplate = clearDefaultSaveTemplate;
function getDefaultSaveMeta() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const t = loadDefaultSaveTemplate();
    if (!t)
        return { exists: false };
    return {
        exists: true,
        playerName: (_e = (_b = (_a = t.summary) === null || _a === void 0 ? void 0 : _a.playerName) !== null && _b !== void 0 ? _b : (_d = (_c = t.data) === null || _c === void 0 ? void 0 : _c.player) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : null,
        exportedAt: (_f = t.exportedAt) !== null && _f !== void 0 ? _f : null,
        sourcePlayerId: (_g = t.playerId) !== null && _g !== void 0 ? _g : null,
        version: (_h = t.version) !== null && _h !== void 0 ? _h : null,
        scope: (_j = t.scope) !== null && _j !== void 0 ? _j : null,
        includedTableCount: (_l = (_k = t.summary) === null || _k === void 0 ? void 0 : _k.includedTableCount) !== null && _l !== void 0 ? _l : null,
        rowCount: (_o = (_m = t.summary) === null || _m === void 0 ? void 0 : _m.rowCount) !== null && _o !== void 0 ? _o : null,
    };
}
exports.getDefaultSaveMeta = getDefaultSaveMeta;
