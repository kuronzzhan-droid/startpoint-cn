"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.existsSync = void 0;
const node_fs_1 = require("node:fs");
/**
 * Node 20.20.2 on Windows leaks the access-path buffer in fs.existsSync when
 * access succeeds and the same uv_fs_t is reused for stat without cleanup.
 * A single stat keeps live existence checks (including symlink targets) without
 * that allocation. Preserve existsSync's false-on-error contract and avoid a
 * cache, so file creation, deletion and replacement remain visible immediately.
 */
function existsSync(path) {
    if (process.platform !== "win32")
        return (0, node_fs_1.existsSync)(path);
    try {
        return (0, node_fs_1.statSync)(path, { throwIfNoEntry: false }) !== undefined;
    }
    catch (_a) {
        return false;
    }
}
exports.existsSync = existsSync;
