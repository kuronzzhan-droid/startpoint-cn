# 五重决战开战 Auto 快照锁

这个补丁只处理五重决战 `1099001..1099003` 的战斗内 Auto 开关，不修改奖励数据、
服务端运行记录或其他副本。

## 已锁定规则

- 开战前 Auto 关闭：进入战斗时把这次状态冻结为 `fiveBossManualAutoLock=true`；
  战斗 HUD 不显示 Auto，暂停菜单的 Auto 开关显示为锁定，任何绕过 UI 的
  `changeAutoplayMode(true)` 调用也会被 `BattleScene` 拒绝。
- 开战前 Auto 开启：不加锁；进场后仍可关闭或重新开启，但服务端结算始终按开战快照给
  普通 `1x`，不会因为中途关闭变成 `2x`。
- 其他副本：完全沿用官方行为。

锁值只在 `BattleScene.preparation(...)` 中写入一次。它不会随着
`BattleAutoplayData.autoButtonMode` 的战斗内变化重新计算，因此不会把“Auto 开局后手动关闭”
误认成手动开局。

## 权威输入与输出

权威 FFDec 反编译源码保持只读：

- `pinball.scene.battle.BattleScene`
- `pinball.dialog.battlePauseMenu.BattlePauseMenu`

生成到仓库忽略的 `out/`：

```powershell
python -X utf8 client-patch/five-boss-auto-lock/patch.py `
  --battle-scene D:\WF\outputs\re-workspace\decompile\scripts\pinball\scene\battle\BattleScene.as `
  --pause-menu D:\WF\outputs\re-workspace\decompile\scripts\pinball\dialog\battlePauseMenu\BattlePauseMenu.as `
  --output-dir out\five-boss-auto-lock
```

补丁器要求每个官方锚点恰好一次，支持重复运行且保持字节不变，输出采用临时文件加
`os.replace`。验证同时检查：

1. 锁字段只声明一次、只赋值一次；
2. 赋值位于战斗初始化中，且精确使用初始 `autoButtonMode`；
3. 仅匹配多人任务 `1099001..1099003`；
4. 启用 Auto 的兜底守卫位于官方状态修改之前；
5. 暂停菜单开关确实显示为锁定。

## 验证与交付边界

```powershell
python -X utf8 -m unittest client-patch.tests.test_five_boss_auto_lock -v
```

目前目录提供可复跑的两类 AS3 源码补丁和静态验证。要让真机生效，仍需由后续获授权的
APK 构建步骤把两个完整类写回实际 SWF，并重新打开写回后的二进制、导出两个类做
markerless 语义复验。生成源码本身不等于 APK 已注入，也不等于真机验收。

