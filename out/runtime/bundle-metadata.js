"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadBundleMetadata = exports.BundleManifestError = exports.FALLBACK_BUNDLE_VERSION = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
// Health metadata source only; this module does not validate or activate server bundles.
exports.FALLBACK_BUNDLE_VERSION = "unknown";
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const BUNDLE_ID = /^sha256:[0-9a-f]{64}$/;
class BundleManifestError extends Error {
    constructor() {
        super("embedded runtime requires a valid server manifest");
        this.code = "INVALID_BUNDLE_MANIFEST";
        this.name = "BundleManifestError";
    }
}
exports.BundleManifestError = BundleManifestError;
function isSafeMetadataValue(value) {
    return typeof value === "string"
        && value.length > 0
        && value.length <= 128
        && !/[\x00-\x1f\x7f/\\]/.test(value);
}
function normalizeMetadata(value) {
    if (value === null
        || !isSafeMetadataValue(value.version)
        || !SEMANTIC_VERSION.test(value.version))
        return null;
    if (value.bundleId !== null
        && (!isSafeMetadataValue(value.bundleId) || !BUNDLE_ID.test(value.bundleId)))
        return null;
    return Object.freeze({ version: value.version, bundleId: value.bundleId });
}
function readDefaultServerManifest(bundleRoot, readFileSync) {
    var _a, _b, _c, _d, _e;
    const value = JSON.parse(readFileSync(node_path_1.default.join(bundleRoot, "server-manifest.json"), "utf8"));
    if ((value === null || value === void 0 ? void 0 : value.schemaVersion) !== 2
        || (value === null || value === void 0 ? void 0 : value.name) !== "starpoint-cn"
        || typeof value.serverVersion !== "string"
        || !SEMANTIC_VERSION.test(value.serverVersion)
        || typeof value.bundleId !== "string"
        || !BUNDLE_ID.test(value.bundleId)
        || value.entry !== "out/cn-server.js"
        || ((_a = value.requires) === null || _a === void 0 ? void 0 : _a.runtimeApi) !== 1
        || typeof ((_b = value.requires) === null || _b === void 0 ? void 0 : _b.node) !== "string"
        || !/^>=(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.requires.node)
        || typeof ((_c = value.requires) === null || _c === void 0 ? void 0 : _c.dependencyLock) !== "string"
        || !BUNDLE_ID.test(value.requires.dependencyLock)
        || ((_d = value.requires) === null || _d === void 0 ? void 0 : _d.minDataSchema) !== 0
        || ((_e = value.requires) === null || _e === void 0 ? void 0 : _e.targetDataSchema) !== 6)
        return null;
    return {
        version: value.serverVersion,
        bundleId: value.bundleId,
    };
}
function loadBundleMetadata({ bundleRoot, loadServerManifest, requireManifest = false, readFileSync = node_fs_1.default.readFileSync, }) {
    var _a;
    try {
        const manifest = normalizeMetadata(requireManifest
            ? readDefaultServerManifest(bundleRoot, readFileSync)
            : (_a = loadServerManifest === null || loadServerManifest === void 0 ? void 0 : loadServerManifest()) !== null && _a !== void 0 ? _a : readDefaultServerManifest(bundleRoot, readFileSync));
        if (manifest !== null)
            return manifest;
    }
    catch ( /* development checkouts may not contain a server manifest */_b) { /* development checkouts may not contain a server manifest */ }
    if (requireManifest)
        throw new BundleManifestError();
    try {
        const packageJson = JSON.parse(readFileSync(node_path_1.default.join(bundleRoot, "package.json"), "utf8"));
        if (isSafeMetadataValue(packageJson === null || packageJson === void 0 ? void 0 : packageJson.version)) {
            return Object.freeze({ version: packageJson.version, bundleId: null });
        }
    }
    catch ( /* packaged bundles may intentionally omit package.json */_c) { /* packaged bundles may intentionally omit package.json */ }
    return Object.freeze({ version: exports.FALLBACK_BUNDLE_VERSION, bundleId: null });
}
exports.loadBundleMetadata = loadBundleMetadata;
