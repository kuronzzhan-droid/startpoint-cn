# 详情面板文案覆盖（V11 → V14）

能力标识两个，V14 APK **同时提供**：

| 标识 | 契约 |
|---|---|
| `kyubi-panel-description-override-v1` | V11：只有 `string_id` 以 `fox_oracle_autumn` 开头的行会被覆盖。名字不改，老包的 `required_capabilities` 继续有效。 |
| `panel-description-override-v2` | V14：**任意** `desc_override_<string_id>` 都生效；取表改走不抛异常的 `getMasterTableMaybe`。 |

只改描述生成，不改任何机制。

## 覆盖键契约

角色详情页的词条面板和队长技面板，在生成文案之前先查一次 CDN 表 `custom_ability_string`：

- 键 = `desc_override_` + 该词条／队长技第 0 行的 `string_id`（ability/leader 表的 c0）。
  例：`desc_override_fox_oracle_autumn_1`、`desc_override_fox_oracle_autumn_6`、
  队长技 `desc_override_fox_oracle_autumn`。
- 值 = 整条词条（不是单行）的完整文案，行与行之间用 `\n` 分隔。
- 命中：直接用作者写的文本，官方生成器**根本不执行**。
- 未命中：`MasterMapBase.getMaybe` 返回 null（它不抛异常），原方法体原样执行。

**V14 服务所有角色。** `patch.py` 的 `STRING_ID_PREFIX = ""`，于是
`GUARD_PREFIX == KEY_PREFIX == "desc_override_"`：键是补丁自己拼的，一定以这个
前缀开头，所以那道 `indexOf` 闸变成恒真。**它照样留着** —— 那是「以后想再收窄
成某几个角色」的唯一开关：把 `STRING_ID_PREFIX` 填回去重打一次即可，代码不用改。
（V11 的行为 = `STRING_ID_PREFIX = "fox_oracle_autumn"`。）

`string_id` 为 null 时 `String(null)` 得到 `"desc_override_null"`，表里永远没有
这一行，照样落空——不会空引用。

数据侧（往 `custom_ability_string` 里加 `desc_override_*` 行）不属于本模块，由发布链单独完成。
未打补丁的客户端读不到这些行，它们是惰性的——所以数据可以先发、APK 后到。

## 机制不动

补丁只落在 `pinball.common.data.ability` 的四个方法体里。
`pinball.scene.battle.*` 一个字节没变，词条行的 kind（213／461／186／187／199 等）
也一个都没改，所以取整顺序、无状态回退、主位／副位行为全部由原来那些行照旧执行。
这一条由 `client-patch/tests/test_kyubi_panel_override.py` 与
`verify.py` 的「只有 4 个方法体变化」断言共同保证，不是靠注释。

| 类 | 方法 | body index | 代码字节（V14） | 新增指令 |
|---|---|---:|---:|---:|
| `AbilityLogic` | `getDescriptions` | 7435 | 31 → 230 | 90 |
| `AbilityLogic` | `getDescriptionWithSimplify` | 7436 | 42 → 278 | 97 |
| `LeaderAbilityLogic` | `getDescriptions` | 7772 | 31 → 230 | 90 |
| `LeaderAbilityLogic` | `getDescriptionWithSimplify` | 7773 | 42 → 278 | 97 |

（V11 是 222 / 267 / 222 / 267，85 与 92 条指令；V14 每个方法多 5 条，
就是下面第 1 条里那道新增的主表判空。）

四段前缀形状一致：

1. `values` 为空、`values[0]` 为空、拼出来的键不以 `GUARD_PREFIX` 开头
   （V14 恒成立，见上）、**主表没加载**、表里没这行、`string` 为空
   —— 七道闸任何一条不满足都跳到 `PanelOverrideSkip`，走原方法体。
2. simple 模式下跑一遍 `SkillReplaceStringTable` 替换，和官方 kind 629 分支
   （`InstantAbilityDescriptionGenerator.as:8337-8347`）完全一样。
   `StringTools.replace` 被内联成 `split/join`——那就是它的全部函数体
   （`StringTools.as:150-153`）。
   simple 开关的取值来源分别对齐官方：`getDescriptions` 里官方是生成器构造函数
   从容器取（`AbilityGroupingDescriptionGenerator.as:54`），所以补丁调
   `logicAssets.getSimpleAbilityDescriptionEnabled()`；`getDescriptionWithSimplify`
   里官方用 `param2` 覆盖它，所以补丁读 `param2`。
3. `text.split("\n")`：`getDescriptions` 直接返回这个数组；
   `getDescriptionWithSimplify` 再用
   `logicAssets.getUiString(param1 ? "ability_description_delimiter_newline" : "ability_description_delimiter")`
   拼回字符串，与 `AbilityGroupingDescriptionGenerator.stringfy`（:480-484）一致。

只用 `getMaybe`，绝不用 `get`——`get` 在缺行时会空引用（`MasterMapBase.as:74-84`）。

## 取表为什么必须用 `getMasterTableMaybe`（V14 的安全前提）

V11 的守卫把探测限制在一个角色，所以「表没加载」最坏只崩九尾狐的面板。
V14 放开守卫之后，**每个角色、每条官方词条**都会走一次取表——同一个失败模式
会变成全角色崩。所以 V14 把 `CustomAbilityStringTable` 那一次取表换成
`ILogicAssetContainer.getMasterTableMaybe` + 判空。

`ILogicAssetContainer` 只有两个实现：

* **`LogicAssetContainer`**（`pinball/asset/logic/LogicAssetContainer.as:39`）
  —— **游戏跑的就是这个**。`getMasterTable`（:486-497）→
  `getMasterTableWithPath`（:448-457）→ `_getMasterTableWithPath`（:908-943）
  在 `assetCaches` / `reservedResetAssetCaches` 里找，找不到就
  `throw new ClientError(8013)`，**没有懒加载兜底**。
  `getMasterTableMaybe`（:473-484）走同一个 `_getMasterTableWithPath`，
  找不到返回 **null**。
* **`CommonLogicAssetContainer`**（`:27`）—— 全仓唯一构造点是
  `test/core/base/SmallTestBase.as:21`，**测试专用**。它才是「先懒加载再抛 8013」
  （:227-231）的那个。V11 README 引它来论证真机行为是**引错了容器**，本节更正。

官方读这张表的地方全仓只有 4 处，而且都在**按 kind 分支的闭包**里：
`AbilityDescriptionGenerator.as:8531`（case 15）、`:8734`（case 19）、
`InstantAbilityDescriptionGenerator.as:8336`（case 19）、
`AbilityDescriptionTools.as:3055`（`getCustomAbilityString`，由前几处调）。
四处都走 `param1.container`，与 `AbilityLogic.logicAssets` 是**同一个对象**
（`AbilityGroupingDescriptionGenerator(logicAssets)`，:47-55 把容器原样存进字段）
—— 所以容器身份没问题。但它们是**懒的**：只有真的渲染到一条 kind 15/19 的行
才会执行。这只能证明「渲染过这类行的场景」表是加载的，证明不了详情页／编成页／
`OwnedCharacterSearcher` 文本搜索（:237/:261）每一个场景都加载了它
—— 加载清单是场景级的资产路径集合（数据侧），AS3 里看不到。

**所以不赌，改用不抛的取表口。** 表加载了，两个方法返回同一个对象，行为与 V11
逐字相同；表没加载，面板显示官方原文而不是崩。官方同形先例：
`TrimmedImageRepository.as:25`（`getMasterTableMaybe` + 判空）。

简单模式那一遍 `SkillReplaceStringTable` 仍用 `getMasterTable`：它只在**已经命中
覆盖行之后**才执行，而能命中就说明这个容器供得出 `custom_ability_string`；
官方 kind 15/19 分支里也是同一段闭包里这么写的。`verify.py` 断言
「`getMasterTable` 的出现次数 == `SkillReplaceStringTable` 的出现次数」，
谁把 `CustomAbilityStringTable` 那一处改回 `getMasterTable` 都会当场变红。

补一句没有变的部分：`values[0].string_id` 这个 `getproperty` **V11 就已经对所有
角色执行**（键是先拼再判前缀的），V13a 已装在真机上跑过。V14 唯一新增的暴露面
就是这次取表。

## 锁定输入与修改范围

V11 的输入是 V10 APK 内 `assets/worldflipper_android_release.swf`，SHA256
`c5c349a4b114f922d46dc4db1b55405c3e4ddb9aabb96bb968baaa4092f5214d`
（V10 APK 本身 `ea5d8413003f1d13c3fcd6ca734e54555264b86a348c48691c8980e0868837c9`）。

V13a/V14 改成从 V8 基线重建整条链，所以本补丁在那条链上的输入是
`step2-v10.swf`，SHA256
`f3c5b58a2e09f3ad70532d7720f417a9d56c9f22cff8e4c8ac47536a95dc83a4`
（`patch.V8_CHAIN_V10_SWF_SHA256`；V9/V10 改过的两个体在这条链上是 52322 / 60035，
见 `patch.V8_CHAIN_PRESERVED_BODIES`）。两条链上这四个方法体的 FFDec 导出块
**逐字节相同**——`pcode.py` 锁的四个块哈希在两边都命中，这就是机器证明。

V14 产物：`step3-v11.swf` 29,096,098 字节，SHA256
`e1a552299be4964852cb2ce8b41969f9300b2d1106b1f2ce43aaa8a5f5cc2519`；
整链终产物与 APK 见 `D:/WF/out/newchars-v14-20260908/BUILD.md`。

不重新编译 AS3 类，也**不需要 `slot.py`**：本补丁不追加任何 ABC trait，
instance／class／script／method_info 表逐字节不变。
`pcode.py` 用 FFDec 汇编器只改上表四个方法体；每个原始块都按 SHA-256 锁定，
splice 幂等且可逆。`patch.py` 把同一处改动渲染成可读 AS3 供核对意图，
带完整源码哈希、可逆与幂等守卫；生成的 AS3 不参与构建。

V14 新增常量池条目**只有一个字符串**：`desc_override_`
（守卫与键前缀是同一个串，汇编器按串去重；V11 因为守卫另有其串所以是两个）。
新增 multiname 0 个——`CustomAbilityStringTable`、`SkillReplaceStringTable`
以及全部方法名（含 `getMasterTableMaybe`，QName
`pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe`，multiname 8210，
与 `getMasterTable` 的 6949 同命名空间 380）早就在池里。
`"\n"` 复用了池里已有的换行字面量（这同时证明汇编器把 `\n` 当转义读，
而不是两个字符）。

## FFDec 版本

`kyubi-pf-combo` / `kyubi-pf-damage` 钉的是 FFDec **24.0.1**。
仓库根下只有 `ffdec_26.2.1/`，但 24.0.1 确实在本机：
`D:/WF/tool-projects/starview-windows/ffdec/ffdec.jar`（`--help` 自报 v.24.0.1）。
用它从 V9 基线重新导出 `BallImpl`，`resolveCollisionForPrimaryOrSummons` 的块哈希
与 `kyubi-pf-combo/pcode.py` 里锁的 `BALL_BLOCK_SHA256`
（`0701345d6f668a57f0af9bc10f8801ef32ea5ca89d4a0a8b78a8bd53284ce7fb`）逐字节相同。
所以 V11 沿用 24.0.1，既有锁定哈希全部继续有效，不需要重锁，也没有绕过任何哈希门禁。

## 复现

用 Java 17 与 FFDec 24.0.1。`BASE` 是本补丁的输入 SWF（V11 那条链上是 V10 APK
里的那个；V13a/V14 那条链上是 `step2-v10.swf`），`OUT` 是一个独立的构建输出目录，
都替换成真实绝对路径。V14 的完整命令序列见
`D:/WF/out/newchars-v14-20260908/BUILD.md` §6。

1. 导出两个类的 P-code（AS 源码导出用于 `patch.py` 的意图核对）：

   `java -Xmx6g -jar ffdec.jar -format script:pcode -selectclass pinball.common.data.ability.AbilityLogic,pinball.common.data.ability.LeaderAbilityLogic -export script OUT/v10-pcode BASE`

2. 生成四个方法片段（每个 `--class-name`／`--method` 组合各一次）：

   `python client-patch/kyubi-panel-override/pcode.py OUT/v10-pcode/scripts/pinball/common/data/ability/AbilityLogic.pcode OUT/splice/AbilityLogic.getDescriptions.pcode --class-name AbilityLogic --method getDescriptions`

3. 一次汇编四个方法：

   `java -Xmx6g -jar ffdec.jar -air -onerror abort -replace BASE OUT/v11-minimal.swf pinball.common.data.ability.AbilityLogic OUT/splice/AbilityLogic.getDescriptions.pcode 7435 pinball.common.data.ability.AbilityLogic OUT/splice/AbilityLogic.getDescriptionWithSimplify.pcode 7436 pinball.common.data.ability.LeaderAbilityLogic OUT/splice/LeaderAbilityLogic.getDescriptions.pcode 7772 pinball.common.data.ability.LeaderAbilityLogic OUT/splice/LeaderAbilityLogic.getDescriptionWithSimplify.pcode 7773`

4. 独立检查：

   `python client-patch/kyubi-panel-override/verify.py BASE OUT/v11-minimal.swf --report OUT/verified-minimal.json`

   从 V8 链跑时要告诉它这条链的基线哈希与保留体下标：
   `verify.verify(base, final, base_swf_sha256=patch.V8_CHAIN_V10_SWF_SHA256,
   preserved_bodies=patch.V8_CHAIN_PRESERVED_BODIES)`（`verify_v14.py` 就是这么调的）。

此模块不签名或安装 APK，也不操作角色包、服务或设备。

## 验证

`python -m unittest discover -s client-patch/tests -p "test_*.py"`：
本模块贡献 23 项（`client-patch/tests/test_kyubi_panel_override.py`）。
缺少本地构建二进制 fixture 时相关用例明确 skip。
V14 构建（`D:/WF/out/newchars-v14-20260908`）在场时全 260 项绿、22 skip。

`verify.py` 使用独立的 `rank-scene-p2/independent` 解析器（与 FFDec 和 `pcode.py`
都无共享代码）。已证明：

- 351 个 SWF tag 仅第 347 个 `boot_ffc6` 改变；其它 ABC 与资源 tag 原样。
- 原常量池全部前缀不变；V14 只新增一个字符串（V11 是两个），
  0 个 multiname，0 个 instance trait。
- `method_info`／`metadata`／`class_info`／`script_info`／`instance_info` 完全不变。
- 主 ABC 共 92,555 个方法体（V8 链），只有上表四个改变，其余逐字节相同；
  整 SWF 96,398 个体的差分见构建目录的 `v14-method-diff.json`。
- 四个方法的原有指令、原有分支目标、异常表、body traits、`initscopedepth`、
  `maxscopedepth` 全部不变；只有 `localcount` 增大（1→8、4→11），`maxstack` 未动
  （实算 2／3，与原声明相同）。
- 插入的指令序列被重新反汇编后，逐条与 `pcode.py` 的语句列表相符（含分支目标下标）。
- 新代码全部可达，栈／scope 深度无冲突、无溢出、无下溢，分支目标均落在指令边界。
- **调用前置证明**：`getMasterTable`（multiname 6949，基线里 529 个方法体调过）
  与 `getMasterTableMaybe`（8210，1 个方法体调过 —— `TrimmedImageRepository`）
  两个 interface QName 在**未打补丁的基线**里就已存在并被 callproperty 过，
  所以补丁没有引入新的分派形状。
- **`getlex` 前置证明**：`CustomAbilityStringTable`（multiname 3641）与
  `SkillReplaceStringTable`（3877）在**未打补丁的 V10** 里就已存在于常量池，
  并且已经被同一个 ABC 里的 5～6 个方法体 `getlex` 过——其中
  `pinball.common.data.skill.action::ActionSkillLogic/getDescription`
  正是「data-logic 类 → `logicAssets.getMasterTable(...)` → `get_data()`」的官方样板。
  引入构建里没有的类做 `getlex` 是已知的硬崩因（记忆 `wf-special-slot-dual-form`），
  所以这一条是断言，不是假设。
- V9／V10 已改过的类重新导出后逐字节相同；`preserved_bodies` 指定的两个体
  （V10 链 52311／59953，V8 链 52322／60035）代码字节逐字节相同。
- 把成品 SWF 重新反编译回 AS3，读到的就是意图里那段逻辑（V14 见构建目录
  `readback-as/`），与 `patch.py` 生成的可读版本一致。

这些是包／字节码静态证据；游戏内行为仍由作者查看。

## 残留风险（未被本补丁覆盖）

- **ClientError 8013 已被结构性排除，但代价是「静默不生效」。**
  取表走 `getMasterTableMaybe`（见上一节），所以任何场景、任何角色，
  表没加载都只是回落到官方原文，不抛异常。反过来说：如果真机上某个入口
  （详情页／编成页／文本搜索／对比弹窗）覆盖文案没出来，第一嫌疑就是
  **那个场景没加载 `custom_ability_string`**，而不是数据写错。
  这条只能真机看；没有静态判据。
- **覆盖面只到 `AbilityLogic` / `LeaderAbilityLogic`。**
  `AbilitySoulAbilityLogic`（`:417/:437`）、`EquipmentAbilityLogic`（`:246/:265`）、
  `EquipmentEnhancementAbilityLogic`（`:400`）、`ExAbilityLogic`（`:125`）
  各有自己的 `getDescriptions` / `getDescriptionWithSimplify`，本补丁一个都不碰
  —— 能力魂／武器／武器强化／EX 词条即使写了 `desc_override_*` 行也是惰性的。
- **未被覆盖的其它文案出口**：`AbilityDisabledReasonResolver`（:173/:421/:533）
  自己新建 `InstantAbilityDescriptionGenerator` 解释「为什么置灰」；
  `AbilityDiffDescriptionTools.getDiffDescription`（觉醒／玛纳对比弹窗，
  `AbilityLogic.as:249`）；`PartyRibbonSummarizer`。这三处仍会显示官方生成的原文，
  内部数值可能从那里漏出来。真机确认后再决定要不要扩补丁。
- **文本搜索语义变化**：`OwnedCharacterSearcher`（`:237/:261`）归一化的是
  `getDescriptionWithSimplify` 的输出，所以搜官方措辞（例如「FEVER槽」）
  将不再命中被覆盖的词条。V11 时这个影响只限九尾狐；**V14 扩到所有写了
  覆盖行的角色**——写覆盖文案时要顺手想一想搜索。
  （`OwnedAbilitySoulSearcher` / `OwnedEquipmentSearcher` 走的是上面那几个
  没被补丁覆盖的类，不受影响。）
- **文案漂移**：覆盖文本是手写的，没有任何现有工具能校验它和行数据是否一致
  （`wf_describe.py:12-14` 明说它不是游戏原文）。漂移门禁属于数据侧任务，
  不在本模块内。
- **只拿到分享包、没拿到 APK 的第三方**（灰／Ku1o）会继续看到官方原文，
  `desc_override_*` 行对他们是惰性的。这不是故障，但要在交接里写明。
  装了 V11 APK 但没装 V14 的人，只看得到九尾狐的覆盖文案。
- **恒真的守卫**：`STRING_ID_PREFIX = ""` 让 `indexOf` 那一条永远成立，
  是一段「不会跳的分支」。留着是为了收窄成本为零；但读 P-code 的人要知道
  它现在不筛任何东西，真正的筛选完全在表里。
- **`logicAssets` 为 null** 时前缀命中后会空引用；但原方法体同样要用它构造生成器，
  所以这不是补丁引入的新失败模式。
