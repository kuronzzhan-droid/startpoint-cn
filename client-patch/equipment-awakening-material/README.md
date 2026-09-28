# 觉醒专属素材（equipment-awakening-material）

作者 0928 口径：29 把诅咒武器（5910101–5910129）与 PARADOX（5920001）**只能用重复本体或「禁忌星铁」10000311 觉醒**。
客户端给「用道具觉醒」挑道具时只看装备稀有度、不看装备 ID（`OwnedItemRepository.getEquipmentAwakingCrystal(rarity)`），
只改数据做不到「这 30 把不提供星铁钢、别的 ★5 不提供禁忌星铁」。本补丁在客户端唯一的挑道具入口
`OwnedEquipmentLogic.getUseableAwakingCrystal` 前插一段按装备 ID 查表的逻辑。设计稿：
`D:\WF\out\武器觉醒与新掉落-20260928\设计.md` §2.3–§2.5、§8.1。

- 只做**单方法指令插入**：battle-rules 的 `core.Editor` + 本目录自己的方法锁（`baseline.json`）。不走 FFDec、不回编 AS3。
- 锁不符就拒绝，**没有任何自动降级或兜底**。
- 本目录只产出候选 SWF 和 APK。静态检查、解释器行为测试和 APK 验签都**不等于**已经安装，也不等于实机通过。

## 构建链

| 环节 | APK | 主 SWF 容器 | 主 ABC |
|---|---|---|---|
| equipment-enhanced-look | `7056f7dc…` | `45ca9985…` | `e87371b7…` |
| equipment-enhanced-party-frame a 版（已装在作者 MuMu 上，有「武器图标会消失」缺陷，**作废**） | `14396ce09a4cf236…` | `9986dea39831608e…` | `016cd9270a5b9c0d…` |
| equipment-enhanced-party-frame **b 版**（本补丁的底包；候选，未安装） | `2f085757e4647762…` | `5bd476f6effd1452…` | `2a9583cddd477868…` |
| **本补丁**（候选，未安装） | 与置顶补丁叠成一个 APK，见下 | `15c8cba8eb86c8e8…` | `22292c21361fa505…` |
| equipment-sort-pin（叠在本补丁上） | 候选 APK 见 `D:\WF\out\weapon-client-patches-20260928b\build-summary.json` | `52faeeb7…` | `c39746e0…` |

- 基线按**主 ABC** `2a9583cd…`（编成槽框 b 版）判定；容器哈希只作参考。其他基线一律拒绝，已打过本补丁的输入报告 `already_patched`。
- 编成槽框 a 版（`016cd927…`，APK 14396ce0）和在它上面打出的本补丁旧产物（`07bc8022…`，旧候选 APK `8d4e8583` 的那一层）
  报 `Superseded SWF baseline` 拒绝：a 版的 `setItemImage` 仍会 dispose 共享图标贴图，装它等于回退 b 版的修复。
- 被改方法体在 1047（`d9559f3f…`）、equipment-rules（`d99246d9…`）、说明覆盖（`4994e23d…`）、v1（`e87371b7…`）、
  编成槽框 a 版（`016cd927…`）、b 版（`2a9583cd…`）里**逐字节相同、体下标相同**（测试核对）。但 apply 只认 `2a9583cd` 这一个主 ABC：
  能力声明是「编成槽框的 12 项 + 本补丁 1 项」（a / b 两版声明的 12 项相同）。
- 设计稿按 v1（`e87371b7`）静态读到的 body 19792 / header `[2,5,1,2]` / 127 字节 / sha 前缀 `4a0f7a7f`，
  在 `2a9583cd` 上构建时**已重新核对，完全一致**（`baseline.json`）。
- 签名证书 `729507c10a893879…` 与本机已装的 14396ce0、b 版 2f085757 相同，候选 APK 可以 `pm install -r` 覆盖安装。

## 补丁面

| 方法 | 体 | 插入点 | 策略 | 条数 | header 前 → 后 | 常量池 |
|---|---:|---|---|---:|---|---|
| `OwnedEquipmentLogic/getUseableAwakingCrystal(repo, time)` | 19792 | #12：`hasStack()` 为假时 `iffalse` 的落点、原生 `getlocal_1; findproperty get_rarity` 之前 | ENTER | 76 | `[2,5,1,2]` → `[2,14,1,2]` | `awakening_material_` |

- 方法锁 sha `4a0f7a7fdb0c5ffe42ecbff40c6cce0eb65d2475ce98a899a08e48f1516ec096`，没有 activation、异常表、体内 trait。
- **ENTER 策略**：#12 是分支目标，指向它的原有分支恰好只有 #8（`hasStack()` 的 `iffalse`，`find_anchor` 钉死）。
  ENTER 让这条分支落到插入段开头，所以「没有重复本体」的每一条路径都先经过插入段；`hasStack()` 为真的路径
  （#9 返回 None，优先用重复本体）完全不经过插入段。插入段里跳到 `NATIVE` 的出口都落到原生 #12。
- 常量池只追加 1 个字符串（前缀）；`CustomAbilityStringTable`、`ItemTable`、`getMasterTableMaybe`、`getMaybe`、`get_data`、
  `string`、`logicAssets`、`id`、`get`、`number`、`isAvailable`、`Option.Some/None` 全部复用 ABC 里已有的多名。
- 新局部从原 localcount 5 起编号（5–13），原方法体一个也读不到。插入段只读 `this` / `repo` / `time`，没有属性写、没有无返回值调用。
- 其余 92567 个方法体逐字节不变（含编成槽框、v1 与它们登记的整条叠加链），方法 / 实例 / 类 / 脚本 / 元数据表与 ABC 以外的 SWF 标签都不变。

### 插入段

```
key = "awakening_material_" + this.id                      // this.id 是 int：键尾是规范十进制串
tbl = this.logicAssets?.getMasterTableMaybe(CustomAbilityStringTable)      // 绝不 getMasterTable
row = tbl?.get_data().getMaybe(key)
表 / 行为 null                                        → 原生 #12（按稀有度挑星铁钢，原逻辑一字不改）
// ---- 行存在 = 这件装备受限：从这里起永远不回落原生（回落原生就是提供星铁钢） ----
text = row.string; id = int(text)
String(id) !== text 或 id <= 0                        → return None     // 空串 / null / +1 / 010 / 1e3 / 小数 / 十六进制 / 溢出
repo 为 null、repo.logicAssets.getMasterTableMaybe(ItemTable) 为 null、道具表没有 id 这一行 → return None
item = repo.get(id)                                   // = new OwnedItemLogic(id, repo.logicAssets, 持有数)
item.number > 0 且 item.isAvailable(time)             → return Some(item)
否则                                                  → return None
```

- **fail-closed**：与外观补丁不同，值非法时这里返回 None 而不是回落原生——回落原生就是提供星铁钢，违背需求。
- **表没加载 = 原生**：`custom_ability_string` 缺表时（实际不会发生）官方装备照旧能觉醒；受限装备这时会被提供星铁钢，
  服务端白名单返回 400。道具表缺表时受限装备返回 None（fail-closed）。
- **道具行前置检查**：`repo.get(id)` 的构造 `ItemLogic(id, …)` 先取 `ItemTable.get(id)`，缺行是 null，随后读
  `values.select_bonus_id` 出错。所以先用 `repo.logicAssets`（就是 `repo.get` 用的同一个容器）上的
  `getMasterTableMaybe(ItemTable).get_data().getMaybe(id)` 确认有行。变异体「删道具行判定」会在值指向不存在的道具时抛错。
- **只执行数据**：值写成星铁钢 12002 时补丁照样提供它（场景 `value_names_official_crystal`）。「值必须指向存在且 c6≠6 的道具」
  由构建器 `mod-tools/wf_weapon_awaken.py`（边 E2）门禁保证，禁忌星铁本身 c6=1、不会被原生逻辑提供给别的 ★5。
- 对话框、确认复选框「使用::item_name::」、`yesHandler` 与 `EquipmentUpgradeRealRemote`（`use_stack=false` + `item_id`）
  对道具是通用处理，不用改（设计稿 §2.1）。

## 键与值（`custom_ability_string`，一列表 `string`）

| 键 | 值 | 效果 |
|---|---|---|
| `awakening_material_<装备ID>` | `<道具ID>`（规范十进制正整数） | 没有重复本体时只提供这个道具；缺货 / 过期 / 值坏 → 不提供任何道具 |

- 30 行 `awakening_material_5910101` … `awakening_material_5910129`、`awakening_material_5920001`，值都是 `10000311`，
  由 `mod-tools/wf_weapon_awaken.py`（`cas_rows()`，边 E2）产出，服务端 `assets/equipment_awakening_material.json`
  的 `materialByEquipment` 与它同源。PARADOX 的衰减分档键 5921001–5923001 **不加**（持有与觉醒的装备始终是 5920001）。
- 数据门禁：`mod-tools/wf_client_legality.py` 的 `EQUIPMENT_KEY_PREFIX_CAPABILITIES` / `equipment_key_capability` /
  `equipment_key_problems`（键尾与值都是规范十进制正整数 1–999999999），`wf_midautumn_verify` 的
  `cas/equipment-behaviour-key-shape`，`wfx_registry.json` 的 capability 与 `string_keys`。

能力：`equipment-awakening-material-v1`，**semantic（静默失效）**。没打补丁的客户端不读这些行：受限装备重复数为 0 时仍按稀有度提供
星铁钢，服务端白名单（`src/lib/equipment-awakening-rules.ts`）返回 400。WFX 发布门禁因此**拒绝**把 `awakening_material_*`
发给档案里没有这项能力的接收端——本机 MuMu 要先装本 APK、按安装回执把 local-mumu 档案改成 14 项，边 E2 才能发（设计稿 §7 第 5 步
与第 4 步的先后要对调，或者 E2 先不带这 30 行）。灰服 / 分享包 / 官方档案一律拒绝。

## 用法（换一个 APK 时照做）

```powershell
# 1) 检查基线（只认编成槽框主 ABC 2a9583cd…；方法锁不符也拒绝）
python -X utf8 client-patch/equipment-awakening-material/apply_equipment_awakening_material.py --input "<2f085757.apk>" --check
# 2) 生成 SWF：输出目录必须是新的；同时写出 patch-report、verify-report（含负对照与变异体）、prepare-report
python -X utf8 client-patch/equipment-awakening-material/apply_equipment_awakening_material.py --input "<2f085757.apk>" --output-dir "<新目录>"
# 3) 独立核验（apply 已执行一次，可以复跑）
python -X utf8 client-patch/equipment-awakening-material/verify.py "<新目录>/equipment-awakening-material.swf" --base "<新目录>/baseline.swf"
# 4a) 只打本补丁：打包签名（口令只经环境变量传递，本目录的脚本不读取、不打印、不保存口令）
python -X utf8 client-patch/equipment-awakening-material/package_apk.py --base "<2f085757.apk>" `
  --swf "<新目录>/equipment-awakening-material.swf" --patch-report "<新目录>/patch-report.json" `
  --output "<新.apk>" --work "<新 work 目录>" `
  --zipalign "<build-tools>/34.0.0/zipalign.exe" --apksigner "<build-tools>/34.0.0/apksigner.bat" `
  --keystore "弹国服/instrument/wf_new.keystore" --ks-pass-env WF_BATTLE_KS_PASSWORD --key-pass-env WF_BATTLE_KEY_PASSWORD
# 4b) 与置顶补丁叠成一个 APK（本次交付的做法）：先在本补丁产物上跑 equipment-sort-pin 的 apply，
#     再用 equipment-sort-pin/package_apk.py --stack-report "<新目录>/patch-report.json"
```

### 移植到别的底包

- 先 `--check`。主 ABC 不是 `2a9583cd…` 就会拒绝——这是有意的，补丁没有兜底路径。
- 编成槽框再出新版本（c 版等）时：本补丁的锁定方法体不在编成槽框的改动范围内，只要 `baseline.json` 仍对得上，
  就只需把 `overlay.BASE_ABC_SHA/BASE_SWF_SHA`、apply / package 的 `TARGET_*`、`package_apk.BASE_APK_SHA`、测试夹具路径
  和写死的哈希一起换掉，再把旧底包加进 `SUPERSEDED_ABC_SHAS`，重跑 apply → verify → package（置顶补丁同理）。
- 只装了编成槽框以前层（v1 / 说明覆盖 / equipment-rules / 1047 / 灰方）的底包：先按顺序补齐到编成槽框，再打本补丁；
  本补丁不单独适配更早的 ABC，因为能力声明「12 项 + 1」会失真。
- 真要移植：按「类名/方法名」定位 `OwnedEquipmentLogic/getUseableAwakingCrystal`，确认体 sha256 与 header 仍等于 `baseline.json`
  （体下标可以不同），再把 `overlay.BASE_ABC_SHA`、apply / package 的目标哈希和能力声明改成那个底包的，重跑 apply → verify
  （行为矩阵、负对照、变异体必须全绿）→ package。方法体 sha 不同就不能套用，只能对照新字节码重新定锚点。
- 还要复核三个前提：#8 仍是 `hasStack()` 的 `iffalse` 且是指向 #12 的唯一分支；#16 仍是 `getEquipmentAwakingCrystal`；
  客户端里「用道具觉醒」的判断（`openUpgradeOrGenerateDialog`、`upgradable()`、魂珠超上限确认）仍都经过这个方法
  （设计稿 §2.1，静态阅读结论）。多名全部按名字从 ABC 现取（`core.Editor.q` 要求唯一），有歧义或缺失会直接报错，不会猜。

`package_apk.py` 先拒绝几类不匹配：补丁报告不是本补丁、ABC 不是锁定目标、SWF 与报告不符、底包里的 SWF 不是当初打补丁的那份、
底包不是编成槽框 b 版 2f085757（除非 `--allow-foreign-base`）；再调用 `battle-rules/build_apk.py`（核对原签名证书、所有非 SWF 成员和压缩方式都不变）；
最后回读 APK 里的主 ABC，并把 `candidate_capabilities` 改为「编成槽框的 12 项 + `equipment-awakening-material-v1`」。

## 验证

测试：`client-patch/tests/test_equipment_awakening_material.py`，需要本机的编成槽框 b 版 SWF 夹具（`D:\WF\out\PARADOX-20260928\apk\enhanced-look-party-20260928b\swf\`）；
a 版夹具（`enhanced-look-party-20260928\swf\`）和旧 a 版链产物（`D:\WF\out\weapon-client-patches-20260928\swf\`）只用于「拒绝」测试，缺了就跳过。

```powershell
python -X utf8 -m unittest client-patch/tests/test_equipment_awakening_material.py -v
```

- **结构**：只有 1 个锁定体改变，插入段能还原出锁定 sha，ENTER 后 #8 指向插入段开头、原生 #12 挪到段后；header 与设计值一致，
  产物 ABC 等于锁定目标、可以复现；常量池只多 1 个字符串；重复打补丁、方法体被改过、锚点形状或入边变了都拒绝；
  锁定体在 v1 / 说明覆盖 / equipment-rules / 1047 里逐字节相同。
- **静态隔离证明**（`verify.static_proof`）：只写新局部；只读 `this` / `repo` / `time`；调用白名单（不含 `getMasterTable`、
  `getEquipmentAwakingCrystal`，插一次后者必须被认出）；`getlex` 只有 `CustomAbilityStringTable` / `ItemTable` / `Option`；
  没有属性写、没有无返回值调用；恰好 2 处返回；分支只在段内或跳到原生入口；段外只有 #8 进入段首；每个分支与原生入口处栈为空。
- **行为矩阵**（真实字节码 `getUseableAwakingCrystal`；`this` / `repo` / 道具是替身，`repo.getEquipmentAwakingCrystal` 按原生规则挑，
  `repo.get` 按原生构造，缺行出错）：32 个场景，21 个看得见的差别。
  官方 ★5 / ★4 / ★3 照旧提供星铁钢（★3 用 ★4 星铁钢）、没星铁钢为 None、有重复本体为 None；
  诅咒首尾两把与 PARADOX 提供禁忌星铁；禁忌星铁为 0 时**即使持有 1 万个星铁钢也是 None**；有重复本体时插入段不执行；
  表没加载走原生；道具表没加载为 None；过期道具为 None；值指向星铁钢照给（数据驱动）；
  15 种坏值（空串、null、0、负数、正号、前导 0、首尾空白、小数、指数、十六进制、逗号、文字、溢出、不存在的道具）全部 None、
  不调用 `repo.get`、不回落原生。
- **截断执行**：没有重复本体的 29 个场景再单独执行插入段（切片接哨兵）：未受限的到达原生入口，受限的自己返回且与整方法相同。
- **负对照**：未打补丁的 `2a9583cd` 基线上 32 项全部是原生结果，从不访问 `custom_ability_string`、从不查道具表、从不调用 `repo.get`。
  10 个变异体全部让断言变红：值坏回落原生、删规范整数判定、删正数判定、删道具行判定（缺行时抛错）、删持有数判定、删有效期判定、
  缺素材改给星铁钢、表缺失改成 None、前缀写错、删行判定。
- **数据合同**：`wf_weapon_awaken.cas_rows()` 与补丁读的键逐项相同（30 把、值 10000311）；`wf_client_legality` 同一能力名、同一前缀，
  客户端判坏的值门禁全部拒绝。
- 解释器是 `awaken_interp.py`：以 v1 的同一个模块名加载 `equipment-enhanced-look/look_interp.py`，不另写、不复制。

## 产物（2026-09-28，只构建）

`D:\WF\out\weapon-client-patches-20260928b\`：`build.py`、`swf/awakening-material/`（baseline、候选、三份报告）、
`swf/sort-pin/`、叠加 APK 与 `.build-report.json` / `.stack-report.json`、`build-summary.json`、`install-receipt.template.json`。
哈希见 `build-summary.json`。

## 真机验收清单（静态与解释器证据不等于真机；设计稿 §8.5）

- 前提：数据边 E1/E2 已上线（禁忌星铁道具行、30 条 `awakening_material_*`、UI 字符串「觉醒素材」），服务端白名单已上线。
- 诅咒武器 / PARADOX 重复数为 0、持有禁忌星铁：觉醒对话框显示禁忌星铁、复选框「使用禁忌星铁」，每级扣 1 个素材 + 25 锻造石。
- 禁忌星铁为 0：显示「无可用于此装备的重复数或觉醒素材」，不提供星铁钢。
- 官方 ★5 重复数为 0：提供星铁钢，不提供禁忌星铁。
- 有重复本体时照旧用本体。
- 回读缓存 SWF 的 sha，确认等于产物 SWF。

**未经真机的组合**：`getMasterTableMaybe` / `getMaybe` / `Option.Some|None` 与 v1 同源（v1 已在真机运行）；`repo.get`、`isAvailable`
在原生代码里各有调用先例；ENTER 插入与段内 `returnvalue` 在 v1 的 getPixelart 有先例。这段组合没有真机跑过。

## 安装（须作者当次授权或常设授权；本目录不做）

1. `kill -9` 结束进程（作者正在对局时等对局结束）；
2. `pm install -r`；
3. `rm -rf /data/data/com.leiting.wf/cache/app`，并确认目录已不存在；
4. 启动游戏；
5. 回读缓存里 SWF 的 sha，应等于产物 SWF。

`Local Store` 不要动。回滚：重装编成槽框 b 版 2f085757，再清一次 `cache/app`（b 版本身也未真机验收；它也不行时再退回 a 版
14396ce0，但 a 版有「武器图标会消失」）。装好后按 build-summary 的 `candidate_capabilities` 更新
`mod-tools/client_profiles.json` 的 local-mumu 档案（并同步 `test_wfx_registry` 里钉住 14396ce0 的档案测试）。
