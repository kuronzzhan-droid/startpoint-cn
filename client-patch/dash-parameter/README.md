# 可调冲刺参数族（during_content 422，V12）

能力标识：`dash-parameter-v1`。

给持续词条加一条新 kind **422 `DashParameter`**：一行数据用 `param_id` 选中一个
冲刺常量、用 `strength` 给出调整量。以后想调冲刺的别的方面，只要加一个 `param_id`，
不用再打一次 APK 补丁——这就是把它做成「族」而不是七条 kind 的理由。

## 列契约

| 列 | 内容 | 解析器 |
|---|---|---|
| ability `c109`（during_content 块偏移 0） | `422` | `AbilityValues.parseAt109` |
| ability `c118`（块偏移 9，字段名 `unique_condition_id`） | **param_id**（0..6，整数） | `AbilityValues.parseAt118` → `int(Std.parseInt(...))` |
| ability `c113` / `c114`（块偏移 4/5，`strength.power1` / `strength.first_max`） | Decimal ×100000，**允许负号** | `AbilityValues.parseAt113` |

`param_id` 借的是 `unique_condition_id` 那一列。为什么不借偏移 10 的 `element`：
`mod-tools/wf_client_legality.ability_element_column_problems` 会按
`ElementTargetKind`（0..6，1-based）判 element 的值域，将来 param_id 超过 6 就会被误报；
`unique_condition_id` 没有值域规则，而「声明即必填」通用律照样能强制这一列非空
（`mod-tools/tests/test_client_patch_kinds.py` 把这条写成了断言）。

其它列（`target` / `strength2` / `character_groups` / `element` / `powerflip_override`）
这条 kind 一律不读，留空即可。

## param_id 语义

除 `2` 之外**一律是官方常量的倍率**：

    生效值 = 官方常量 × (1 + strength / 100000)

`strength = -30000` ⇒ ×0.7 ⇒ 面板读作「冲刺冷却时间−30%」。

| id | 名称 | 官方常量（反编译出处） | 生效点 |
|---:|---|---|---|
| 0 | 冲刺冷却时间 | 90 帧；飞行形态 60；疾走时取 `EscapeSwiftLogic.get_escapeRecoveringTime()` 的更小值（`BallImpl.as:309-322`） | `BallImpl.update` 里 `escapePoint.add(1/frames)` 之前，`frames = Math.max(1, frames × 倍率)` |
| 1 | 冲刺弹射速度 | `23 × getSpeedupCorrectionFactor() + 23`（`BallImpl.as:2189`） | `BallImpl.findEscapeTarget` 存进 `_loc7_` 之前 × 倍率 |
| 2 | 冲刺锁定距离上限 | **官方没有这个常量**：不限距，全场取最近 | `BallImpl.findEscapeTarget` 拿到 `getResult()` 之后：`strength > 0` 且 `EscapeTargetScoutContext.currentDistance > strength/100000`（**像素**，已含官方的 `getEscapeTargetDistanceCorrectionFactor` 修正）时丢弃锁定目标，退回官方的左右兜底方向。`strength = 0` = 官方行为 |
| 3 | 冲刺蓄力帧数 | 8 帧（`BallImpl.as:405`） | `BallImpl.update` 把 `stateFrame == 8` 换成 `stateFrame >= Math.max(1, 8 × 倍率)` |
| 4 | 冲刺回拉距离 | 16 px（`BallImpl.as:526-529 / 547-550`，`cos/sin × 16`；case 1 / case 2 共 4 处） | `BallImpl.tryEscape` 每一处 `× 16` 之后再 × 倍率 |
| 5 | 冲刺惯性 | 0.2；飞行形态 0（`BallImpl.as:2190-2191`） | `BallImpl.findEscapeTarget` 两处 `速度 × 0.2` 各 × 倍率（飞行形态那条常量是 0，乘完还是 0） |
| 6 | 可冲刺高度上限 | 1200（`BallImpl.as:2590` `localToGlobalY() < 1200`） | `BallImpl.canEscapeNow` 把 1200 换成 `1200 × 倍率` |

**为什么 id 3 要把 `==` 改成 `>=`**：官方写的是「蓄力到第 8 帧那一瞬间发射」。
如果阈值在蓄力过程中被调小（词条的 during 条件中途成立），`stateFrame` 可能已经越过
新阈值，`==` 就永远撞不上，球会卡在蓄力态。`ifne` 这条原指令不能改写，
所以补丁把它的两个操作数换成 `(stateFrame < 阈值)` 与 `0`——
两者「不等」正好等价于「还没到阈值」，语义变成 `>=`，
默认倍率 1 时首次命中仍然是第 8 帧，与官方逐帧一致。

这些常量全是 Haxe **内联**进 `BallImpl` 的字面量，改 `BattleConstants` 一个字节都不生效，
所以只能在这 4 个方法体的字面量现场动手。

## 数据怎么流过来

    ability 行 c109=422
      → AbilityValues.parseAt109
      → DuringAbilitySource.createFromDuringAbilityValues
            CommonAbilityContent.Battle(CommonAbilityBattleContent("DashParameter",21,[id,strength]))
      → BattleAbilityTotalizerImpl.addDuringContent      按 param_id 分桶
      → BattleAbilityTotalizerImpl.getTotalDashParameter(id)     ← 新增方法
      → BallImpl 的 4 个方法在各自的常量现场读它

累加走官方的 `DuringCheckerWithDecimal.sum(list, null)`，
所以 during 条件的启停、层数倍乘、多人叠加全部沿用官方语义；
同一个 param_id 上多条词条按官方规则求和。

## 未打补丁的客户端会崩

`AbilityValues.parseAt109` 的 else 分支是 `throw new ClientError(7050)`——
官方 APK 读到 422 就崩在角色详情页。闸门登记在
`mod-tools/wf_client_legality.py` 的 `CLIENT_PATCH_CONTENT_KINDS`，
`required_client_capabilities()` 会把这一行报成需要 `dash-parameter-v1`。

## 改了哪 13 个方法体 + 加了什么

全部是「在指令边界上**整块插入**」：原有指令一条没改，只有分支的 s24 偏移重算。
body index 由 `client-patch/tests/test_dash_parameter.py` 按类名+方法名
从真实 ABC 重新解析后断言。

| 类 / 方法 | body | 插入点(基线指令) | 代码字节 | 干什么 |
|---|---:|---|---:|---|
| `AbilityValues$/parseAt109` | 39158 | 6 | 21569 → 21625 | 认识 `"422"` |
| `DuringAbilitySource$/createFromDuringAbilityValues` | 13347 | 7303 | 53924 → 53991 | master value → 运行时内容 |
| `CommonAbilityContentTools$/getStrength` | 13337 | 0 | 1377 → 1424 | 官方返回 `undefined→null`，调用方 `switch(x.index)` 会空引用 |
| `CommonAbilityContentTools$/hasAdvantage` | 13338 | 0 | 1387 → 1430 | 队伍徽章：强度非 0 = 有效果 |
| `CommonAbilityContentTools$/mergeForDescription` | 13343 | 32 | 4371 → 4425 | 新 kind 一律不合并（否则 `_loc5_` 留 null） |
| `AbilityDescriptionGenerator/stringfyCommonBattleContent` | 9005 | 2 | 4480 → 4695 | 面板正文 |
| `AbilityDescriptionGenerator/stringfyStrengthByCommonBattleContent` | 8384 | 2 | 1129 → 1159 | 强度片段（与官方 case 0 逐条同形） |
| `AbilityDescriptionGenerator/stringfySummaryCommonContent` | 8360 | 2 | 12479 → 12702 | 摘要行 |
| `BattleAbilityTotalizerImpl/addDuringContent` | 51551 | 2 | 882 → 992 | 按 param_id 分桶累加 |
| `BallImpl/update` | 59934 | 79 / 288 | 1647 → 1749 | param 0 冷却、param 3 蓄力帧 |
| `BallImpl/findEscapeTarget` | 60089 | 40 / 214 / 227 / 249 | 769 → 924 | param 2 锁定距离、param 1 弹射速度、param 5 惯性 ×2 |
| `BallImpl/tryEscape` | 59935 | 87 / 98 / 192 / 203 | 639 → 763 | param 4 回拉距离 ×4 |
| `BallImpl/canEscapeNow` | 60127 | 14 | 124 → 155 | param 6 可冲刺高度 |

新增（这是本补丁与 `kyubi-fever-ratio` 唯一的结构性区别）：

* `BattleAbilityTotalizerImpl` 追加 1 个实例槽 `duringDashParameters:Array`
  （`slot_id 0` 自动分配，追加在 42 个已有槽的**末尾**，不挪动任何一个已有槽序号；
  构造函数没碰它，所以 `addDuringContent` 里做惰性初始化 `[[],[],[],[],[],[],[]]`）；
* 追加 1 个实例方法 `getTotalDashParameter(int):Number`（1 条 method_info + 1 条 method_body，
  都追加在表尾），等价 AS3：

  ```as3
  public function getTotalDashParameter(param1:int) : Number
  {
     var _loc2_:Array = duringDashParameters;
     if(_loc2_ == null) return 0;
     var _loc3_:Array = _loc2_[param1];
     if(_loc3_ == null) return 0;
     return DuringCheckerWithDecimal.sum(_loc3_,null);
  }
  ```

`BallImpl` 侧统一用这个形状取倍率（照抄 `BallImpl._getSpeedupCorrectionFactor` #56-#63
的 `Decimal_Impl_.toFloat(battle.abilityTotalizer.getTotalSpeedup())`）：

```as3
1 + Decimal_Impl_.toFloat(battle.abilityTotalizer.getTotalDashParameter(<id>))
```

`verify.py` 会断言这 7 个 id 各自只出现在声明的那个体里，
而且**除了这 4 个 BallImpl 体没有任何别的方法体调这个 getter**。

## 面板文案

* 正文：`<参数名><＋/−><百分比>%`，例如「冲刺冷却时间−30%」。
  参数名走一条 7 分支的 if 链（`_param_name_chain`），落不到就写「冲刺参数」；
  百分比走官方 `Decimal_Impl_.toPercentString`；
  整句用官方的 `AbilityDescriptionTools.stringfy(value)` 包成描述闭包。
* 强度片段：与官方 case 0（`PowerFlipDamage`）逐条同形，
  `AbilityDescriptionStringfier_Impl_.convertStrength(AbilityDescriptionTools.stringfyPercentUpDown(param2), false)`。
* 摘要：`<参数名><提升/降低>`。

`CommonAbilityBattleContent` 的其余消费者已逐个查过，index 21 都不会抛：
`AbilityElementExtractor.extractCommonAbilityBattleContent`（无 case → 空转）、
`AbilitySummarizer.getChangeContentFromCommonAbilityBattleContent`（返回 null，
调用方显式判 null）、`PartyRibbonSummarizer.resolveCommonContent`（不加徽章）、
`AbilityGroupingDescriptionGenerator.resolveDuringAbilityGroupingDescriptionKind`
（Battle 分支带 `default: return Option.None`，不分组）、
`AbilityTriggerDifference.diffCommonAbilityBattleContent`（无 case → 不比较）。
`CommonAbilityContentTools` 的 `isAccumulationBest` / `isSameDescriptionByPower` /
`isActiveEvenIfOwnerIsDead` / `hasTargetDescription` 四个都声明返回 `Boolean`，
落到方法末尾的 `returnvoid` 被强制成 `false` —— 对这条 kind 而言
（按和累加、随 SLv 变文案、随持有者死亡失效、不带目标短语）`false` 正是想要的答案，
所以**不动它们**，少改四个体就少四份风险。

### 一处已知的「没做」

`CommonAbilityContentMasterValue.__constructs__` / `CommonAbilityBattleContent.__constructs__`
**没有**跟着加条目,理由与 `kyubi-fever-ratio` 相同:那张表由类初始化器字节码构建,
而这条链上没有代码读它(`Boot.enum_to_string` 读实例的 `tag`,我们填了 `"DashParameter"`)。

## 锁定输入与修改范围

输入 = V12 第一步的产物 `step1-fever.swf`（也可以直接叠在 `base-v11.swf` 上，
两个补丁的目标体不相交）。

新增常量池条目：15 条字符串（`duringDashParameters`、`getTotalDashParameter`、
`DashParameter`、`＋`、`−`、`提升`、`降低`、`冲刺参数` + 7 个参数名）
和 2 个 QName（就是那两个新成员的名字）。
`"%"`、`"422"`、`"strength"`、`"unique_condition_id"` 在基线里已有，不新增。
int / uint / double / namespace / ns_set 五个池一条不改。

## 怎么重建

```bash
python -X utf8 client-patch/dash-parameter/abcpatch.py \
    D:/WF/out/newchars-v12-20260907/step1-fever.swf \
    D:/WF/out/newchars-v12-20260907/v12.swf \
    --report D:/WF/out/newchars-v12-20260907/step2-dash-report.json

python -X utf8 client-patch/dash-parameter/verify.py \
    D:/WF/out/newchars-v12-20260907/step1-fever.swf \
    D:/WF/out/newchars-v12-20260907/v12.swf \
    --report D:/WF/out/newchars-v12-20260907/verified-dash-parameter.json

python -X utf8 -m unittest discover -s client-patch/tests -p "test_*.py"
cd mod-tools && python -X utf8 -m unittest tests.test_client_patch_kinds
```

补丁幂等（已经打过的 SWF 会被拒绝）、可逆（`splice_many` / `unsplice_many` 每次都当场自检）、
输入漂移一个字节就当场报错。

## 还没有数据在用它

V12 只把这条通路装进客户端；`work/character_packs/` 里目前**没有任何一行** `c109=422`。
第一次真用它之前，记得先在真机上验：冲刺手感（冷却/速度/惯性）属于
「改完必须真机看一眼」的那一类，单测证明不了。
