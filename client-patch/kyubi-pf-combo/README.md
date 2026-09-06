# 九尾狐原生 PF 的弹射前连击快照

能力标识：`kyubi-pf-initial-combo-v1`。仅服务私有 PF 键 `override_fox_oracle_autumn_dual_pf` 的「Fever＋雷属性共鸣＋35 连击」分支。

原生调用顺序是 BallImpl 保存连击到局部变量 → `comboCalculator.expire()` → 启动 PF → 创建 ActionEvaluationResolver。普通 resolver 此时看到的已经是消耗后的连击，因此不能用它判断刚才是否达到 35。PF 等级也不能替代 35，因为降低 PF 所需连击的效果会改变两者对应关系。

本模块保持实际连击的消耗流程，在 BallImpl 追加一个默认 0 的 public int 实例 slot；碰撞方法在消耗前保存 `MaskGeneral.maskBit ^ _loc6_`。只有同时满足以下条件的 resolver 才读取这个球实例的快照：

- `context.kind.index == 5`：原生 PowerFlip。
- `context.kind.params[0] == "override_fox_oracle_autumn_dual_pf"`：精确私有键。
- `context.type.index == 2`：原生 PowerFlip 的类型。
- `context.type.params[0] is BallImpl`：有效的球实例。

其它 PF、主动技能和能力动作继续采用原始当前连击。ZoneManager → Zone → ActionManager 同步创建 resolver，快照在这一次动作创建时立即读取。Fever／共鸣／35 的组合条件保留在角色包 DSL 内，本模块只修正传给原生 ConditionalsCombo 的 initialCombo。

## 锁定输入与修改范围

输入是本地 V9 APK 内 `assets/worldflipper_android_release.swf`，SHA256：

`10e7257703364619cb2241979dfdb1c66307531508ee1fb95406fbe8b9890388`

最终最小 SWF 为 29,164,935 字节，SHA256：

`c5c349a4b114f922d46dc4db1b55405c3e4ddb9aabb96bb968baaa4092f5214d`

不重新编译 AS3 类。`slot.py` 使用仓内 ABC reader/writer 只追加 slot；`pcode.py` 用 FFDec 汇编器只改两个方法体：

| 方法 | body index | 代码字节 | 新增指令 |
|---|---:|---:|---:|
| ActionEvaluationResolver 构造器 | 52311 | 871 → 959 | 33 |
| BallImpl.resolveCollisionForPrimaryOrSummons | 59953 | 1455 → 1469 | 6 |

`patch.py` 根据重新从 V9 导出的两类源码生成可读的修改意图，带完整输入哈希、可逆与幂等守卫。生成的 AS3 仅用于核对意图，正式构建使用 slot／P-code 路径；不应把源码整类重新编译后当作最小补丁。

## 复现

使用 Java 8 与 FFDec 24.0.1。先从锁定 V9 APK 提取 SWF；下方 `BASE`、`OUT` 分别代表该 SWF 和单独的构建输出目录，替换为真实绝对路径。

1. FFDec 导出这两个类的 P-code：

   `java -Xmx6g -jar ffdec.jar -format script:pcode -selectclass pinball.scene.battle.battle.squad.ball.BallImpl,pinball.scene.battle.battle.action.ActionEvaluationResolver -export script OUT/pcode BASE`

2. 追加 slot：

   `python client-patch/kyubi-pf-combo/slot.py BASE OUT/with-slot.swf`

3. 生成两个方法片段：

   `python client-patch/kyubi-pf-combo/pcode.py --kind ball OUT/pcode/scripts/pinball/scene/battle/battle/squad/ball/BallImpl.pcode OUT/ball.pcode`

   `python client-patch/kyubi-pf-combo/pcode.py OUT/pcode/scripts/pinball/scene/battle/battle/action/ActionEvaluationResolver.pcode OUT/resolver.pcode`

4. 一次汇编两个方法：

   `java -Xmx6g -jar ffdec.jar -air -onerror abort -replace OUT/with-slot.swf OUT/final.swf pinball.scene.battle.battle.squad.ball.BallImpl OUT/ball.pcode 59953 pinball.scene.battle.battle.action.ActionEvaluationResolver OUT/resolver.pcode 52311`

5. 独立检查：

   `python client-patch/kyubi-pf-combo/verify.py BASE OUT/final.swf --report OUT/verified.json`

此模块不签名或安装 APK，也不操作角色包、服务或设备。

## 验证

`python -m unittest discover -s client-patch/kyubi-pf-combo -p test_patch.py`：本地 V9 证据齐备时 8 项通过。测试缺少本地二进制 fixture 时明确 skip。

`verify.py` 使用独立的 `rank-scene-p2/independent` 解析器，与 slot 写入器相互独立。已证明：

- 351 个 SWF tag 仅第 347 个 boot_ffc6 改变；其它 ABC 与资源 tag 原样。
- 原常量池都是前缀不变；只新增两个字符串、一个 QName。
- method_info／metadata／class_info／script_info 不变。Ball 既有 slot 顺序和构造器不变，只追加一个默认 0 的 int。
- 主 ABC 共 92,557 个方法体，仅上表两处改变。全 SWF 共 96,400 个方法体，其余 96,398 个代码字节完全相同。
- 两个方法的所有原指令、原分支目标与元数据不变；新增分支指令清单逐条核对。
- 新代码全部可达，栈／scope 深度无冲突、无溢出、无下溢，分支目标均落在指令边界。resolver 最大栈 8，Ball 最大栈 6，均沿用原声明。
- V9 的 MemberImpl、SquadManagerImpl、ActionEvaluator、AbilityDamageShot 重新导出后逐字相同。

这些是包／字节码静态证据；游戏内行为仍由作者查看。
