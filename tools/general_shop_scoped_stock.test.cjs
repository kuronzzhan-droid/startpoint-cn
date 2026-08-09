const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "api", "shop.ts"),
    "utf8",
)

for (const [shopItemId, scopedKey] of [
    [100008, "-8_100_008"],
    [110005, "-8_110_005"],
    [110006, "-8_110_006"],
]) {
    assert.match(
        source,
        new RegExp(`\\[${shopItemId}, ${scopedKey}\\]`),
        `GENERAL product ${shopItemId} must use its own scoped purchase key`,
    )
}

assert.doesNotMatch(
    source.slice(
        source.indexOf("function getEffectiveShopPurchaseCountSync"),
        source.indexOf("function addEffectiveShopPurchaseCountSync"),
    ),
    /playerOwnsEquipmentSync/,
    "GENERAL stock must not be inferred from equipment ownership",
)

assert.match(
    source,
    /addPlayerShopPurchaseCountSync\(\s*playerId,\s*GENERAL_EQUIPMENT_SCOPED_PURCHASE_KEYS\.get\(shopItemId\)!,\s*count,/s,
    "GENERAL purchases must be recorded under the scoped key",
)

console.log("general shop scoped stock regression checks passed")
