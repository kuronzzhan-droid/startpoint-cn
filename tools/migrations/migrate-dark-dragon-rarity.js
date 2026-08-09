"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const CHARACTER_ID = 261089;
const MAX_OVER_LIMIT_STEP = 4;
const EXP_CAPS = [153988, 210488, 266988, 323488, 379988];

function valueAfter(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function timestamp() {
  const d = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "-",
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("");
}

async function main() {
  const serverRoot = path.resolve(__dirname, "..", "..");
  const dbPath = path.resolve(
    valueAfter("--db", path.join(serverRoot, ".database", "wdfp_data.db")),
  );
  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(dbPath)) {
    throw new Error(`找不到玩家数据库：${dbPath}`);
  }

  const db = new Database(dbPath);
  try {
    const rows = db
      .prepare(
        "SELECT player_id, over_limit_step, exp FROM players_characters WHERE id = ?",
      )
      .all(CHARACTER_ID);

    const changes = rows
      .map((row) => {
        const step = Math.min(Number(row.over_limit_step) || 0, MAX_OVER_LIMIT_STEP);
        const exp = Math.min(Number(row.exp) || 0, EXP_CAPS[step]);
        return {
          player_id: row.player_id,
          old_step: row.over_limit_step,
          new_step: step,
          old_exp: row.exp,
          new_exp: exp,
        };
      })
      .filter((row) => row.old_step !== row.new_step || row.old_exp !== row.new_exp);

    console.log(`暗龙 ${CHARACTER_ID} 存档总数：${rows.length}`);
    console.log(`需要迁移的存档数：${changes.length}`);

    if (dryRun || changes.length === 0) {
      console.log(dryRun ? "当前为 --dry-run，仅检查未写入。" : "无需迁移，数据库已符合五星规则。");
      return;
    }

    const backupPath = path.join(
      path.dirname(dbPath),
      `wdfp_data.before-dark-dragon-rarity-${timestamp()}.db`,
    );
    await db.backup(backupPath);
    console.log(`数据库备份：${backupPath}`);

    const update = db.prepare(
      "UPDATE players_characters SET over_limit_step = ?, exp = ? WHERE player_id = ? AND id = ?",
    );
    const migrate = db.transaction(() => {
      for (const row of changes) {
        update.run(row.new_step, row.new_exp, row.player_id, CHARACTER_ID);
      }
    });
    migrate();

    const remaining = db
      .prepare(
        "SELECT COUNT(*) AS count FROM players_characters WHERE id = ? AND over_limit_step > ?",
      )
      .get(CHARACTER_ID, MAX_OVER_LIMIT_STEP).count;
    if (remaining !== 0) {
      throw new Error(`迁移后仍有 ${remaining} 条突破步数越界记录。`);
    }

    console.log(`迁移完成：${changes.length} 条；剩余越界：${remaining} 条。`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
