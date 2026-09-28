# 装备强化外观（equipment-enhanced-look）

PARADOX（装备 5920001）强化到 200 级时要换一套外观：Lv1–119 基础图标，Lv120–199 lv120 图标 + 粉框，
Lv200 lv200 图标 + 蓝金框。数据做不到两件事，本补丁补上：

1. **第二图标档**：强化主表的图标只有一个切换档（`pixelart0` 的等级与路径）。
2. **单件换框**：粉框是全局图集里的一张贴图，表里没有「框」这一列。

补丁只做**单方法指令插入**：用 battle-rules 的 `core.Editor`，加本目录自己的方法锁（`baseline.json`：体下标、sha256、header），
不走 FFDec、不回编 AS3（FFDec 整类回编在真机上不等价，见记忆卡 wf-random-floor-ffdec-blocked）。
锁不符就拒绝，**没有任何自动降级或兜底**。
本目录只产出候选 SWF 和 APK。静态检查、解释器行为测试和 APK 验签都**不等于**已经安装，也不等于实机通过。

## 构建链

| 环节 | APK | 主 SWF 容器 | 主 ABC |
|---|---|---|---|
| equipment-rules | `e03bc22b…` | `6989d31a…` | `d99246d9…` |
| equipment-description-override（已装在作者 MuMu 上） | `cf91b29b3d944fed…` | `cdc4c1d1fea3080e…` | `4994e23d612c24a7…` |
| **本补丁** | 见下方「产物」 | `45ca9985a896b644…` | `e87371b709c41b66…` |

- 基线按**主 ABC** `4994e23d…` 判定；容器哈希只作参考（同一份 ABC 可能被重新压成 CWS）。其他基线一律拒绝，已打过本补丁的输入报告 `already_patched`。
- 两个被改方法体在 1047（ABC `d9559f3f…`）、equipment-rules（`d99246d9…`）和说明覆盖（`4994e23d…`）里**逐字节相同、体下标相同**（测试核对）。
  但 apply 只认说明覆盖这一个主 ABC：候选 APK 的能力声明是「说明覆盖 10 项 + 本补丁 1 项」，换底包会让声明失真。
- 签名证书 `729507c10a893879…` 与 cf91b29b 相同，候选 APK 可以 `pm install -r` 覆盖安装。

## 补丁面

| 方法 | 体 | 插入点 | 条数 | header 前 → 后 | 常量池 |
|---|---:|---|---:|---|---|
| `EquipmentEnhancementLogic/getPixelart(level)` | 18609 | #27：原方法「达到 pixelart0 等级、即将返回 `Some(pixelart0.value)`」分支的入口 | 67 | `[2,4,1,2]` → `[2,12,1,2]` | `enhanced_pixelart_tier2_` |
| `ItemThumbnailView/setRarity(rarity, enhanced)` | 85197 | #29：方法唯一的 `returnvoid` 之前（原生 `frame.setRarity` 已执行完） | 66 | `[3,4,1,2]` → `[3,13,1,2]` | `enhanced_frame_override_` |

- 两处插入都用 FORBID 策略：原方法体里没有任何分支指向插入点。插入点处栈为空、作用域不变，maxstack 不变。
- 常量池只追加 2 个字符串；`","` 与全部多名（`getMasterTableMaybe`、`GlobalLogicForSection::getLogicAssets`、`hideRarity`、`replaceBackgroundImage` 等）复用已有条目。
- 新局部变量从原 localcount 起编号，原方法体一个也读不到。插入段只读 `this`、参数（和 getPixelart 的 `_loc3_ = pixelart0`），不写任何属性。
- 其余 92566 个方法体逐字节不变，包括说明覆盖的 3 个体、equipment-rules 的 4 个体和 6 个 `wf*` 方法、battle-rules 的全部锁定体和追加体、kyubi 的 4 个面板覆盖体。
  方法、实例、类、脚本、元数据表也都不变，SWF 里 ABC 以外的标签同样不变。
- 取表只用 `ILogicAssetContainer.getMasterTableMaybe`（表没加载返回 null）+ `MasterMap.getMaybe`（缺行返回 null），**绝不**调用会抛 8013/8014 的 `getMasterTable`。

### 第二图标档（getPixelart）

原方法只有一个图标档：`level >= pixelart0.level` 返回 `Some(pixelart0.value)`，否则 `None`（调用方用装备本体图标）。
插入段只在原方法**已经要返回 Some** 的那条分支上运行，逻辑等价于「原方法给出 Some(path0) 之后再改写」：

```
path0 = pixelart0.value;                 若为空 → 原生
row   = logicAssets.getMasterTableMaybe(CustomAbilityStringTable)?.get_data().getMaybe("enhanced_pixelart_tier2_" + path0)
text  = row?.string;                     null / "" → 原生
parts = text.split(",");                 不是恰好两段 → 原生
s = parts[0]; path = parts[1];           path 为空 → 原生
String(int(s)) !== s                     → 原生（拒绝空串、小数、前导 0/空白/+、指数、十六进制、int 溢出回绕）
level < int(s)                           → 原生
return Some(path)
```

唯一消费方是 `GeneralEquipmentLogic.getPixelArtPathWithEnhancement`（`BattleEquipmentLogic.get_pixelArtPath` 转发），
约 30 处视图都跟着变，包括编成装备槽（`PartyItemThumbnailView.replaceEquipment` 也走 `get_pixelArtPath`）。

### 强化框覆盖（ItemThumbnailView.setRarity）

```
原方法：rarity 选帧 → frame.setRarity(rarity, enhanced)      // 粉框、frame.rarity、关 background 容器照旧
插入段：enhanced 为假 → 结束
        itemImagePath 不是 Some(path) 或 path 为空 → 结束
        view / view.asset / asset.globalLogic / getLogicAssets() / 表 任一为 null → 结束
        text = 表.getMaybe("enhanced_frame_override_" + path)?.string;  null / "" → 结束
        hideRarity(); replaceBackgroundImage(text)            // 与称号缩略图（showAnyThumbnail case 11）同一通路
```

- 蓝金底按原尺寸显示（144×144 不透明 PNG，居中），在 rarity 层下方的 background 层；物品图标和白色扫光（background_effect 层）照常在上面。
- **格子复用**：原生 `ThumbnailFrameView.setRarity` 每次都会重新打开 rarity 层并关闭 background 层，所以同一格换成别的装备时粉框恢复。
  蓝金贴图若在复用之后才加载完成，`backgroundTextureLoadCompleted` 只会给已关闭的 background 层换贴图，不会重新显示（测试逐步复现）。
- 其他以 `enhanced=true` 调 setRarity 的地方（通行证奖励 `PassFeaturedRewardView` / `PassCardListCellContentView`）只会多查一次不存在的键，结果不变。

## 键与值（`custom_ability_string`，一列表 `string`）

| 键 | 值 | 效果 |
|---|---|---|
| `enhanced_pixelart_tier2_<pixelart0 图标路径>` | `"<等级>,<图标路径>"` | 强化等级 ≥ 等级时改用该图标 |
| `enhanced_frame_override_<正在显示的图标路径>` | `<背景图路径>` | 强化态时隐藏粉框、改显示该背景图 |

PARADOX 用到的两行：

```
enhanced_pixelart_tier2_item/equipment/mod/paradox/paradox_lv120  →  200,item/equipment/mod/paradox/paradox_lv200
enhanced_frame_override_item/equipment/mod/paradox/paradox_lv200  →  item/equipment/mod/paradox/paradox_frame_bluegold
```

- **逗号能保留**：客户端按 `MasterBinarySlice.getRow()` → `format.csv.Reader.parseUtf8Bytes` 读行，这是带引号的标准 CSV
  （引号内的逗号、换行都保留，`""` 还原成 `"`），`string = row[0]`。所以值 `200,item/…` 写表时这一格必须带引号：
  `mod-tools` 的 `write_csv_lines`（`csv.writer`，QUOTE_MINIMAL）会自动加。**没加引号**的话客户端只读到 `200` 一格，
  第二档静默不生效（不崩）。`verify.client_parse_csv` 是 Reader 的逐状态移植，测试在 live 表全部 556 行（含 106 个带引号的多行格）上与 Python csv 逐行一致。
- 键尾是**图标路径本身**：换框按「正在显示的图标」判定，所以 lv200 图标路径不能被别的装备复用，否则它们在强化态也会换成蓝金框。
- 值指向的 PNG 必须随同一条发布边下发（lv200 图标 20×20；蓝金框 144×144 不透明）。缺图 = 客户端取图失败。
- 数据门禁：`mod-tools/wf_client_legality.py` 的 `enhanced_look_capability` / `enhanced_look_problems`，`wf_midautumn_verify` 的
  `cas/equipment-enhanced-look-shape`（一行一格、键尾是路径、第二档值为 `<1–999999999>,<路径>`），`wfx_registry.json` 的 capability 与 `string_keys`。

能力：`equipment-enhanced-look-v1`，行为型（cosmetic）。没打本补丁的客户端根本不读这些行，显示原图标与粉框，不崩溃，**数据可以先于 APK 发布**。

## 不覆盖（v1）

- **编成装备槽**（`PartyItemThumbnailView`）：v1 只让图标跟着第二档变，框仍是粉框（作者 0928 真机确认）。
  那个布局（`common_ui/item_thumbnail` 的 `party_equipment_thumbnail`）没有 background 容器，`setRarity` 只做
  `rarity.goto(帧号)`、拿不到图标路径。**已由叠在本补丁之上的 `client-patch/equipment-enhanced-party-frame/` 补上**
  （宿主 `updateEnhancedEffectAnimation`，键 `enhanced_party_frame_override_<图标路径>`，独立能力 `equipment-enhanced-party-frame-v1`）。
  本目录不改。
- 不经过 `ItemThumbnailView.setRarity` 的其他缩略图组件保持原生外观（第二图标档仍然生效，因为它在数据层）。

## 用法（换一个 APK 时照做）

```powershell
# 1) 检查基线（只认说明覆盖主 ABC 4994e23d…；两个方法锁不符也拒绝）
python -X utf8 client-patch/equipment-enhanced-look/apply_equipment_enhanced_look.py --input "<cf91b29b.apk>" --check
# 2) 生成 SWF：输出目录必须是新的；同时写出 patch-report、verify-report（含负对照与变异体）、prepare-report
python -X utf8 client-patch/equipment-enhanced-look/apply_equipment_enhanced_look.py --input "<cf91b29b.apk>" --output-dir "<新目录>"
# 3) 独立核验（apply 已执行一次，可以复跑）
python -X utf8 client-patch/equipment-enhanced-look/verify.py "<新目录>/equipment-enhanced-look.swf" --base "<新目录>/baseline.swf"
# 4) 打包签名：口令只经环境变量传递，本目录的脚本不读取、不打印、不保存口令
python -X utf8 client-patch/equipment-enhanced-look/package_apk.py --base "<cf91b29b.apk>" `
  --swf "<新目录>/equipment-enhanced-look.swf" --patch-report "<新目录>/patch-report.json" `
  --output "<新.apk>" --work "<新 work 目录>" `
  --zipalign "<build-tools>/34.0.0/zipalign.exe" --apksigner "<build-tools>/34.0.0/apksigner.bat" `
  --keystore "弹国服/instrument/wf_new.keystore" --ks-pass-env WF_BATTLE_KS_PASSWORD --key-pass-env WF_BATTLE_KEY_PASSWORD
```

**别的 APK**（例如灰方或别的分支）：先 `--check`。主 ABC 不是 `4994e23d…` 就会拒绝——这是有意的，补丁没有兜底路径。
要移植到别的底包，正确做法是：确认两个目标方法体在那份 ABC 里的 sha256 与 header 仍等于 `baseline.json`
（按「类名/方法名」定位，体下标可以不同），再把 `overlay.BASE_ABC_SHA`、`apply/package` 的目标哈希和能力声明改成那个底包的，
重跑 apply → verify（行为矩阵、负对照、变异体必须全绿）→ package。方法体 sha 不同就不能套用，只能对照新字节码重新定锚点。

`package_apk.py` 先拒绝几类不匹配：补丁报告不是本补丁、ABC 不是锁定目标、SWF 与报告不符、底包里的 SWF 不是当初打补丁的那份、
底包不是已装的 cf91b29b（除非 `--allow-foreign-base`）；再调用 `battle-rules/build_apk.py`（核对原签名证书、所有非 SWF 成员和压缩方式都不变）；
最后回读 APK 里的主 ABC，并把 `candidate_capabilities` 改为「说明覆盖的 10 项 + `equipment-enhanced-look-v1`」。

## 验证

测试：`client-patch/tests/test_equipment_enhanced_look.py`，需要本机的说明覆盖 SWF 夹具。

```powershell
python -X utf8 -m unittest client-patch/tests/test_equipment_enhanced_look.py -v
```

- **结构**：只有 2 个锁定体改变，插入段都能还原出锁定 sha，header 与设计值一致，产物 ABC 等于锁定目标、可以复现；常量池只多 2 个字符串；
  重复打补丁、方法体被改过（header 或字节不符）都拒绝。
- **静态隔离证明**（`verify.static_proof`）：只写新局部；只读允许的寄存器；调用白名单（不含 `getMasterTable`）；分支只在段内或跳到原生入口；
  段外没有分支跳进段内；原生入口处栈为空（插一条 `pop` 必然下溢，探针本身有正反对照）。
- **图标矩阵**（真实字节码）：28 个场景 × 10 个等级 × 2 个出口（getPixelart / getPixelArtPathWithEnhancement）= 560 项，其中 46 项命中。
  命中、第二档等级边界、键缺失、空串、null、16 种畸形值（无逗号、空等级、空路径、非整数、小数、`200.0`、前导 0、`+`、空白、指数、十六进制、int 溢出回绕、Infinity、三段、分号）、
  别的图标的键、换框键、表未加载、logicAssets 为 null、没有强化行。
- **强化框矩阵**（真实字节码，一格缩略图按步骤复用，贴图异步回调由测试决定何时到达）：17 个场景，其中 4 项命中。
  命中、贴图未到、lv120 图标保持粉框、键缺失、空串、null、表未加载、非强化态、itemImagePath 为 None、view 为 null、
  复用（蓝金 → 别的强化装备、贴图晚于复用到达、蓝金 → lv120、蓝金 → 普通道具、别的 → 蓝金、两次往返）、通行证奖励石头。
- **截断执行**：只跑插入段（切片接哨兵），240 项全部按预期到达原生入口或给出命中结果。
- **负对照**：未打补丁的基线上 577 项全部是原生结果，从不访问 `custom_ability_string`。
  7 个变异体全部让断言变红：删掉 `enhanced` 条件（恰好 `not_enhanced` 一项变红）、删掉空串判定、删掉等级条件、删掉规范整数判定、
  删掉「恰好两段」、删掉返回、两个前缀互换。
- 解释器是 `look_interp.py`：以私有模块名重新执行 `equipment-description-override/desc_interp.py`（不改它，也不影响先例测试加载的模块对象），
  只在私有副本上把字符串转 int 换成 AS3 语义（`Number(String)` + ToInt32），并补 Array `indexOf`。

## 产物（2026-09-28，只构建）

`D:\WF\out\PARADOX-20260928\apk\enhanced-look-20260928\`：`build.py`、`swf/`（baseline、候选、三份报告）、
`WorldFlipper-equipment-enhanced-look.apk` 与 `.build-report.json`、`build-summary.json`、`install-receipt.template.json`。
哈希见 `build-summary.json`。

## 安装（须作者当次授权或常设授权；本目录不做）

1. `kill -9` 结束进程（作者正在对局时等对局结束）；
2. `pm install -r`；
3. `rm -rf /data/data/com.leiting.wf/cache/app`，并确认目录已不存在；
4. 启动游戏；
5. 回读缓存里 SWF 的 sha，应等于产物 SWF。

`Local Store` 不要动。回滚：重装 cf91b29b，再清一次 `cache/app`。装好后按 build-summary 的 `candidate_capabilities` 更新
`mod-tools/client_profiles.json` 的 local-mumu 档案（并同步 `test_wfx_registry` 里钉住 cf91b29b 的档案测试）。
