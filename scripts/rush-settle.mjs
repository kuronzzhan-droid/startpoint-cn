#!/usr/bin/env node
/**
 * 排行榜赛季结算的命令行入口(离线也能用,不经过 HTTP)。
 *
 *   npm run rush:settle -- status                     查看配置/排期/历史
 *   npm run rush:settle -- run                        立即结算当期
 *   npm run rush:settle -- schedule "2026-09-01 22:00"   设定下次结算时刻(本地时区)
 *   npm run rush:settle -- schedule off               取消排期
 *   npm run rush:settle -- repeat 7d                  结算后每 7 天顺延(off=一次性)
 *   npm run rush:settle -- reward 1-1=999015x10+d9900001 2-3=999015x5 4-10=999015x2
 *   npm run rush:settle -- results 3                  看第 3 期冻结下来的名次
 *
 * 通用参数:--event=700099 --folder=1(默认就是深渊连战那座塔)
 *
 * 注意:服务端在跑的时候也能用 —— SQLite 是 WAL 模式,写入互斥由它自己保证。
 * 但结算会发邮件、换期,别在作者正打到一半时手抖。
 */
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const out = (rel) => require(path.join(root, "out", rel))

const argv = process.argv.slice(2)
const flags = Object.fromEntries(
    argv.filter(a => a.startsWith("--")).map(a => {
        const [k, v] = a.slice(2).split("=")
        return [k, v ?? "true"]
    })
)
const positional = argv.filter(a => !a.startsWith("--"))
const command = positional[0] ?? "status"
const EVENT = Number(flags.event ?? 700099)
const FOLDER = Number(flags.folder ?? 1)

const settlementStore = out("data/domains/rushSettlement.js")
const settlementService = out("lib/rush-settlement-service.js")
const rules = out("lib/rush-settlement.js")

const fmt = (ms) => ms === null || ms === undefined
    ? "-"
    : new Date(ms).toLocaleString("zh-CN")   // 显示用作者本地时区

function parseDuration(text) {
    const m = /^(\d+)\s*([smhd])$/i.exec(String(text).trim())
    if (!m) return null
    const n = Number(m[1])
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase()]
    return n * unit
}

/** "2026-09-01 22:00" → epoch ms,按运行机器的本地时区解释。 */
function parseLocalDateTime(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(text).trim())
    if (!m) return null
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4]), Number(m[5]), Number(m[6] ?? 0)).getTime()
}

function showStatus() {
    const cfg = settlementStore.getRushSettlementConfigSync(EVENT, FOLDER, Date.now())
    console.log(`连战 ${EVENT} / folder ${FOLDER}`)
    console.log(`  自动结算   : ${cfg.autoEnabled ? "开" : "关"}`)
    console.log(`  下次结算   : ${fmt(cfg.settleAtMs)}`)
    console.log(`  顺延周期   : ${cfg.repeatIntervalMs ? `${cfg.repeatIntervalMs / 86_400_000} 天` : "一次性"}`)
    console.log(`  发奖依据   : ${cfg.rewardBoard === "season-first" ? "当轮首通榜" : "战斗用时榜"}  前 ${cfg.rewardRankLimit} 名`)
    console.log(`  邮件标题   : ${cfg.mailSubject}`)
    console.log("  奖励档位   :")
    for (const t of cfg.rewardTiers) {
        const item = t.itemId === null ? "(无道具)" : `道具 ${t.itemId}`
        const degree = t.degreeId ? ` + 称号 ${t.degreeId}` : ""
        console.log(`     第 ${t.fromRank}-${t.toRank} 名 → ${item} × ${t.count}${degree}`)
    }
    const history = settlementStore.getSettlementHistorySync(EVENT, FOLDER, 10)
    console.log(`  历史结算   : ${history.length} 期`)
    for (const h of history) {
        console.log(`     第 ${h.season} 期  ${fmt(h.settledAtMs)}  发奖 ${h.mailCount} 封  来源 ${h.source}`
            + (h.note ? `  [${h.note}]` : ""))
    }
}

function main() {
    switch (command) {
        case "status":
            showStatus()
            return 0

        case "run": {
            const outcome = settlementService.settleRushSeasonNow(EVENT, FOLDER, "cli")
            if (!outcome.ok) {
                console.error(`结算失败: ${outcome.reason}`)
                return 1
            }
            console.log(`已结算第 ${outcome.season} 期 → 新一期 ${outcome.nextSeason}`)
            console.log(`  冻结名次: 战斗用时榜 ${outcome.fullRunRows} 行 / 当轮首通榜 ${outcome.seasonFirstRows} 行`)
            console.log(`  发奖邮件: ${outcome.mailCount} 封`)
            if (outcome.skippedUnconfiguredRanks?.length) {
                console.log(`  ⚠ 奖励未配置,跳过名次: ${outcome.skippedUnconfiguredRanks.join(", ")}`)
            }
            console.log(`  下次排期: ${fmt(outcome.nextSettleAtMs)}`)
            return 0
        }

        case "schedule": {
            const arg = positional[1]
            if (!arg) { console.error("用法: schedule \"2026-09-01 22:00\" | schedule off"); return 1 }
            const cfg = settlementStore.getRushSettlementConfigSync(EVENT, FOLDER, Date.now())
            if (arg === "off") {
                settlementStore.putRushSettlementConfigSync({
                    ...cfg, autoEnabled: false, settleAtMs: null, updatedAtMs: Date.now() })
                console.log("已取消排期。")
                return 0
            }
            const at = parseLocalDateTime(arg)
            if (at === null) { console.error("时间格式: YYYY-MM-DD HH:MM[:SS](本地时区)"); return 1 }
            settlementStore.putRushSettlementConfigSync({
                ...cfg, autoEnabled: true, settleAtMs: at, updatedAtMs: Date.now() })
            console.log(`已排期: ${fmt(at)}(自动结算已开启)`)
            return 0
        }

        case "repeat": {
            const arg = positional[1]
            if (!arg) { console.error("用法: repeat 7d | repeat off"); return 1 }
            const cfg = settlementStore.getRushSettlementConfigSync(EVENT, FOLDER, Date.now())
            if (arg === "off") {
                settlementStore.putRushSettlementConfigSync({
                    ...cfg, repeatIntervalMs: null, updatedAtMs: Date.now() })
                console.log("已改为一次性排期。")
                return 0
            }
            const interval = parseDuration(arg)
            if (interval === null) { console.error("周期格式: 30m / 12h / 7d"); return 1 }
            settlementStore.putRushSettlementConfigSync({
                ...cfg, repeatIntervalMs: interval, updatedAtMs: Date.now() })
            console.log(`已设顺延周期: ${arg}`)
            return 0
        }

        case "reward": {
            const specs = positional.slice(1)
            if (specs.length === 0) {
                console.error("用法: reward 1-1=999015x10 2-3=999015x5 4-10=999015x2")
                console.error("      item id 留空表示不发道具: reward 1-1=x10")
                console.error("      追加称号(铭牌): reward 1-1=999015x10+d9900001")
                return 1
            }
            const tiers = []
            for (const spec of specs) {
                // 1-1=999015x10          道具
                // 1-1=999015x10+d9900001 道具 + 称号(称号直接进拥有集合,不走邮件)
                // 1-1=x0+d9900001        只发称号
                const m = /^(\d+)-(\d+)=(\d*)x(\d+)(?:\+d(\d+))?$/.exec(spec)
                if (!m) { console.error(`档位格式错误: ${spec}`); return 1 }
                tiers.push({
                    fromRank: Number(m[1]), toRank: Number(m[2]),
                    itemId: m[3] === "" ? null : Number(m[3]), count: Number(m[4]),
                    degreeId: m[5] === undefined ? null : Number(m[5])
                })
            }
            const errors = rules.validateRewardTiers(tiers)
            if (errors.length > 0) { console.error(errors.join("\n")); return 1 }
            const cfg = settlementStore.getRushSettlementConfigSync(EVENT, FOLDER, Date.now())
            settlementStore.putRushSettlementConfigSync({
                ...cfg, rewardTiers: rules.normalizeRewardTiers(tiers), updatedAtMs: Date.now() })
            console.log("奖励档位已更新:")
            for (const t of tiers) {
                console.log(`  第 ${t.fromRank}-${t.toRank} 名 → ${t.itemId === null ? "(无道具)" : `道具 ${t.itemId}`} × ${t.count}`
                    + (t.degreeId === null ? "" : ` + 称号 ${t.degreeId}`))
            }
            return 0
        }

        case "results": {
            const season = Number(positional[1])
            if (!Number.isInteger(season) || season < 1) { console.error("用法: results <期号>"); return 1 }
            const rows = settlementStore.getSeasonResultsSync(EVENT, FOLDER, season)
            if (rows.length === 0) { console.log(`第 ${season} 期没有冻结记录。`); return 0 }
            let board = ""
            for (const r of rows) {
                if (r.board !== board) { board = r.board; console.log(`\n[${board === "full-run" ? "战斗用时榜" : "当轮首通榜"}]`) }
                // 主值必须和名次同源:名次冻结自 battle_ms(2026-08-28 口径),
                // 这里再打墙钟就会出现「#1 的秒数比 #2 大」。墙钟并排留作排查。
                const battle = r.battleMs === null ? "-" : `${(r.battleMs / 1000).toFixed(2)}s`
                const dur = r.durationMs === null ? "-" : `${(r.durationMs / 1000).toFixed(2)}s`
                const reward = r.rewardItemId ? `  奖励 道具${r.rewardItemId}×${r.rewardCount} (邮件#${r.mailId})` : ""
                console.log(`  #${r.rank}  ${r.playerName ?? r.playerId}  战斗 ${battle}  (墙钟 ${dur})${reward}`)
            }
            return 0
        }

        default:
            console.error(`未知命令: ${command}`)
            console.error("可用: status | run | schedule | repeat | reward | results")
            return 1
    }
}

process.exit(main())
