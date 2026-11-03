"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContentSnapshot = exports.initializeContentSnapshot = exports.productionContentSnapshotProvider = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const tableCache = new Map();
const bundledRepository = Object.freeze({
    info() {
        return {
            source: "bundled",
            assetVersion: "1.4.58",
            generatorVersion: 1,
            releaseDigest: null,
        };
    },
    table(tableName) {
        if (!/^[a-z0-9_-]+\.json$/i.test(tableName)) {
            throw new TypeError(`Invalid bundled content table '${tableName}'.`);
        }
        if (!tableCache.has(tableName)) {
            const filePath = node_path_1.default.join(process.cwd(), "assets", tableName);
            tableCache.set(tableName, JSON.parse(node_fs_1.default.readFileSync(filePath, "utf8")));
        }
        return tableCache.get(tableName);
    },
});
const bundledSnapshot = Object.freeze({
    repository: bundledRepository,
});
exports.productionContentSnapshotProvider = {
    snapshot: bundledSnapshot,
};
function initializeContentSnapshot() {
    return __awaiter(this, void 0, void 0, function* () {
        return exports.productionContentSnapshotProvider.snapshot;
    });
}
exports.initializeContentSnapshot = initializeContentSnapshot;
function getContentSnapshot() {
    return exports.productionContentSnapshotProvider.snapshot;
}
exports.getContentSnapshot = getContentSnapshot;
