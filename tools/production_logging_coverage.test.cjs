const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const hotPathFiles = [
    "src/routes/cn/load.ts",
    "src/routes/api/activeMission.ts",
    "src/routes/api/character.ts",
    "src/routes/api/character/bond.ts",
    "src/routes/api/character/mana.ts",
    "src/routes/api/equipment.ts",
    "src/routes/api/exchange.ts",
    "src/routes/api/profile.ts",
    "src/routes/api/sell.ts",
    "src/routes/api/shop.ts",
    "src/multi/http/battle.ts",
    "src/multi/http/lobby.ts",
    "src/multi/http/room.ts",
    "src/multi/room/manager.ts",
    "src/multi/state/SessionManager.ts",
    "src/multi/tcp/handshake.ts",
    "src/multi/tcp/lobby.ts",
]

const noisyPrefixes = [
    "CN-LOAD",
    "MANA",
    "shop:buy",
    "shop:bulk_buy",
    "UPGRADE",
    "BULK_UPGRADE",
    "ACTIVE_MISSION",
    "exchange:star_crumb",
    "PROFILE",
    "BULK_SELL",
    "bulk_over_limit",
    "LOBBY",
]

for (const relativePath of hotPathFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8")
    for (const prefix of noisyPrefixes) {
        const directLog = new RegExp(`console\\.log\\([^\\n]*\\[${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`)
        assert.equal(
            directLog.test(source),
            false,
            `${relativePath} must gate routine [${prefix}] logs behind GAME_VERBOSE_LOGS`,
        )
    }
}

const seedValidator = fs.readFileSync(path.join(root, "src/lib/seed-validator.ts"), "utf8")
assert.match(seedValidator, /if \(GACHA_VERBOSE_LOGS\) \{\s*console\.log\(`\[SEED\] VERIFY/s)
assert.match(seedValidator, /if \(GACHA_VERBOSE_LOGS && totalFlushed > 0\)/)

console.log("production logging coverage tests passed")
