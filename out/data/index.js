"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeDatabase = void 0;
const file_exists_1 = require("../lib/file-exists");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = __importDefault(require("path"));
const wdfpData_1 = require("./updaters/wdfpData");
const wdfpData_2 = __importDefault(require("./initializers/wdfpData"));
const quest_time_revision_1 = require("./initializers/quest-time-revision");
const abyss_tower_progress_1 = require("./initializers/abyss-tower-progress");
const abyss_records_1 = require("./initializers/abyss-records");
const five_boss_gauntlet_1 = require("./initializers/five-boss-gauntlet");
const weapon_riven_1 = require("./initializers/weapon-riven");
const admin_account_cleanup_1 = require("../lib/admin-account-cleanup");
const storage_layout_1 = require("../lib/storage-layout");
const sqlite_diagnostics_1 = require("../lib/sqlite-diagnostics");
const sqlite_settings_1 = require("../lib/sqlite-settings");
// Use __dirname so DB path is relative to the source file, not process.cwd()
const dataDir = process.env.DATA_DIR
    ? path_1.default.resolve(process.env.DATA_DIR)
    : path_1.default.resolve(__dirname, "../../.database");
const versionFileExtension = ".version";
if (process.env.MULTI_REALTIME_OWNER_CHILD !== "1" && !(0, file_exists_1.existsSync)(dataDir)) {
    // make the data directory since it doesn't exist
    try {
        (0, fs_1.mkdirSync)(dataDir);
    }
    catch (error) {
        throw new Error(`Failed to create the data directory. Reason: ${error.message}`);
    }
}
const databasesMetadata = {
    [0 /* Database.WDFP_DATA */]: {
        path: "/wdfp_data.db",
        init: wdfpData_2.default,
        updateBefore: wdfpData_1.updateBeforeInit,
        updateAfter: wdfpData_1.updateAfterInit,
        latestVersion: storage_layout_1.WDFP_DATA_VERSION
    }
};
const loadedDatabases = {};
function getDatabase(database) {
    if (process.env.MULTI_REALTIME_OWNER_CHILD === "1")
        throw new Error("REALTIME_OWNER_CANNOT_OPEN_PLAYER_DATABASE");
    // don't try to load an already-loaded database
    const isLoaded = loadedDatabases[database];
    if (isLoaded)
        return isLoaded;
    // get metadata
    const metadata = databasesMetadata[database];
    const relativeDatabasePath = metadata.path;
    const absoluteDatabasePath = path_1.default.join(dataDir, relativeDatabasePath);
    if ((0, file_exists_1.existsSync)(path_1.default.join(dataDir, "storage-maintenance.lock"))) {
        throw new Error("数据库维护尚未结束，请使用维护恢复入口；禁止启动业务服务写入");
    }
    // check if the db already exists
    const dbExists = (0, file_exists_1.existsSync)(absoluteDatabasePath);
    // get the database's version
    let currentVersion = 0;
    const versionFilePath = path_1.default.join(dataDir, `${relativeDatabasePath}${versionFileExtension}`);
    if (dbExists && (0, file_exists_1.existsSync)(versionFilePath)) {
        const fileContents = (0, fs_1.readFileSync)(versionFilePath).toString('utf-8');
        const versionNumber = Number(fileContents);
        currentVersion = isNaN(versionNumber) ? currentVersion : versionNumber;
    }
    // create new db
    const db = new better_sqlite3_1.default(absoluteDatabasePath);
    (0, storage_layout_1.assertStorageLayout)(db);
    // set pragma
    // Keep temporary SQLite structures on disk. Windows launchers point the
    // process at a stable project-local directory instead of an RDP session
    // temp folder that can disappear while the server is still running.
    console.log(`[DB] temp_dir=${(0, os_1.tmpdir)()}`);
    db.pragma('temp_store = FILE');
    console.log(`[DB] temp_store=${db.pragma('temp_store', { simple: true })} (1=FILE)`);
    db.pragma('journal_mode = WAL');
    (0, sqlite_settings_1.applySqliteSettings)(db);
    db.pragma('busy_timeout = 1000');
    // Keep offline tools safe. The CN server disables this only when it starts
    // the external checkpoint owner.
    const externalCheckpointWorker = false;
    db.pragma('wal_autocheckpoint = 1000');
    console.log(`[DB] wal_autocheckpoint=${db.pragma('wal_autocheckpoint', { simple: true })}`
        + ` externalCheckpointWorker=${externalCheckpointWorker}`);
    db.pragma('foreign_keys = OFF');
    // call init & update function
    const init = metadata.init;
    const updateBefore = metadata.updateBefore;
    const updateAfter = metadata.updateAfter;
    if (init !== undefined) {
        try {
            // try to update before initialization
            const latestVersion = metadata.latestVersion;
            const updateRequired = dbExists && metadata.latestVersion > currentVersion;
            console.log(`[DB] init: dbExists=${dbExists} currentVersion=${currentVersion} latestVersion=${latestVersion} updateRequired=${updateRequired}`);
            if (updateRequired && updateBefore !== undefined) {
                console.log("Updating wdfp_data.db...");
                updateBefore(db, currentVersion);
            }
            // initialize
            console.log("[DB] calling init...");
            init(db, dbExists);
            (0, quest_time_revision_1.initializeQuestTimeRevision)(db);
            (0, abyss_tower_progress_1.initializeAbyssTowerProgress)(db);
            (0, abyss_records_1.initializeAbyssRecords)(db);
            (0, five_boss_gauntlet_1.initializeFiveBossGauntlet)(db);
            (0, weapon_riven_1.initializeWeaponRivens)(db);
            console.log("[DB] init done");
            // try to update after initialization
            if (updateRequired && updateAfter !== undefined) {
                updateAfter(db, currentVersion);
                console.log("Successfully updated wdfp_data.db");
            }
            const createdCleanupIndexes = (0, admin_account_cleanup_1.ensureCascadeDeleteIndexes)(db);
            if (createdCleanupIndexes > 0) {
                console.log(`[DB] created ${createdCleanupIndexes} cascade-delete indexes`);
            }
            // write version file
            (0, fs_1.writeFileSync)(versionFilePath, latestVersion.toString(), { encoding: 'utf-8' });
        }
        catch (error) {
            console.log(error);
            console.log(`Initalization failed for module ${metadata.path}. Error: ${error}`);
            db.close();
            throw error;
        }
    }
    // re-enable foreign keys
    db.pragma('foreign_keys = ON');
    (0, sqlite_diagnostics_1.observeSqliteDatabase)(db, "main");
    // add to loaded databases
    loadedDatabases[database] = db;
    return db;
}
exports.default = getDatabase;
function initializeDatabase() {
    return getDatabase(0 /* Database.WDFP_DATA */);
}
exports.initializeDatabase = initializeDatabase;
