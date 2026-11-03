"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendFileStream = exports.resolvePlainFileInside = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
// Archive names published under assets/asset-patch/active, e.g.
// "pinball-1.4.194-1.4.195-1-moon-wolf-art-local.zip".
const PLAIN_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/**
 * Resolve a single request-supplied file name inside `root`.
 * Returns null for anything that is not a plain name or would leave `root`.
 */
function resolvePlainFileInside(root, name) {
    if (typeof name !== "string" || name.length > 255)
        return null;
    if (!PLAIN_FILE_NAME.test(name) || name.includes(".."))
        return null;
    const base = path_1.default.resolve(root);
    const target = path_1.default.resolve(base, name);
    if (path_1.default.dirname(target) !== base)
        return null;
    return target;
}
exports.resolvePlainFileInside = resolvePlainFileInside;
/**
 * Stream a regular file instead of buffering it whole on the event loop.
 * Returns false when the path is missing or not a regular file.
 */
function sendFileStream(reply, filePath, contentType) {
    let size;
    try {
        const stat = (0, fs_1.statSync)(filePath);
        if (!stat.isFile())
            return false;
        size = stat.size;
    }
    catch (_a) {
        return false;
    }
    reply.type(contentType);
    reply.header("content-length", String(size));
    reply.send((0, fs_1.createReadStream)(filePath));
    return true;
}
exports.sendFileStream = sendFileStream;
