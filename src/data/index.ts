import { existsSync } from "../lib/file-exists";
import sqlite3, { Database as BetterSqlite3Database } from 'better-sqlite3';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from "path";
import { updateBeforeInit as updateWdfpDataBefore, updateAfterInit as updateWdfpDataAfter} from "./updaters/wdfpData";
import initWdfpData from "./initializers/wdfpData";
import { initializeQuestTimeRevision } from "./initializers/quest-time-revision";
import { initializeAbyssTowerProgress } from "./initializers/abyss-tower-progress";
import { initializeAbyssRecords } from "./initializers/abyss-records";
import { initializeFiveBossGauntlet } from "./initializers/five-boss-gauntlet";
import { ensureCascadeDeleteIndexes } from "../lib/admin-account-cleanup";
import { assertStorageLayout, WDFP_DATA_VERSION } from "../lib/storage-layout";
import { observeSqliteDatabase } from "../lib/sqlite-diagnostics";
import { applySqliteSettings } from "../lib/sqlite-settings";

// Use __dirname so DB path is relative to the source file, not process.cwd()
const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(__dirname, "../../.database")
const versionFileExtension = ".version"
if (process.env.MULTI_REALTIME_OWNER_CHILD !== "1" && !existsSync(dataDir)) {
    // make the data directory since it doesn't exist
    try {
        mkdirSync(dataDir)
    } catch (error) {
        throw new Error(`Failed to create the data directory. Reason: ${(error as Error).message}`)
    }
}

export const enum Database {
    WDFP_DATA
}

interface DatabaseMetadata {
    path: string
    latestVersion: number
    init?: (database: BetterSqlite3Database, exists: boolean) => void
    updateBefore?: (database: BetterSqlite3Database, currentVersion: number) => void
    updateAfter?: (database: BetterSqlite3Database, currentVersion: number) => void
}

const databasesMetadata: {[key in Database]: DatabaseMetadata} = {
    [Database.WDFP_DATA]: {
        path: "/wdfp_data.db",
        init: initWdfpData,
        updateBefore: updateWdfpDataBefore,
        updateAfter: updateWdfpDataAfter,
        latestVersion: WDFP_DATA_VERSION
    }
}

const loadedDatabases: {
    [key in Database]?: BetterSqlite3Database
} = {}

export default function getDatabase(
    database: Database
): BetterSqlite3Database {
    if (process.env.MULTI_REALTIME_OWNER_CHILD === "1") throw new Error("REALTIME_OWNER_CANNOT_OPEN_PLAYER_DATABASE")
    // don't try to load an already-loaded database
    const isLoaded = loadedDatabases[database]
    if (isLoaded) return isLoaded

    // get metadata
    const metadata = databasesMetadata[database]

    const relativeDatabasePath = metadata.path
    const absoluteDatabasePath = path.join(dataDir, relativeDatabasePath)
    if (existsSync(path.join(dataDir,"storage-maintenance.lock"))) {
        throw new Error("数据库维护尚未结束，请使用维护恢复入口；禁止启动业务服务写入")
    }
    // check if the db already exists
    const dbExists = existsSync(absoluteDatabasePath)

    // get the database's version
    let currentVersion: number = 0
    const versionFilePath = path.join(dataDir, `${relativeDatabasePath}${versionFileExtension}`)
    if (dbExists && existsSync(versionFilePath)) {
        const fileContents = readFileSync(versionFilePath).toString('utf-8')
        const versionNumber = Number(fileContents)
        currentVersion = isNaN(versionNumber) ? currentVersion : versionNumber
    }

    // create new db
    const db = new sqlite3(absoluteDatabasePath)
    assertStorageLayout(db)

    // set pragma
    // Keep temporary SQLite structures on disk. Windows launchers point the
    // process at a stable project-local directory instead of an RDP session
    // temp folder that can disappear while the server is still running.
    console.log(`[DB] temp_dir=${tmpdir()}`)
    db.pragma('temp_store = FILE')
    console.log(`[DB] temp_store=${db.pragma('temp_store', { simple: true })} (1=FILE)`)
    db.pragma('journal_mode = WAL')
    applySqliteSettings(db)
    db.pragma('busy_timeout = 1000')
    // Keep offline tools safe. The CN server disables this only when it starts
    // the external checkpoint owner.
    const externalCheckpointWorker = false
    db.pragma('wal_autocheckpoint = 1000')
    console.log(`[DB] wal_autocheckpoint=${db.pragma('wal_autocheckpoint', { simple: true })}`
        + ` externalCheckpointWorker=${externalCheckpointWorker}`)
    db.pragma('foreign_keys = OFF')

    // call init & update function
    const init = metadata.init
    const updateBefore = metadata.updateBefore
    const updateAfter = metadata.updateAfter
    if (init !== undefined) {
        try {
            // try to update before initialization
            const latestVersion = metadata.latestVersion
            const updateRequired = dbExists && metadata.latestVersion > currentVersion
            console.log(`[DB] init: dbExists=${dbExists} currentVersion=${currentVersion} latestVersion=${latestVersion} updateRequired=${updateRequired}`)
            if (updateRequired && updateBefore !== undefined) {
                console.log("Updating wdfp_data.db...")
                updateBefore(db, currentVersion)
            }

            // initialize
            console.log("[DB] calling init...")
            init(db, dbExists)
            initializeQuestTimeRevision(db)
            initializeAbyssTowerProgress(db)
            initializeAbyssRecords(db)
            initializeFiveBossGauntlet(db)
            console.log("[DB] init done")

            // try to update after initialization
            if (updateRequired && updateAfter !== undefined) {
                updateAfter(db, currentVersion)
                console.log("Successfully updated wdfp_data.db")
            }

            const createdCleanupIndexes = ensureCascadeDeleteIndexes(db)
            if (createdCleanupIndexes > 0) {
                console.log(`[DB] created ${createdCleanupIndexes} cascade-delete indexes`)
            }

            // write version file
            writeFileSync(versionFilePath, latestVersion.toString(), { encoding: 'utf-8' })
        } catch (error) {
            console.log(error)
            console.log(`Initalization failed for module ${metadata.path}. Error: ${error}`)
            db.close()
            throw error
        }
    }

    // re-enable foreign keys
    db.pragma('foreign_keys = ON')
    observeSqliteDatabase(db, "main")

    // add to loaded databases
    loadedDatabases[database] = db

    return db
}

export function initializeDatabase(): BetterSqlite3Database {
    return getDatabase(Database.WDFP_DATA)
}
