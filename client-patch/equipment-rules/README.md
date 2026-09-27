# 装备规则补丁（equipment-rules）

在 1.4.1047 客户端（APK `66dd8383…`，主 SWF `6e7b2db7…`）上追加三条装备规则。补丁只做**指令级插入**
（battle-rules 的 `core.Editor` 加上本目录自己的方法锁），不回编 AS3，不改动其他补丁的文件。
本目录只产出候选 SWF 和 APK。静态检查、解释器行为测试和 APK 验签都**不等于**已经安装，也不等于实机通过。

## 三条规则

| 规则 | 行为 | 能力声明 | 未打补丁的客户端读到数据时 |
|---|---|---|---|
| R1 衰减分档 | 衰减段装备（默认 5920001–5920999，即 PARADOX）按「本方其他装备件数 n」换档：n=0 原样；n=1..3 换成分档键 `原键+1000·n`，**本体魂和强化能力同时换**；n≥4 整件失效 | `equipment-rules-v1` | 不崩，规则不生效（PARADOX 满档） |
| R2 诅咒互斥 | 诅咒段装备（默认 5910101–5910199 保留段，另可追加 id 或区间）在本方 ≥2 件时，**全部诅咒装备**整件失效（本体+强化）；恰好 1 件时正常 | `equipment-rules-v1` | 不崩，规则不生效 |
| R3 装备表 423 | battle-rules 的持续内容 423「限制技能槽增加」扩展到 `equipment_enhancement_ability`（c109）和 `ability_soul`（c106）两个解析器 | `equipment-gauge-gain-rules-v1` | **C7050**（`EquipmentEnhancementAbilityValues$/parseAt109` / `AbilitySoulValues$/parseAt106`）。数据必须等全员装上本 APK 后才能上 live |

「本方」= 当前客户端自己的队伍：3 个主位的武器槽加魂珠槽，最多 6 件；主位为空时那个槽不计。联机时每个客户端只按自己的队伍判定，队友的能力只用来显示 HUD，所以不会失步。未打补丁的队友不受这几条规则约束，这只是公平性问题，不会崩溃。

## 补丁面

| 方法 | 改动 | 说明 |
|---|---|---|
| `BattleCharacterLogic/getAvailableAbilities` | 在深渊 v4-rs 门控之后、原生 `if(_loc14_)` 之前插 15 条 | 装备或魂珠能力（`_loc12_≠null`）交给 `wfEquipmentRule`：返回 null 表示失效（`_loc14_=false`），返回分档能力就替换 `_loc13_` |
| `BattleCharacterLogic/resolvePathCollection` | 在装备预载 switch 的汇合点插 4 条 | 把衰减装备的全部分档能力交给原生预载闭包（激活槽 7），分档专用的 DSL 和固有状态资源在开战前就会登记 |
| `EquipmentEnhancementAbilityValues$/parseAt109` | 在 #6 插 19 条 | `"423"` 解析为 `CommonAbilityContentMasterValue("GaugeGainRestriction",423,[{target:parseAt110, unique_condition_id:parseAt118}])`，与 battle-rules 在 ability 表的分支逐指令同构 |
| `AbilitySoulValues$/parseAt106` | 在 #6 插 19 条 | 同上，目标 parseAt107、规则码 parseAt115 |
| 新增 `wfIsCursedSoul` / `wfIsDecaySoul` / `wfCountEquipment` / `wfTierAbility` / `wfEquipmentRule` / `wfPreloadEquipmentTiers` | 6 个 `BattleCharacterLogic` 实例方法 | 没有循环，没有向后跳转，没有死代码 |

- 方法锁（sha 和 header）见 `baseline.json`。锚点一律按指令模式查找并要求唯一，找到后还要比对 sha。
- 423 解析之后的所有环节都复用 1047 客户端里已有的 battle-rules 代码：`DuringAbilitySource` 的解析结果、`MemberAbilityTotalizerImpl` 汇总、`MemberImpl` 的回槽拦截、说明文字和面板消费点（8 个 `CommonAbilityContentTools` 方法、3 个 `AbilityDescriptionGenerator` 方法）。
- 装备页面特有的几条路径也核过，都不会在 index 37 上崩：`AbilityElementExtractor` 没有 default 分支，是空操作；`AbilityTriggerDifference` 的 default 是空操作；`AbilitySummarizer` 返回 undefined，调用方用 `!= null` 判断。

### R1 换档细节（v2）

原生的 `BattleEquipmentLogic.getCurrentAbility()` 等于
`new EquipmentAbilityLogic(AbilitySoulAbilityLogic.createForEquipment(ability_soul_id, level, max_level), enhancementLogic.getAbility(enhancementLevel))`。
其中强化部分是 `Some(EquipmentEnhancementAbilityLogic.createForEquipment(装备id, 强化等级, equipment_enhancement.max_enhancement_level))`，
只有 `equipment_enhancement[装备id]` 存在时才是 Some。

`wfTierAbility(peek, soul, n)`：
- 分档魂：`new AbilitySoulAbilityLogic(soul.number, soul.id+1000n, soul.power.calculateMethod, soul.isEquipment, assets)`，
  因此等级缩放、number（41 武器／31 魂珠）和合击可用性都保持原样。
- 魂珠槽（peek===soul）：直接返回分档魂。
- 武器槽：强化部分为 None 时，包成 `EquipmentAbilityLogic(分档魂, None)`；为 Some 时，包成
  `EquipmentAbilityLogic(分档魂, Some(createForEquipment(强化id+1000n, 原 currentLevel, 原 maxLevel)))`。
  这里强化 id 取自原强化能力的 id，也就是**装备 id**。原生构造器里的 2301 一致性检查（number、ownerElement、questKind）照常通过。
- **放行不崩**：分档魂键缺失，或者武器带强化部分但分档强化键缺失时，返回 null，调用方保留原能力（满档）。
  数据门禁必须保证分档键齐全。

## 数据侧要求

**分档键**（n=1..3，默认参数下为 5921001、5922001、5923001）：

| 表 | 是否需要 | 说明 |
|---|---|---|
| `ability_soul` | **必需** | 逐行镜像 5920001：slot、learn_level、触发模式、前置条件、触发、目标都相同，只按比例改增益数值；诅咒行和技能复刻行不缩放；629 行改用分档 DSL 路径和分档 CAS 键 |
| `equipment_enhancement_ability` | **必需**（只要 `equipment_enhancement[5920001]` 存在） | 逐行镜像 5920001：slot、learn_level、max_power_level、c3/c4 战力都相同，只改数值；诅咒行不缩放（包括 R3 的 423 行） |
| `equipment_enhancement`、强化 status、强化商店与类目、`equipment`、`item`、服务端 JSON | **不得出现** | 分档强化能力的等级和上限取自原装备的强化能力对象，不会查这些表。出现在 equipment/item 表会让玩家可以获得分档装备 |
| 5924001（`原键+1000×4`） | 默认**不得出现** | 默认参数下 n≥4 整件失效（诅咒也一起失效）。只有构建参数 `full_decay_key=True` 时它才生效（例如做一份「只剩诅咒」的档），这需要重新构建 APK |

- 分档行里所有 629 的 `string_id` 必须在 `custom_ability_string` 里：战斗装配时会对分档能力调用 `getDescription(false)`，缺键会在开战时报 C8601。
- 分档行引用的固有状态必须存在。

**R3 行**（`equipment_enhancement_ability`，126 列；`ability_soul` 的所有块列号 −3）：

| 列 | 值 | 备注 |
|---|---|---|
| c0 / c1 / c2 / c3 / c4 / c5 | 空闲 slot / `120` / `120` / `48` / `48` / `1` | learn=max=120，持续行 |
| c6 / c13 / c20 | `0` | 三个前置都是 Always |
| c85 | `(None)` | 持续累计触发 |
| c97… | 始终生效的持续触发，见下 | |
| c108 | `false` | 持有者阵亡后诅咒解除（改成 `true` 需作者决定） |
| c109 / c110 / c111 | `423` / `1` / `(None)` | 目标 ExceptMyself；c111 必须写字面量 `(None)`，写空串等于匹配不到任何人 |
| c118 | **`8`** | `wf_battle_rules.gauge_mask(['ability'])` |

- 持续触发建议写 `wf_cursed_weapons.gate_unique(<uid>)`（134「自身持有固有状态」），再配一行 Lv120 的开局 461，给自己挂一个不可驱散、永续的「诅咒」固有状态。这样说明文字是「自身持有「X」时」，有实际含义。
  如果改用 HpHigh 0（c97=0、c98=0、c100/c101=0），面板会显示恒真的「生命值0%以上时」，与作者的文案纪律冲突。
- 面板上 423 显示的是 battle-rules 的通用文字「限制技能槽增加」。作者要的原话「除自身外的角色无法获得能力和装备的技能槽增加效果」建议写进 `equipment_enhancement` 的 c6（上限 54 字）。

**掩码 8 的实际效果**（测试直接执行 1047 里的 `wfBlocksGauge` 验证）：
- 拦截：所有「能力」类回槽，包括连击触发的 24 和施技触发的 40；来源不限，角色、队长、武器（含觉醒和强化）、能力魂、EX 都拦。
- 放行：技能直接回槽（4）、移动跑条（2）、开局（1）、其他动作脚本（64：PF、召唤或炸弹协力球、道具）。
- 629 InvokeSkill：执行上下文里带着创建它的那条能力的地址快照，所以战斗中触发的 629 里的 AddSkillPoint 会按 8/24/40 计算，**会被拦截**。
  **例外**：开局触发的 629 行，它的地址种类是 Initial，battle-rules 把它归为「开局（1）」。这类 DSL 之后即使在战斗中定时加槽，也**不会被拦截**。
  把 1 加进掩码会连真正的开局槽一起拦掉，违背作者口径；要精确修正得改 battle-rules 的来源追溯（Codex 的文件）。
- 7944（8 加上全部五种来源）和 8 的区别只在「查不到来源的能力回槽」。现有调用点都会压入来源上下文，推荐 8。

**数据门禁需要改的地方**（mod-tools，数据侧负责）：
- `wf_client_patch_scope.PATCH_PARSER_TABLES[('during_content','423')]` 加上 `ability_soul` 和 `equipment_enhancement_ability`。
- 这两张表里的 423 行要求 capability `equipment-gauge-gain-rules-v1`。
- `wf_battle_rules.row_problems` 把规则码校验扩展到这两张表：EA 表 c109/c118，魂表 c106/c115。

## 用法

```powershell
# 1) 检查基线（只认 1047 主 SWF）
python -X utf8 client-patch/equipment-rules/apply_equipment_rules.py --input "<1047.apk>" --check
# 2) 生成 SWF：输出目录必须是新的；同时写出 patch-report 和 verify-report（含负对照）
python -X utf8 client-patch/equipment-rules/apply_equipment_rules.py --input "<1047.apk>" --output-dir "<新目录>"
# 3) 独立核验（apply 已自动执行一次，可以复跑）
python -X utf8 client-patch/equipment-rules/verify.py "<新目录>/equipment-rules.swf" --base "<新目录>/baseline.swf"
# 4) 打包签名：沿用 1047 配方；口令只经环境变量传递，本目录的脚本不读取也不保存口令
python -X utf8 client-patch/equipment-rules/package_apk.py --base "<1047.apk>" --swf "<新目录>/equipment-rules.swf" `
  --patch-report "<新目录>/patch-report.json" --output "<新.apk>" --work "<新 work 目录>" `
  --zipalign "<build-tools>/34.0.0/zipalign.exe" --apksigner "<build-tools>/34.0.0/apksigner.bat" `
  --keystore "弹国服/instrument/wf_new.keystore" --ks-pass-env WF_BATTLE_KS_PASSWORD --key-pass-env WF_BATTLE_KEY_PASSWORD
```

`package_apk.py` 调用 `battle-rules/build_apk.py`（它会核对原签名证书、所有非 SWF 成员和压缩方式不变），然后把构建报告里写死的
`candidate_capabilities` 改为「1047 已有能力 + `equipment-rules-v1` + `equipment-gauge-gain-rules-v1`」。

基线和产物（默认参数）：

- 基线主 SWF：`6e7b2db7923d2456ce2b6edc9a42aba51f1f87a099ecc4f606c1de7fc302c497`
- 产物主 ABC：`d99246d9ced7b7e81c81d27ad436347cb2a1b02b861558776f566ef091773b22`，这是验收依据
- 产物 SWF 容器：`6989d31a99a04882a152e5b55343ff2ead65c3ae433d1fc3b5da3985fdfe6237`。这个值依赖 zlib 实现（实测环境是 Python 3.14.6 / zlib-ng 1.3.1）；
  接收方压缩实现不同时，只在报告里标注，不影响验收

## 验证

测试文件 `client-patch/tests/test_equipment_rules.py`，需要本机 1047 SWF 夹具：

```powershell
python -X utf8 -m unittest client-patch/tests/test_equipment_rules.py -v
```

- 结构：只有 4 个锁定方法体改变，其余 92558 个不变；插入段全部能还原出锁定 sha；作用域深度、原有死代码数和 maxstack 保持；
  常量池只追加 6 个方法名和 4 个 int；battle-rules 与回槽性能补丁改过的方法体逐字节相同；同一输入重复打补丁会被拒绝。
- 行为：`verify.gate_matrix` 在 getAvailableAbilities 的真实切片上跑 24 个场景，覆盖 R1 各档、R2、魂珠槽、带强化或不带强化、缺分档键放行不崩，
  以及深渊门控保持原样。`parse_matrix` 整个执行两张表的解析器。`gauge_matrix` 执行 battle-rules 的 `wfBlocksGauge`。
- **负对照**：
  - 同一矩阵在未打补丁的基线上，15 个规则场景全部不满足，控制场景全部相同；两张表读到 423 都抛 7050。
  - 删掉门控里 `pushfalse; setlocal 14` 的变异体，R2 场景不满足。

## 安装（须作者当次授权；本目录不做）

同签名覆盖安装以后，AIR 可能继续运行 `cache/app/<uuid>/assets/` 里解包的旧 SWF。安装步骤：
1. `kill -9` 结束进程；
2. `pm install -r`；
3. `rm -rf /data/data/com.leiting.wf/cache/app`，并确认目录已不存在；
4. 启动游戏；
5. 回读缓存里 SWF 的 sha，应等于产物 SWF。

`Local Store` 里的资源和身份文件不要动。回滚：重装 66dd8383，再清一次 `cache/app`。

## 限制与待定

- 装备详情页和「发动可能能力」弹窗仍然显示满档（弹窗走 `getCurrentAbility()`，不经过本补丁），规则写在装备说明里。
- R1 的 n≥4 默认整件失效，Lv120 诅咒也随之消失。如果作者希望诅咒一直保留，就改用 `full_decay_key=True` 重新构建，并生成一份只含诅咒的 5924001。
- 开局触发的 629 DSL 加槽不会被 R3 拦截（见上文）。
