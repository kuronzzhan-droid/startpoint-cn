# 五重决战「只允许组队」客户端补丁

**结论先行**:补丁 A 只改一个方法、只加 11 行，把
`BossBattleQuestLogic.get_availablePlayKind()` 从写死 `return 1` 改成
「关卡 id 落在 `1099001..1099003` 时返回 2，否则返回 1」。返回 2 是官方
「高难多人」用的同一个枚举值，客户端因此走官方既有代码路径：单人按钮置灰、点它弹
`boss_battle_select_play_single_not_selectable`。**补丁 B（跳过模式选择页）经评估不做，只留方案**，
理由见下面「补丁 B」一节。

补丁只生成源码。**必须重打 APK 才在真机生效**——生成 `.as` 文本不等于已注入 SWF，
更不等于真机验收。

---

## 一、这三关是什么

| 项 | 值 | 来源 |
| --- | --- | --- |
| 领主战地图节点 | group `1` / node `99` | `boss_battle_stage_node.orderedmap[1][99]`，见 `mod-tools/wf_five_boss_node.py` |
| 关卡 id | `1099001` / `1099002` / `1099003` | `assets/boss_battle_quest.json`；`src/multi/five-boss/contract.ts` |
| 服务端契约 | `route_id=five_boss_coop_v1`，`visibleQuestId=1099001` | `src/multi/five-boss/contract.ts` |

---

## 二、补丁 A：判据与理由

### 改哪一行

`pinball/common/data/quest/normal/bossBattle/BossBattleQuestLogic.as:155-158`

```as3
      public function get_availablePlayKind() : int
      {
         return 1;
      }
```

替换为（生成器产出，注释为 ASCII，理由见「工艺注意」）：

```as3
      public function get_availablePlayKind() : int
      {
         // WF_FIVE_BOSS_MULTI_ONLY_BEGIN
         // Five-boss gauntlet (boss battle map group 1 / node 99, quests
         // 1099001..1099003) is multi only: 2 == multi only, same value as
         // HardMultiEventQuestLogic. Predicate uses the class' own `id` field,
         // not get_stageNodeId(): that returns the composite node id 1099, and a
         // node-wide match would also capture future 1099004+ quests.
         if(id >= 1099001 && id <= 1099003)
         {
            return 2;
         }
         // WF_FIVE_BOSS_MULTI_ONLY_END
         return 1;
      }
```

### 返回值枚举（`MultiQuestLogic` 域）

| 值 | 含义 | 官方先例 |
| --- | --- | --- |
| 0 | 只能单人 | 若干活动关卡 |
| 1 | 单人 + 组队 | 全部领主战（`BossBattleQuestLogic:155`） |
| 2 | **只能组队** | `HardMultiEventQuestLogic:116-119` 就是 `return 2` |

⚠ 别和 `EventLogic.get_availablePlayKind()` 混淆，那是**另一套枚举**
（`HardMultiEventLogic:86` 返回 `0`，含义是「只有一种玩法，不用出 PlayKindSelect 页」）。
本补丁改的是 `MultiQuestLogic` 域。

### 为什么判据用类内的 `id` 字段，而不是 `get_stageNodeId()`

【事实】`get_stageNodeId()` 的实现是 `int(Math.floor(id / 1000 + 1e-10 ...))`
（`BossBattleQuestLogic:131-134`）。对 `1099001` 它返回 **`1099`**，
即「group×1000 + node」的复合节点号，**不是 `99`**。所以「stage node id 为 99」
这个写法在客户端里对应的值是 `1099`，写 `== 99` 会永远不成立。

即便写 `get_stageNodeId() == 1099`，判据也会覆盖整个 `1099xxx` 区间，
把将来可能新增的 `1099004+` 一并吞掉——这违反本次的回归约束
「id 不在 `1099001..1099003` 的 quest 仍返回 1」。

【事实】`id` 是 `public var id:int`（`:36`），构造函数末行 `id = param1;`（`:66`）赋值；
同一个类里 `get_stageNodeId()`（`:133`）、`getQuestNumber()`（`:172`）、
`get_multiIdKind()` 都已经直接读裸 `id`，所以在这个作用域引用 `id` 是已证安全的写法，
不存在局部变量遮蔽或基类同名冲突。

【判断】综合下来精确 id 区间既满足「只影响这三关」，又是类内既有、无额外依赖的判据。
若将来作者要把整个节点 99 都变成多人限定，只需把守卫改成 `get_stageNodeId() == 1099`
并同步改 `patch.py` 的 `available_play_kind()` 与测试——一行的事，但那是另一次裁决。

### 改成 2 之后客户端的连锁反应（全量排查）

`get_availablePlayKind` 全仓 52 处出现（含接口声明与各类实现），逐条过完，只有下面两处行为真的变：

| 位置 | kind=1（现状） | kind=2（补丁后） |
| --- | --- | --- |
| `BossBattleModeSelectScene:229-237` | 单人按钮可用 | `buttonGroup.get(0).set_enabled(4)` 置灰 |
| `BossBattleModeSelectScene:625-633` | 点单人 → `startSingleBattle` | 弹 `boss_battle_select_play_single_not_selectable` 并 `return` |

其余全部对 1 和 2 **同分支**，无差异：

- `BossBattleQuestSelectScene:115-125`：`case 1: case 2:` 都跳 `BossBattleModeSelect`。
- `ItemSearchQuestScene:108/120/132/149`：四处都是 `case 1: case 2:` 同分支。
- `QuestEndTransitionRouter:226/244`：走的是 `EventLogic` 域，与本类无关。

**唯一需要注意的间接影响**：`QuestIdBattleKindTools.isSinglePlayBossBattle(questId, kind)`
（`:152`）在 kind=2 时恒为 `false`。它最终喂给
`BattleQuestBaseImpl.getZoneValues:2367-2370` → `ZoneSourceValues.isSingleBattle`，
后者决定 `get_boss1/2/3`（`:7661-7684`）读 `boss1` 还是 `boss1_multi` 列。

【事实】这条通路**不受影响**，因为 `isSinglePlayBossBattle` 的第一层就先看
`QuestIdBattleKind.index`：`index==1`（正在多人房里打）**直接 `return false`**，
根本走不到 kind 判断。五重决战本来就只在多人房里开，所以补丁前后这里都是 `false`，
boss 数值一直读 `*_multi` 列，**不会变强也不会变弱**。
kind 只在 `index==0`（真的单人开战）时才被读；而单人开战入口正是本补丁要封的，
且服务端 `modes.d` 的 five-boss 装载器也不接受单人 start。

同理 `AdditionalRewardRepository:117-127`（多人 pickup 奖励）与
`AssetResolver:1922-1930`（单人预载路径）都只在单人分支上有差异，封掉单人后不可达。

### 回归约束

- 其它领主战关卡（`1001001`…、`1099004`…）走 `return 1`，**行为逐字节不变**。
- 补丁器断言 `return 1;` 在整个类里仍恰好出现 1 次，`return 2;` 恰好 1 次且在守卫内。
- 补丁器断言**除目标方法外整个类字节不变**（`assert_only_target_method_changed`：
  把补丁方法换回官方方法后必须与原文件完全相等）。

---

## 三、补丁 B：从节点 99 进入时跳过模式选择页 —— **不实现，只留方案**

### 方案（如果将来要做）

在 `BossBattleQuestSelectScene.startQuest`（`:93-130`）的 `case 2:` 分支里，不再
`changeSceneWithPushBackScene(SceneKind.BossBattleModeSelect(...))`，改为复刻
`BossBattleModeSelectScene` 的两步：

1. `ConfirmUsingBossBoostPoint.checkAndExecute(multiIdKind, this, player, callback)`
   （领主 Boost 消耗确认弹窗，`BossBattleModeSelectScene:606-609`）；
2. `MultiBattleRoomPrepareFlow.createFlowToSelectRoom(this, quest, useBoost, Option.None)`
   并 `gear.addChild(...)`（`BossBattleModeSelectScene:148-157`）。

### 为什么不做（四条，任意一条都足够）

1. 【事实】**官方对 kind=2 的 UX 就是「留着模式选择页 + 单人按钮置灰」。**
   `HardMultiEventQuestLogic` 返回 2 之后并没有任何跳过逻辑。补丁 A 已经和官方一模一样，
   补丁 B 是在官方行为之外自创路径。
2. 【事实】**跳过也回不去。** `GlobalLoadingTask:913-941` 在恢复进行中的多人房时，
   把 `SceneKind.BossBattleModeSelect(...)` **写死**塞进返回栈（host 分支 case 0/1/2/4 四处）。
   即使入口跳过了，玩家退出房间/断线重连后照样落在模式选择页上，
   得到「有时有这一页、有时没有」的不一致体验。要一致就得连 `GlobalLoadingTask` 一起改，
   补丁面从 1 个类涨到 3 个类。
3. 【事实】`BossBattleModeSelectScene.prepareScene` 除了按钮，还负责
   `setMultiPickupEventSchedule`（共斗 pickup 加成，`:159-175`）、背景 kind、
   世界剧情转场处理。绕过它等于绕过这些初始化，
   而 `MultiBattleRoomPrepareFlow` 是否依赖它们没有验证过。
4. 【判断】收益是**少点一次屏**；代价是新增 3 个类的改动面、两条 `ClientError`
   （2203/2204）路径的暴露面、以及一条没有官方先例的场景转移。风险收益不成比例。

### 若作者仍要做，先决条件

需要真机验证：房间内返回、房间解散返回、战斗结束返回、杀进程重连四条路径都落在
同一个场景上；并把 `GlobalLoadingTask` 的返回栈一并改掉。这是独立的一次施工，
不应和补丁 A 混在一个 commit 里。

---

## 四、工艺注意（照 `five-boss-auto-lock`）

- **权威源只读**：`弹国服/scripts/pinball/.../BossBattleQuestLogic.as`
  （与 `D:\WF\outputs\re-workspace\decompile\scripts\pinball\...` 实测逐字节相同）。
  补丁器不写回权威源，产物落 gitignore 的 `out/`。
- **CRLF / BOM 原样保留**：权威源是 CRLF 无 BOM，产物同样 CRLF 无 BOM（测试断言）。
- **注入的注释只用 ASCII**：FFDec 的 AS3 直编辑器要重新编译这段文本，
  不给它非 ASCII 字节。中文解释一律留在本文件里。
- **锚点唯一 + 幂等**：官方 4 行方法体在类里恰好出现 1 次（`return 1;` 全类也只有这 1 处）；
  重复运行字节不变。
- **markerless 语义验证**：FFDec 回编译会**丢掉全部注释**，所以回读校验不能依赖
  `WF_FIVE_BOSS_MULTI_ONLY_*` 标记，改用 token 序列指纹（剥注释、无视空白）。

---

## 五、命令

### 生成补丁后的完整类

```powershell
python -X utf8 client-patch\five-boss-multi-only\patch.py `
  --quest-logic 弹国服\scripts\pinball\common\data\quest\normal\bossBattle\BossBattleQuestLogic.as `
  --output-dir out\five-boss-multi-only
```

产出 `out\five-boss-multi-only\BossBattleQuestLogic.as`（完整类文本，可直接粘进 FFDec）。

### 跑测试

```powershell
python -X utf8 -m unittest client-patch.tests.test_five_boss_multi_only -v
```

### FFDec 回读校验（写回 SWF 之后必做）

1. 在 FFDec 里打开写回后的 SWF，导出
   `pinball.common.data.quest.normal.bossBattle.BossBattleQuestLogic` 为 `.as`；
2. 跑：

```powershell
python -X utf8 client-patch\five-boss-multi-only\patch.py `
  --verify <FFDec导出的BossBattleQuestLogic.as> `
  --expect out\five-boss-multi-only\BossBattleQuestLogic.as
```

`--verify` 用 markerless 语义验证（不要求注释标记）；`--expect` 额外做**整类 token 相等**
比对，能抓出「回编译顺手改了别的方法 / 局部变量被重命名 / 常量被折叠」。
若 FFDec 只是重排了格式而语义没变，加 `--allow-reformat` 把 token 不等降级成 stderr 警告，
但语义验证仍然是硬门禁。

---

## 六、验收步骤（真机）

前提：**补丁已注入 SWF 并重打了 APK 装到设备上**。源码补丁本身不改变任何已安装客户端。

1. **正例**：领主战 → 节点 99「五重决战」→ 选任一关卡 → 模式选择页
   - 单人按钮**置灰不可点**；
   - 强行点单人 → 屏幕中央弹 `boss_battle_select_play_single_not_selectable` 的文案；
   - 组队按钮正常，能进多人房、能开战。
2. **回归**：任选一个别的领主战节点（如节点 1 的 `1001001`）
   - 模式选择页单人按钮**照常可点**，单人能正常开战结算。
3. **官方对照**：活动里的「高难多人」（`HardMultiEvent`）关卡
   - 它的模式选择页表现应与节点 99 **完全一致**（同为 kind=2）。若不一致，说明补丁写错了。
4. **不受影响面抽查**：节点 99 组队开战后 boss 血量/行为与打补丁前的组队开战一致
   （数值读的仍是 `*_multi` 列）。

---

## 七、已知边界与风险

- ⚠ **必须重打 APK 才生效。** 这个目录只产出 AS3 源码和验证脚本，
  写回 SWF、重签、装机是后续独立授权的步骤，本次未执行。
- ⚠ **补丁 B 未实现**，玩家仍需在模式选择页点一次「组队」。
- ⚠ 若将来官方基线（反编译源）更新导致 `get_availablePlayKind` 方法体文本变化，
  锚点会失配并**报错退出**（不会静默跳过）——这是设计如此，需要重新对锚。
- 【判断】客户端封单人是**体验层**的封堵，不是安全边界；真正的拒绝在服务端
  （`src/multi/five-boss/`）。两者应当同时在位。
