import sqlite3, { Database as BetterSqlite3Database } from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from "path";
import { updateBeforeInit as updateWdfpDataBefore, updateAfterInit as updateWdfpDataAfter} from "./updaters/wdfpData";
import initWdfpData from "./initializers/wdfpData";
import { applyWdfpMigrations } from "./migrations/wdfp";

// Tests may opt into an isolated database root before importing this module.
// Production keeps the existing __dirname-relative .database location.
const configuredDataDir = process.env.WF_DATABASE_DIR?.trim()
const dataDir = configuredDataDir
    ? path.resolve(configuredDataDir)
    : path.resolve(__dirname, "../../.database")
const versionFileExtension = ".version"
if (!existsSync(dataDir)) {
    // make the data directory since it doesn't exist
    try {
        mkdirSync(dataDir, { recursive: true })
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
        latestVersion: 4
    }
}

const loadedDatabases: {
    [key in Database]?: BetterSqlite3Database
} = {}

export default function getDatabase(
    database: Database
): BetterSqlite3Database {
    // don't try to load an already-loaded database
    const isLoaded = loadedDatabases[database]
    if (isLoaded) return isLoaded

    // get metadata
    const metadata = databasesMetadata[database]

    const relativeDatabasePath = metadata.path
    const absoluteDatabasePath = path.join(dataDir, relativeDatabasePath)
    // check if the db already exists
    const dbExists = existsSync(absoluteDatabasePath)

    // get the database's version
    let currentVersion: number = 0
    const versionFilePath = path.join(dataDir, `${relativeDatabasePath}${versionFileExtension}`)
    if (dbExists && existsSync(versionFilePath)) {
        const fileContents = readFileSync(versionFilePath, 'utf-8').trim()
        if (!/^(0|[1-9]\d*)$/.test(fileContents)) {
            throw new Error(`invalid database version for ${metadata.path}: ${JSON.stringify(fileContents)}`)
        }
        currentVersion = Number(fileContents)
        if (!Number.isSafeInteger(currentVersion)) {
            throw new Error(`invalid database version for ${metadata.path}: ${JSON.stringify(fileContents)}`)
        }
        if (currentVersion > metadata.latestVersion) {
            throw new Error(
                `database ${metadata.path} version ${currentVersion} is newer than supported version ${metadata.latestVersion}`,
            )
        }
    }

    // create new db
    const db = new sqlite3(absoluteDatabasePath)

    // set pragma
    db.pragma('journal_mode = WAL')
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
            console.log("[DB] init done")

            // try to update after initialization
            if (updateRequired && updateAfter !== undefined) {
                updateAfter(db, currentVersion)
                console.log("Successfully updated wdfp_data.db")
            }

            // Reviewed Wave2a migrations are deliberately separate from the
            // legacy initializer. Run and validate them on fresh and existing
            // databases; the ordered bundle is idempotent and transactional.
            applyWdfpMigrations(db)

            // write version file only after every schema check has passed
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

    // add to loaded databases
    loadedDatabases[database] = db

    return db
}
