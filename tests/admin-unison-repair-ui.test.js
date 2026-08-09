const assert = require("assert")
const fs = require("fs")

const playerDetail = fs.readFileSync("admin/src/pages/PlayerDetail.tsx", "utf8")
const playerRoute = fs.readFileSync("src/routes/web_api/player.ts", "utf8")

assert(playerDetail.includes("修复合击解锁"), "玩家存档工具区应提供合击解锁修复按钮")
assert(playerDetail.includes("/repair_unison_unlock"), "按钮应调用专用修复接口")
assert(!playerDetail.includes("修改前会自动导出该存档备份"), "界面不应宣称自动备份")

assert(playerRoute.includes('fastify.post("/:id/repair_unison_unlock"'), "服务端应提供合击修复接口")
assert(playerRoute.includes("getUnisonUnlockRepairStatusSync(playerId)"), "接口应先核验主线证据和修复状态")
assert(!playerRoute.includes("createPlayerRepairBackupSync"), "接口不应自动导出存档备份")
assert(playerRoute.includes("repairUnisonUnlockProgressSync(playerId)"), "接口应复用登录自愈的同一修复逻辑")

console.log("admin unison repair UI tests passed")
