# 五重决战「恢复单人按钮」客户端补丁

**结论先行**:本补丁把 `BossBattleQuestLogic.get_availablePlayKind()` 从
five-boss-multi-only 注入的「1099001..1099003 返回 2」还原成官方的 `return 1;`。
返回 1 = 「单人 + 组队」,是**每一个**官方领主战关卡本来就返回的值,
包括官方的 BothBoss 关 `1001002` / `1001003`(维·索拉斯)。

**它与 `five-boss-multi-only` 互斥**:两者改同一个方法,构建链上只能选一个。
`five-boss-auto-lock`、`five-boss-random-map` 以及其余补丁族不受影响,照常叠加。

补丁只生成源码。**必须重打 APK 才在真机生效**。

---

## 一、为什么单人开 BothBoss 是官方支持的,不是新造的通路

下面每一条都是反编译源码里的既有分支,行号取
`弹国服/scripts/pinball/...`(与 V7 SWF 的 FFDec 导出逐字节一致的那份权威源)。

| # | 判据 | 位置 |
|---|---|---|
| 1 | **官方 BothBoss 关的 `available_play_kind` 本来就是 1。** `BossBattleQuestLogic` 无条件 `return 1`,而 `is_both_boss` 只有 `BossBattleQuestLogic` 一个实现类 —— 所以官方索拉斯(`1001002`/`1001003`,`is_both_boss=true`)在原版客户端里单人按钮就是亮的。 | `common/data/quest/normal/bossBattle/BossBattleQuestLogic.as:145-148`(`get_isBothBoss`)、`:155-158`(`get_availablePlayKind`) |
| 2 | **类型转换层显式放行 BothBoss、显式拦截 HardMulti。** 同一个 `switch`:`case 3`(HardMulti)`throw new ClientError(3491,"高難易度マルチを、シングルバトルでプレイすることはできません")`;`case 4`(BothBoss)正常返回 `SingleBattleIdKind.BothBoss(...)`。官方对「哪些多人玩法不能单人开」有明确表态,BothBoss 不在其中。 | `common/data/quest/id/QuestIdGroupKindTools.as:513-517` |
| 3 | **单人枚举里 BothBoss 是一等公民。** `SingleBattleIdKind.__constructs__` 第 16 位就是 `"BothBoss"`,带 `(entryQuestId, Option<每人的关卡表>, round)` 三个参数。 | `common/data/quest/id/SingleBattleIdKind.as:12`、`:38-41` |
| 4 | **选图有专门的单人实现。** `mapBoss` 的 `case 0`(`BattleSceneKind.Single`)调 `bothBossMapSingle`,与 `case 1` 的多人 `bothBossMap` 并列。 | `scene/battle/battle/BothBossTool.as:78-88`(单人)、`:89-100`(多人)、`:458-500`(`bothBossMapSingle`) |
| 5 | **战斗场景按单人/多人分别取 viewerId。** `BattleScene.preparation` 里 `kind.index==0`(单人)用 `BothBossTool.DEFAULT_VIEWERID`(= `10`,`boot_ffc6.as:9246-9252`),`index==1`(协力)才用玩家真实 viewerId;两边再一起走 `getBothBossQuestId` 取本轮关卡。 | `scene/battle/BattleScene.as:740-760`、`:849-856` |
| 6 | **`BothBossManager` 有 `isSingle` 字段。** 构造时由 `BattleScene.isSingle()` 传入;`onlySyncDamage()` 在 `isSingle` 时返回 `false`(单人不做跨房伤害同步),而 `hasNextBoss()` / `isFinalRound()` 只看 `round`,与单人无关。 | `scene/battle/battle/BothBossManager.as:27-39`、`:58-65`、`:67-79`;`scene/battle/BattleScene.as:1110-1111` |
| 7 | **round0 → round1 的推进条件把单人短路掉了。** `if(bothBossManager.enable && bothBossManager.hasNextBoss() && (isSingle() \|\| isOtherBattleFinished() \|\| stateFrame > 900))` —— 单人不用等别人打完。 | `scene/battle/state/BattleScenePlayingStateImpl.as:1001-1003` |
| 8 | **续战本身也有单人分支。** `bothBossNext()` 第一行:`scene.isSingle() ? Option.Some(BothBossTool.DEFAULT_VIEWERID) : getMaxDamage()`;`bothBossRestore` 的 `case 0` 存 `BattleRestoreHeaderValues.Single(...)`。 | `scene/battle/state/BattleScenePlayingStateImpl.as:1646-1677` |
| 9 | **`isSinglePlayBossBattle` 明确为「BothBoss + kind 1」返回 true。** 也就是说官方代码预期存在「一个 `available_play_kind == 1` 的 BothBoss 关被单人开」这种情形,并为它准备了单人数值通路。 | `common/data/quest/id/QuestIdBattleKindTools.as:215-223` |

【判断】没有任何一处把 BothBoss 流程门控在多人上。唯一被门控在多人的是
`HardMultiEvent`(判据 2),而五重决战不是 HardMulti。

## 二、kind 从 2 变回 1 之后,客户端到底变了什么

`get_availablePlayKind` 全仓 52 处出现。逐条过完之后,**只有两类**行为真的变。

### 变化 1:模式选择页(这正是本补丁的目的)

| 位置 | kind=2(V7) | kind=1(V8) |
|---|---|---|
| `scene/bossBattle/modeSelect/BossBattleModeSelectScene.as:229-237` | `buttonGroup.get(0).set_enabled(4)` 置灰单人 | 不置灰,单人按钮可点 |
| 同上 `:625-633` | 弹 `boss_battle_select_play_single_not_selectable` 并 `return` | 走 `checkUsingBoostPoint(_, startSingleBattle)` |

其余消费点对 1 和 2 **同分支**(`BossBattleQuestSelectScene:115-125`、
`ItemSearchQuestScene` 四处的 `case 1: case 2:`),无差异。

### 变化 2:`isSinglePlayBossBattle` 在**真的单人开战时**变成 true

`QuestIdBattleKindTools.isSinglePlayBossBattle(questIdBattleKind, availablePlayKind)`
的第一层先看 `QuestIdBattleKind.index`:

- `index == 1`(多人房里打)→ `:239-240` 直接 `return false`。
  **所以组队开战的行为在 V7 和 V8 之间逐字节不变**,kind 根本读不到。
- `index == 0` 且子类型是 `BothBoss`(16)且 kind == 1 → `:215-223` 返回 **true**。
  这条只在新解锁的单人入口上成立。

它的下游共 5 类消费点,逐条核过:

| 消费点 | 作用 | 对五重决战的实际影响 |
|---|---|---|
| `common/data/battle/ZoneSourceValues.as:7661-7686` | `get_boss1/2/3` 读 `boss1` 还是 `boss1_multi` | **无**。已实测(读 live store 的 `master/battle/zone.orderedmap`):五重决战名下 **22 个 zone 键 / 33 个内层行 / 99 个 boss 槽**,`boss1/2/3`(列 23-24 / 27-28 / 31-32)与 `boss1/2/3_multi`(列 25-26 / 29-30 / 33-34)**逐格相同,0 处不一致**,单人多人取到同一批 boss |
| `asset/AssetResolver.as:1929` | 预载哪一套 boss 资源 | **无**,同上:两列指向同一批 boss,预载集合一致 |
| `scene/battle/battle/enemy/GeneralEnemy.as:4199-4209`、`:4255-4265` | 单人时对 esdl 状态时长乘 `time_scaling` | 官方既有的单人平衡机制:`time_scaling` 为 `None` 时系数恒 `1`。⚠ **本次未逐 boss 核对 esdl 的 `time_scaling` 列**,若某个 boss 写了这一列,单人下它的状态时长会与组队不同 |
| `scene/battle/battle/Battle.as:2525` | `scoreCalculator.getTimeMultiplier(rate, isSingle)` | 只影响单人成绩的时间系数,不影响组队 |
| `common/data/quest/reward/AdditionalRewardRepository.as:117-127` | 多人 pickup 加成奖励 | 单人分支本来就不给,官方一致 |

另有 `boss/kraken`、`boss/conductor`、`boss/touyakirenCeo` 三处按 boss 种类分单多人,
五重决战的 zone 行 boss kind 全是 `1`(`GeneralBoss`),走不到这三个类。

### 不变的东西

- 其它领主战关卡(`1001001`…、`1099004`…)**本来就是 `return 1`**,补丁前后逐字节相同。
- 组队开战路径(建房、选图、同屏伤害、`*_multi` 数值列)**完全不变**。
- `five-boss-auto-lock`(`BattleScene` / `BattlePauseMenu`)、
  `five-boss-random-map`(`BothBossTool`)不碰这个类,原样保留。

## 三、判据形状与回归约束

- 补丁器只认两种入参形状,别的一律**报错退出**(不猜、不静默跳过):
  1. multi-only 形状 —— `if(id >= 1099001 && id <= 1099003) { return 2; } return 1;`
     (注释在不在都行:比较走剥注释的 token 指纹,因为 FFDec 回编译一定丢注释);
  2. 官方形状 —— 只有 `return 1;`,此时是 **no-op**(幂等)。
- 输出后断言:整类 `return 2;` **恰好 0 处**、`return 1;` **恰好 1 处**、
  `1099001` / `1099003` 两个字面量**一个都不剩**。
- 断言**除目标方法外整类逐字节不变**(`assert_only_target_method_changed`:
  比较方法体前缀与后缀)。
- CRLF / BOM 原样保留(权威源是 CRLF 无 BOM,产物同样)。

## 四、命令

### 生成还原后的完整类

```powershell
python -X utf8 client-patch\five-boss-single-allowed\patch.py `
  --quest-logic <从 V7 SWF 导出的 BossBattleQuestLogic.as> `
  --output-dir out\five-boss-single-allowed
```

### 跑测试

```powershell
python -X utf8 -m unittest client-patch.tests.test_five_boss_single_allowed -v
```

### FFDec 回读校验(写回 SWF 之后必做)

```powershell
python -X utf8 client-patch\five-boss-single-allowed\patch.py `
  --verify <FFDec导出的BossBattleQuestLogic.as> `
  --expect out\five-boss-single-allowed\BossBattleQuestLogic.as
```

`--verify` 单用是语义验证(不依赖注释标记);加 `--expect` 再做**整类 token 相等**比对,
能抓出「回编译顺手改了别的方法」。若 FFDec 只是重排格式,加 `--allow-reformat`
把 token 不等降级成 stderr 警告,语义验证仍然是硬门禁。

## 五、验收步骤(真机)

1. **正例**:领主战 → 节点 99「五重决战」→ 选关 → 模式选择页
   - 单人按钮**可点**,点进去正常到编队页、能开战;
   - 第一战区打完自动接第二战区(round0 → round1),不卡、不弹「数据不足」;
   - 打完正常结算。
2. **组队回归**:同一关组队开,选图/boss 数值/同屏表现与 V7 一致。
3. **官方对照**:官方索拉斯(`1001002`/`1001003`)单人开,行为应与节点 99 单人一致。
4. **别的领主战节点**照常单人可开(它们本来就是 kind 1)。

## 六、已知边界与风险

- ⚠ **服务端侧未动。** `src/multi/five-boss/` 的协力装载器只处理多人房;
  单人开战不经过它。掉落 / 奖励 / 排行榜在单人下是否按预期,**本补丁不负责,也未验证**。
- ⚠ **未做真机验证。** 本文件里的全部结论是静态源码判据 + 数据表实测,不是真机跑过。
- ⚠ 若将来官方基线更新导致 `get_availablePlayKind` 的两种已知形状都对不上,
  补丁器会**报错退出**,需要重新对锚。
- 【判断】客户端放开单人只是**体验层**;真正的准入仍在服务端。两边口径不一致时,
  以服务端为准。
