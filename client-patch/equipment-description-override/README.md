# 装备详情文案覆盖（equipment-description-override）

作者要求把 PARADOX（装备 5920001）详情页的说明写成一段简化文案：攻击力、全部伤害类型和全部独立乘区合写。
这靠数据做不到，因为说明是客户端按词条逐行生成的。所以本补丁照着 kyubi 面板覆盖（`panel-description-override-v2`）的做法，
在客户端生成说明之前先查一次 `custom_ability_string`：查到就直接用作者写的文案，查不到就走原方法体。

补丁只做**指令级插入**：用 battle-rules 的 `core.Editor`，加本目录自己的方法锁，不走 FFDec，不回编 AS3。
本目录只产出候选 SWF 和 APK。静态检查、解释器行为测试和 APK 验签都**不等于**已经安装，也不等于实机通过。

## 构建链

| 环节 | APK | 主 SWF 容器 | 主 ABC |
|---|---|---|---|
| 1.4.1047（含 kyubi V14 面板覆盖） | `66dd8383…` | `6e7b2db7…` | — |
| equipment-rules（已装在作者 MuMu 上） | `e03bc22b69ca869d…` | `6989d31a99a04882…` | `d99246d9ced7b7e8…` |
| **本补丁** | 见下方「产物」 | `cdc4c1d1fea3080e…` | `4994e23d612c24a7…` |

- 基线按**主 ABC** `d99246d9…` 判定。容器哈希 `6989d31a…` 只作参考，因为同一份 ABC 可能被装进别的容器（比如重新压成 CWS）。
- 其他基线一律拒绝。输入如果已经打过本补丁，报告为 `already_patched`。
- 签名证书 `729507c10a893879…` 与 e03bc22b 相同，所以候选 APK 可以用 `pm install -r` 覆盖安装。

## 补丁面

三个方法都在 #2 插入，位置是 `getlocal_0; pushscope` 之后、原生第一条指令之前，策略为 FORBID（原方法体里没有分支指向 #2）。

| 方法 | 体 | 插入 | header 前 → 后 | 消费点 |
|---|---:|---:|---|---|
| `AbilitySoulAbilityLogic/getDescriptionsWithoutAdditional` | 7492 | 29 | `[2,6,1,2]` → `[2,9,1,2]` | 持有详情 `DialogBattleEquipmentDetailLayout.as:239`（经 `EquipmentAbilityLogic` 转发）、图鉴详情 `DialogGeneralEquipmentDetailView.as:267` |
| `AbilitySoulAbilityLogic/getDescriptionWithoutAdditional(param1)` | 7494 | 38 | `[3,3,1,2]` → `[3,6,1,2]` | 「觉醒最大」那一行 `DialogGeneralEquipmentDetailView.as:313`、`DialogBattleEquipmentDetailLayout.as:287`（只在觉醒未满时显示） |
| `EquipmentEnhancementAbilityLogic/getAllDescriptionsToMapForDialog` | 7700 | 77 | `[6,26,1,2]` → `[6,31,1,2]` | 强化能力弹窗 `DialogEquipmentEnhancementAbilityView.as:86`、强化结果弹窗 `EquipmentEnhancementResultDialog.as:73/90` |

- 方法锁（sha 和 header）见 `baseline.json`。这三个方法体在 1047 和 equipment-rules 里逐字节相同，equipment-rules 没有动过它们。
- 常量池只追加 3 个字符串：`desc_override_equipment_`、`desc_override_equipment_enhancement_`、`_final`。
  多名、int 都是 0 个。`"\n"`、两个 UI 分隔符键和全部多名都复用已有条目（kyubi V14 用的也是同一批）。
- maxstack 和作用域深度都不变。新局部变量从原 localcount 起编号，原方法体一个也读不到。
- 其余 92565 个方法体逐字节不变，包括 equipment-rules 的 4 个方法体和 6 个 `wf*` 方法、battle-rules 的全部锁定体和追加体，以及 kyubi 的 4 个面板覆盖体。
  方法、实例、类、脚本、元数据表也都不变，SWF 里 ABC 以外的标签同样不变。

### 前缀做了什么（三个方法同形）

```
key   = prefix + this.id
table = this.logicAssets.getMasterTableMaybe(CustomAbilityStringTable)   // 不抛异常；绝不调用 getMasterTable
if (!table) → 原方法体
row   = table.get_data().getMaybe(key)                                    // 缺行返回 null
if (!row || !row.string) → 原方法体                                       // null 与 "" 都落空
```

- **本体说明**：命中时返回 `text.split("\n")`，由对话框用 `getLineSpacingString(10)` 拼接。
- **最大行**：命中时用 `logicAssets.getUiString(param1 ? "ability_description_delimiter_newline" : "ability_description_delimiter")` 把各行拼回一串，
  取法与 `AbilityGroupingDescriptionGenerator.stringfy` 相同。
- **强化块**：成长键是开关，命中时返回两级 IntMap：`{0: {1: 成长行}, 1: {this.maxLevel: 满级行}}`。
  - 满级键缺失、为空或为 null 时，只返回块 0。只有满级键、没有成长键时，走原生。
  - `maxLevel` 从对象读（PARADOX 为 `equipment_enhancement` c0 = 120），不写死。
  - 前缀在 IntMap 迭代、排序闭包和 ClientError 2324 检查**之前**返回。
- 简易模式的 `SkillReplaceStringTable` 替换**不做**：覆盖文案就是作者的最终措辞，这样前缀里也不需要循环。

### 强化弹窗里的效果（真实 `viewableFilter` 字节码实测）

| 强化等级 | 块 0（标「强化Lv1」） | 块 1（标「强化Lv120」） |
|---|---|---|
| 0 | 未习得（灰） | 未习得（灰） |
| 1–119 | 已习得：成长文案 | 未习得（灰）：满级文案 |
| 120 | 已习得：成长文案 | 已习得：满级文案（结果弹窗的已习得块数由 1 变 2，与原生相同） |

覆盖是静态文本。原生成长行会显示按当前等级算出的实时数值，覆盖后改为作者写的 Lv119 数值。

## 键契约与能力

| 键（`custom_ability_string`，值 `[[text]]`） | 作用 |
|---|---|
| `desc_override_equipment_<装备id>` | 本体说明，`"\n"` 分行 |
| `desc_override_equipment_enhancement_<装备id>` | 强化成长块（开关键） |
| `desc_override_equipment_enhancement_<装备id>_final` | 强化满级块（可缺） |

- 武器的 `AbilitySoulAbilityLogic.id` 是 `ability_soul_id`，强化能力的 `id` 是装备 id（见 `EquipmentEnhancementLogic.getAbility:244`）。
  数据门禁必须保证覆盖键对应装备的 `ability_soul_id == 装备 id`（PARADOX 的 c10 = 5920001，已在 live 核对）。
- 分档 id 5921001、5922001、5923001 只在战斗装配里出现，走的是 `getTriggers` 和 `getDescription(false)`，都没打补丁。
  门禁同样禁止给分档 id 写覆盖键。
- 同一件魂放进魂珠槽时，显示同一段本体文案。
- 能力：`equipment-description-override-v1`，惰性、只作提示，与 `panel-description-override-v2` 同类。
  没打本补丁的客户端根本不读这些行，显示原生生成的文案，也不会崩溃，所以**数据可以先于 APK 发布**。
  能力名在 `rules.CAPABILITY` 和 `mod-tools/wf_client_legality.EQUIPMENT_DESC_OVERRIDE` 各定义一次，测试会比对两者。
- 命名空间：kyubi V14 的探针是 `"desc_override_" + string_id`。所以如果某条词条或队长技的 `string_id` 以 `equipment_` 开头，就会撞进本命名空间，门禁应该拒绝。

## 刻意不覆盖的出口（v1）

- `EquipmentAbilityLogic.getDescriptionWithSimplify` / `getDescription(false)`，以及魂珠和无强化路径上的 `AbilitySoulAbilityLogic.getDescriptionWithSimplify`。
  它们用在编成武器选择列表的详情面板（`EquipmentSelectDetailPanelView.as:190`）、持有装备和魂的文字搜索，以及战斗装配的 `abilityDescription`。
  - 不覆盖的原因：这里的文案随强化等级变化（本体 / +成长 / +满级），而且这些路径也跑在战斗装配和搜索里，超出了本次需求的范围。
  - 这些地方保持原生全文，搜索也继续按原生措辞匹配。
  - 如果要做 v2：在体 7663 上做单方法前缀，按强化等级拼接本体、成长和满级文案，约 80 条，同样放行不崩。
- 三个 `getDiffDescription`：用在强化滑块预览、对比视图（`DialogAbilityDescriptionVariationView`）和批量强化列表。静态文本表达不了「前→后」，所以保持原生的差分文字。
- `AbilitySoulAbilityLogic.getSlotDescriptionsForDialog`：PARADOX 的每一行魂都是 `learn_level 1`，`hasAwakeningAbility()` 为 false，不会走到这里。
- 绕过描述方法、直接按触发生成文字的几处（`PartyRibbonSummarizer`、「发动可能能力」弹窗、`AbilityDisabledReasonResolver`）保持原生。

## 用法

```powershell
# 1) 检查基线（只认 equipment-rules 主 ABC d99246d9…）
python -X utf8 client-patch/equipment-description-override/apply_equipment_description_override.py --input "<e03bc22b.apk>" --check
# 2) 生成 SWF：输出目录必须是新的；同时写出 patch-report、verify-report（含负对照与变异体）、prepare-report
python -X utf8 client-patch/equipment-description-override/apply_equipment_description_override.py --input "<e03bc22b.apk>" --output-dir "<新目录>"
# 3) 独立核验（apply 已执行一次，可以复跑）
python -X utf8 client-patch/equipment-description-override/verify.py "<新目录>/equipment-description-override.swf" --base "<新目录>/baseline.swf"
# 4) 打包签名：口令只经环境变量传递，本目录的脚本不读取、不打印、不保存口令
python -X utf8 client-patch/equipment-description-override/package_apk.py --base "<e03bc22b.apk>" `
  --swf "<新目录>/equipment-description-override.swf" --patch-report "<新目录>/patch-report.json" `
  --output "<新.apk>" --work "<新 work 目录>" `
  --zipalign "<build-tools>/34.0.0/zipalign.exe" --apksigner "<build-tools>/34.0.0/apksigner.bat" `
  --keystore "弹国服/instrument/wf_new.keystore" --ks-pass-env WF_BATTLE_KS_PASSWORD --key-pass-env WF_BATTLE_KEY_PASSWORD
```

- `package_apk.py` 先拒绝几类不匹配：补丁报告不是本补丁、ABC 不是锁定目标、SWF 与报告不符、底包里的 SWF 不是当初打补丁的那份。
- 然后调用 `battle-rules/build_apk.py`，它会核对原签名证书、所有非 SWF 成员和压缩方式都不变。
- 最后回读 APK 里的主 ABC，并把 `candidate_capabilities` 改为「equipment-rules 的 9 项 + `equipment-description-override-v1`」。

## 验证

测试：`client-patch/tests/test_equipment_description_override.py`，需要本机的 equipment-rules SWF 夹具。

```powershell
python -X utf8 -m unittest client-patch/tests/test_equipment_description_override.py -v
```

- **结构**
  - 只有 3 个锁定体改变，插入段都能还原出锁定 sha，header 与设计值一致，产物 ABC 等于锁定目标，可以复现。
  - 常量池只多 3 个字符串。重复打补丁会被拒绝。
- **静态隔离证明**（`verify.static_proof`）
  - 插入段只写新局部，只读 `this`、参数和新局部。
  - 调用只在白名单里：`getMasterTableMaybe`、`get_data`、`getMaybe`、`split`、`getUiString`、`join`，不含 `getMasterTable`。
  - 分支只在段内跳转，或跳到原生入口；段外没有分支跳进段内。
  - 到达原生入口时栈为空（接 `pop` 必然下溢），原生部分可以逐字节还原。
- **行为矩阵**（整方法执行真实字节码）：20 个场景 × 4 个出口 = 80 项，其中 32 项是命中。
  - 命中形状、满级缺失或为空或为 null 时只有块 0、`maxLevel` 取自对象、原生数据会抛 2324 时照常显示覆盖。
  - 放行项全部等于原生结果：分档 id、官方 id、表未加载、缺行、空串、null、V2 命名空间的键、只有满级键。
  - 探针只按 id 拼键；假容器的 `getMasterTable` 一旦被调用就报错。
- **截断执行**：切到插入段末尾接哨兵，每个未命中都到达原生第一条指令。
- **消费链**：用真实的 `EquipmentAbilityLogic` 转发、`getSlotDescriptionsForDialog` 和 `viewableFilter`，在 Lv0/1/119/120 下得到上表的效果。
- **负对照**
  - 未打补丁的基线上，80 项全部是原生结果，从不访问 `custom_ability_string`，消费链也是原生结果。
  - 两个变异体在 32 个命中项上全部变红：把 `returnvalue` 换成 `pop`，或把前缀写成 `desc_override_`。
- 解释器是 `desc_interp.py`：以私有模块名导入 `equipment-rules/avm_interp.py`（不改它）并继承。
  补上了原生体会用到的 String/Array 内建、int 键、`in` 和 `newfunction`（排序比较器执行真实闭包体）。

## 产物（2026-09-28，只构建）

`D:\WF\out\PARADOX-20260928\apk\desc-override-20260928\`：`build.py`、`swf/`（baseline、候选、三份报告）、
`WorldFlipper-equipment-description-override.apk` 与 `.build-report.json`、`build-summary.json`。

- APK `cf91b29b3d944fed2574efb709669598d6c90641e13ee30e348e9ed5bb5d08e6`
- SWF `cdc4c1d1fea3080e2974a1417e5179537c9e460e3ce6c13068676921ab410a44`
- ABC `4994e23d612c24a7c13072bf641b9b11ca0aa2e36561cb3d521bda16e325c38b`
- 证书 `729507c10a893879b14f46cf81d8e5052d4b66c2c081fa5b9f915a142a827a0b`，与 e03bc22b 相同
- 保留的非 SWF 成员 4176 个，逐字节相同，压缩方式也相同

## 安装（须作者当次授权；本目录不做）

1. `kill -9` 结束进程；
2. `pm install -r`；
3. `rm -rf /data/data/com.leiting.wf/cache/app`，并确认目录已不存在；
4. 启动游戏；
5. 回读缓存里 SWF 的 sha，应等于产物 SWF。

`Local Store` 不要动。回滚：重装 e03bc22b，再清一次 `cache/app`。
