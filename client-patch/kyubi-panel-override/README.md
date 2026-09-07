# 九尾狐详情面板文案覆盖（V11）

能力标识：`kyubi-panel-description-override-v1`。只改描述生成，不改任何机制。

## 覆盖键契约

角色详情页的词条面板和队长技面板，在生成文案之前先查一次 CDN 表 `custom_ability_string`：

- 键 = `desc_override_` + 该词条／队长技第 0 行的 `string_id`（ability/leader 表的 c0）。
  例：`desc_override_fox_oracle_autumn_1`、`desc_override_fox_oracle_autumn_6`、
  队长技 `desc_override_fox_oracle_autumn`。
- 值 = 整条词条（不是单行）的完整文案，行与行之间用 `\n` 分隔。
- 命中：直接用作者写的文本，官方生成器**根本不执行**。
- 未命中：`MasterMapBase.getMaybe` 返回 null（它不抛异常），原方法体原样执行。

**V11 只服务九尾狐。** 只有 `string_id` 以 `fox_oracle_autumn` 开头的行才会去查表；
其它角色和全部官方词条连 `getMasterTable` 都不会调用。要扩到别的角色，
改 `patch.py` 里的 `STRING_ID_PREFIX` 并重新构建。

数据侧（往 `custom_ability_string` 里加 `desc_override_*` 行）不属于本模块，由发布链单独完成。
未打补丁的客户端读不到这些行，它们是惰性的——所以数据可以先发、APK 后到。

## 机制不动

补丁只落在 `pinball.common.data.ability` 的四个方法体里。
`pinball.scene.battle.*` 一个字节没变，词条行的 kind（213／461／186／187／199 等）
也一个都没改，所以取整顺序、无状态回退、主位／副位行为全部由原来那些行照旧执行。
这一条由 `client-patch/tests/test_kyubi_panel_override.py` 与
`verify.py` 的「只有 4 个方法体变化」断言共同保证，不是靠注释。

| 类 | 方法 | body index | 代码字节 | 新增指令 |
|---|---|---:|---:|---:|
| `AbilityLogic` | `getDescriptions` | 7435 | 31 → 138 | 85 |
| `AbilityLogic` | `getDescriptionWithSimplify` | 7436 | 42 → 267 | 92 |
| `LeaderAbilityLogic` | `getDescriptions` | 7772 | 31 → 138 | 85 |
| `LeaderAbilityLogic` | `getDescriptionWithSimplify` | 7773 | 42 → 267 | 92 |

四段前缀形状一致：

1. `values` 为空、`values[0]` 为空、`string_id` 前缀不符、表里没这行、`string` 为空
   —— 任何一条不满足都跳到 `PanelOverrideSkip`，走原方法体。
   `String(...)` 转换让 `string_id` 为 null 时得到 `"desc_override_null"`，前缀不匹配，
   不会空引用。
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

## 锁定输入与修改范围

输入是 V10 APK 内 `assets/worldflipper_android_release.swf`，SHA256：

`c5c349a4b114f922d46dc4db1b55405c3e4ddb9aabb96bb968baaa4092f5214d`

（V10 APK 本身 SHA256 `ea5d8413003f1d13c3fcd6ca734e54555264b86a348c48691c8980e0868837c9`。）

最终最小 SWF 为 29,165,818 字节，SHA256：

`9c86430e7dc230e2abd7aa799a9ecaeb9be6056278712d9b2939878912ed5900`

不重新编译 AS3 类，也**不需要 `slot.py`**：本补丁不追加任何 ABC trait，
instance／class／script／method_info 表逐字节不变。
`pcode.py` 用 FFDec 汇编器只改上表四个方法体；每个原始块都按 SHA-256 锁定，
splice 幂等且可逆。`patch.py` 把同一处改动渲染成可读 AS3 供核对意图，
带完整源码哈希、可逆与幂等守卫；生成的 AS3 不参与构建。

新增常量池条目只有两个字符串：`desc_override_` 与 `desc_override_fox_oracle_autumn`。
新增 multiname 0 个——`CustomAbilityStringTable`、`SkillReplaceStringTable`
以及全部方法名早就在 V10 池里。`"\n"` 复用了池里已有的换行字面量
（这同时证明汇编器把 `\n` 当转义读，而不是两个字符）。

## FFDec 版本

`kyubi-pf-combo` / `kyubi-pf-damage` 钉的是 FFDec **24.0.1**。
仓库根下只有 `ffdec_26.2.1/`，但 24.0.1 确实在本机：
`D:/WF/tool-projects/starview-windows/ffdec/ffdec.jar`（`--help` 自报 v.24.0.1）。
用它从 V9 基线重新导出 `BallImpl`，`resolveCollisionForPrimaryOrSummons` 的块哈希
与 `kyubi-pf-combo/pcode.py` 里锁的 `BALL_BLOCK_SHA256`
（`0701345d6f668a57f0af9bc10f8801ef32ea5ca89d4a0a8b78a8bd53284ce7fb`）逐字节相同。
所以 V11 沿用 24.0.1，既有锁定哈希全部继续有效，不需要重锁，也没有绕过任何哈希门禁。

## 复现

用 Java 17 与 FFDec 24.0.1。先从锁定的 V10 APK 提取 SWF；下面 `BASE`、`OUT`
分别代表该 SWF 和一个独立的构建输出目录，替换为真实绝对路径。

1. 导出两个类的 P-code（AS 源码导出用于 `patch.py` 的意图核对）：

   `java -Xmx6g -jar ffdec.jar -format script:pcode -selectclass pinball.common.data.ability.AbilityLogic,pinball.common.data.ability.LeaderAbilityLogic -export script OUT/v10-pcode BASE`

2. 生成四个方法片段（每个 `--class-name`／`--method` 组合各一次）：

   `python client-patch/kyubi-panel-override/pcode.py OUT/v10-pcode/scripts/pinball/common/data/ability/AbilityLogic.pcode OUT/splice/AbilityLogic.getDescriptions.pcode --class-name AbilityLogic --method getDescriptions`

3. 一次汇编四个方法：

   `java -Xmx6g -jar ffdec.jar -air -onerror abort -replace BASE OUT/v11-minimal.swf pinball.common.data.ability.AbilityLogic OUT/splice/AbilityLogic.getDescriptions.pcode 7435 pinball.common.data.ability.AbilityLogic OUT/splice/AbilityLogic.getDescriptionWithSimplify.pcode 7436 pinball.common.data.ability.LeaderAbilityLogic OUT/splice/LeaderAbilityLogic.getDescriptions.pcode 7772 pinball.common.data.ability.LeaderAbilityLogic OUT/splice/LeaderAbilityLogic.getDescriptionWithSimplify.pcode 7773`

4. 独立检查：

   `python client-patch/kyubi-panel-override/verify.py BASE OUT/v11-minimal.swf --report OUT/verified-minimal.json`

此模块不签名或安装 APK，也不操作角色包、服务或设备。

## 验证

`python -m unittest discover -s client-patch/tests -p "test_*.py"`：
本模块贡献 20 项。缺少本地 V10／V11 二进制 fixture 时相关用例明确 skip。

`verify.py` 使用独立的 `rank-scene-p2/independent` 解析器（与 FFDec 和 `pcode.py`
都无共享代码）。已证明：

- 351 个 SWF tag 仅第 347 个 `boot_ffc6` 改变；其它 ABC 与资源 tag 原样。
- 原常量池全部前缀不变；只新增两个字符串，0 个 multiname，0 个 instance trait。
- `method_info`／`metadata`／`class_info`／`script_info`／`instance_info` 完全不变。
- 全 SWF 共 96,400 个方法体，只有上表四个改变，其余 96,396 个代码字节完全相同。
- 四个方法的原有指令、原有分支目标、异常表、body traits、`initscopedepth`、
  `maxscopedepth` 全部不变；只有 `localcount` 增大（1→8、4→11），`maxstack` 未动
  （实算 2／3，与原声明相同）。
- 插入的指令序列被重新反汇编后，逐条与 `pcode.py` 的语句列表相符（含分支目标下标）。
- 新代码全部可达，栈／scope 深度无冲突、无溢出、无下溢，分支目标均落在指令边界。
- **`getlex` 前置证明**：`CustomAbilityStringTable`（multiname 3641）与
  `SkillReplaceStringTable`（3877）在**未打补丁的 V10** 里就已存在于常量池，
  并且已经被同一个 ABC 里的 5～6 个方法体 `getlex` 过——其中
  `pinball.common.data.skill.action::ActionSkillLogic/getDescription`
  正是「data-logic 类 → `logicAssets.getMasterTable(...)` → `get_data()`」的官方样板。
  引入构建里没有的类做 `getlex` 是已知的硬崩因（记忆 `wf-special-slot-dual-form`），
  所以这一条是断言，不是假设。
- V9／V10 已改过的六个类（`MemberImpl`、`SquadManagerImpl`、`ActionEvaluator`、
  `AbilityDamageShot`、`BallImpl`、`ActionEvaluationResolver`）重新导出后逐字节相同；
  body 52311 与 59953 的代码字节也逐字节相同。
- 把成品 SWF 重新反编译回 AS3，读到的就是意图里那段逻辑（见构建目录
  `preserve-final/`），与 `patch.py` 生成的可读版本一致。

这些是包／字节码静态证据；游戏内行为仍由作者查看。

## 残留风险（未被本补丁覆盖）

- **ClientError 8013**：`getMasterTable` 在表没加载进当前容器时会抛
  （`CommonLogicAssetContainer.as:227-231`，它会先尝试懒加载）。前缀守卫把这条路径
  限制在九尾狐；队长技第 8 行的 kind 722 今天已经在同一张面板上读同一张表，
  所以详情页容器里表是加载过的。但 `OwnedCharacterSearcher.as:237/261`
  在文本搜索时会对每个已拥有角色调 `getDescriptionWithSimplify`，那个场景的容器
  未经实测——真机若在搜索页看到 8013，需要把探测再收紧（按 ability id 白名单）。
- **未被覆盖的其它文案出口**：`AbilityDisabledReasonResolver`（:173/:421/:533）
  自己新建 `InstantAbilityDescriptionGenerator` 解释「为什么置灰」；
  `AbilityDiffDescriptionTools.getDiffDescription`（觉醒／玛纳对比弹窗，
  `AbilityLogic.as:249`）；`PartyRibbonSummarizer`。这三处仍会显示官方生成的原文，
  内部数值可能从那里漏出来。真机确认后再决定要不要扩补丁。
- **文本搜索语义变化**：`OwnedCharacterSearcher` 归一化的是
  `getDescriptionWithSimplify` 的输出，所以搜官方措辞（例如「FEVER槽」）
  将不再命中被覆盖的词条。前缀守卫把影响限制在九尾狐。
- **文案漂移**：覆盖文本是手写的，没有任何现有工具能校验它和行数据是否一致
  （`wf_describe.py:12-14` 明说它不是游戏原文）。漂移门禁属于数据侧任务，
  不在本模块内。
- **只拿到分享包、没拿到 APK 的第三方**（灰／Ku1o）会继续看到官方原文，
  `desc_override_*` 行对他们是惰性的。这不是故障，但要在交接里写明。
- **`logicAssets` 为 null** 时前缀命中后会空引用；但原方法体同样要用它构造生成器，
  所以这不是补丁引入的新失败模式。
