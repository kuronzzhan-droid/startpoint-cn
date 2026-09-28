# 装备列表置顶（equipment-sort-pin）

作者原话：「PARADOX特例，这批武器能不能置顶，每次翻到最后面好麻烦，还有深渊武器和死亡使者也往前在诅咒武器后面」。
「装备一览」与「编成→选武器」的排序写死在客户端比较函数里（stack 降序 → 稀有度降序 → id 升序 / 稀有度 → id），
我方 46 把都是 ★5、id 都大于官方 ★5，改表键序、服务端顺序、表里任何一列都改不了顺序（方案 `D:\WF\out\武器置顶-20260928\方案.md`
「为什么一定要补丁」）。本补丁在两个比较函数入口插一段按 `custom_ability_string` 置顶序号比较的逻辑。

- 只做**单方法指令插入**（两个方法各一处）：battle-rules 的 `core.Editor` + 本目录自己的方法锁（`baseline.json`）。不走 FFDec、不回编 AS3。
- 锁不符就拒绝，**没有任何自动降级或兜底**。
- 本目录只产出候选 SWF 和 APK。静态检查、解释器行为测试和 APK 验签都**不等于**已经安装，也不等于实机通过。

## 构建链

| 环节 | APK | 主 SWF 容器 | 主 ABC |
|---|---|---|---|
| equipment-enhanced-party-frame a 版（已装在作者 MuMu 上，有「武器图标会消失」缺陷，**作废**） | `14396ce09a4cf236…` | `9986dea39831608e…` | `016cd9270a5b9c0d…` |
| equipment-enhanced-party-frame **b 版**（两层叠加的底包；候选，未安装） | `2f085757e4647762…` | `5bd476f6effd1452…` | `2a9583cddd477868…` |
| equipment-awakening-material | 不单独出 APK | `15c8cba8eb86c8e8…` | `22292c21361fa505…` |
| **本补丁**（候选，未安装） | 两层叠成一个 APK，见 `D:\WF\out\weapon-client-patches-20260928b\build-summary.json` | `52faeeb777f02fc2…` | `c39746e01bc14323…` |

- 基线按**主 ABC** `22292c21…`（觉醒专属素材产物）判定；容器哈希只作参考。其他基线一律拒绝（包括没打觉醒补丁的 `2a9583cd`），
  已打过本补丁的输入报告 `already_patched`。能力声明是「编成槽框的 12 项 + 觉醒专属素材 + 本补丁」共 14 项。
- 编成槽框 a 版链上的旧产物（觉醒层 `07bc8022…`、本补丁 `a6c38cbf…`，即旧候选 APK `8d4e8583`）报 `Superseded SWF baseline` 拒绝。
- 两个被改方法体在编成槽框 a 版（`016cd927…`）、b 版（`2a9583cd…`）、v1（`e87371b7…`）、1047（`d9559f3f…`）里**逐字节相同、体下标相同**（测试核对）；
  client-patch 里此前没有任何补丁锁这两个方法。
- 签名证书 `729507c10a893879…` 与本机已装的 14396ce0、b 版 2f085757 相同，候选 APK 可以 `pm install -r` 覆盖安装。

## 补丁面

| 方法 | 体 | 插入点 | 策略 | 条数 | header 前 → 后 | 覆盖的界面 |
|---|---:|---|---|---:|---|---|
| `EquipmentListScene/compareByEquipmentStatus(p1, p2)` | 70204 | #0（入口） | FORBID | 92 | `[2,3,1,1]` → `[3,12,1,1]` | 装备一览网格、一括卖出、一括强化弹窗 |
| `EquipmentSelectThumbnailListRepository/sortByRarity(p1, p2)` | 70354 | #0（入口） | FORBID | 92 | `[2,3,1,1]` → `[3,12,1,1]` | 编成选武器（同步 / 异步两条过滤路径） |

- 方法锁 sha `fa76aaec0516b16c…`（一览，38 条）、`c61505266ecd48a0…`（编成，23 条），都没有 activation、异常表、体内 trait，
  也没有 `pushscope` 序言；没有任何分支指向 #0（FORBID）。`find_anchor` 还钉住入口两条（第一比较键）与收尾的 id 相减。
- 常量池只追加 1 个字符串（前缀）；`globalLogic`、`getLogicAssets`（原生在 GlobalLogic 上用的公开名，`EquipmentListScene/buttonClicked` #64）、
  `getMasterTableMaybe`、`CustomAbilityStringTable`、`get_data`、`getMaybe`、`string`、`id` 全部复用已有多名。
  没有 `pushscope` 的方法里用 `getlex` 取全局类在 ABC 里有 1 万多处先例（运行时从方法外层作用域链与域全局解析）。
- 新局部从原 localcount 3 起编号（3–11），原方法体一个也读不到。插入段只读 `this` / `p1` / `p2`，没有属性写、没有无返回值调用。
- 其余 92566 个方法体逐字节不变（含觉醒专属素材、编成槽框、v1 与它们登记的整条叠加链）。

### 插入段（两个方法相同）

```
data = this.globalLogic?.getLogicAssets()?.getMasterTableMaybe(CustomAbilityStringTable)?.get_data()
任一环节为 null                                        → 原生
pin(p) = custom_ability_string["equipment_sort_pin_" + int(p.id)]?.string，
         必须 String(int(s)) === s 且 int(s) > 0，否则 0（= 无序号）
pa、pb 都有且不等 → return pa - pb        // 小者在前；两个正 int32 相减不溢出
pa、pb 都有且相等 → 原生
只有 pa          → return -1
只有 pb          → return 1
都没有           → 原生（原逻辑一字不改）
```

- 置顶判断在 stack / 稀有度之前：有重复件的官方武器、★5 都压不过置顶件（变异体「置顶放到第一比较键之后」必须变红）。
- 置顶组内按序号全序；序号相等时原生以 id 收尾。整个比较函数仍是全序，AS3 `Array.sort` 不稳定也不会让顺序跳动
  （全序模拟在 30 件子集上两两核对反对称与传递）。
- 取表只用不抛错的 `getMasterTableMaybe` + `getMaybe`，绝不调用 `getMasterTable`。
- **性能**：474 件约 4300 次比较，每次两次哈希查表 + 字符串拼接；原视图每次比较本来就做两次 O(n) 的 indexOf。真机开列表时顺便确认不卡。

## 键与值（`custom_ability_string`，一列表 `string`）

| 键 | 值 | 效果 |
|---|---|---|
| `equipment_sort_pin_<装备ID>` | `<序号>`（规范十进制正整数，小者在前） | 两个列表里排在所有未置顶装备之前 |

46 行，由 `mod-tools/wf_weapon_sort_pin.py` 产出（`PINS`，stage 合同同 `wf_weapon_gacha`）：

| 位 | 装备 | 序号 |
|---|---|---|
| 1 | PARADOX 5920001 | 1000 |
| 2–30 | 诅咒武器 5910101–5910129 | 2001–2029 |
| 31–45 | 深渊武器 8000101–8000115 | 3001–3015 |
| 46 | 死亡使者·终式 5900101 | 3100（ID 比深渊小，所以必须显式序号） |

- 按千位分段给以后新增武器留位置（第 30 把诅咒写 2030，不用改补丁）。
- 数据门禁：`mod-tools/wf_client_legality.py` 的 `EQUIPMENT_KEY_PREFIX_CAPABILITIES` / `equipment_key_problems`（键尾装备 ID 与序号都是
  规范十进制正整数 1–999999999），`wf_weapon_sort_pin.py` 另查键尾装备在 live 装备表里、序号互不相同、live 没有合同外的置顶键；
  `wf_midautumn_verify` 的 `cas/equipment-behaviour-key-shape`；`wfx_registry.json` 的 capability 与 `string_keys`。

能力：`equipment-sort-pin-v1`，行为型（cosmetic）。没打补丁的客户端不读这些行，显示原生顺序，不崩，**数据可以先于 APK 发布**
（WFX 门禁只警告）。强化商店的顺序（方案 A 边：类目 display_order、PARADOX list_order）只改数据，不在本补丁里。

## 用法（换一个 APK 时照做）

```powershell
# 0) 先打觉醒专属素材（见 ../equipment-awakening-material/README.md），得到 <觉醒目录>/equipment-awakening-material.swf
# 1) 检查基线（只认觉醒专属素材主 ABC 22292c21…；方法锁不符也拒绝）
python -X utf8 client-patch/equipment-sort-pin/apply_equipment_sort_pin.py --input "<觉醒目录>/equipment-awakening-material.swf" --check
# 2) 生成 SWF（输出目录必须是新的；写出 patch-report、verify-report（含全序模拟、负对照与变异体）、prepare-report）
python -X utf8 client-patch/equipment-sort-pin/apply_equipment_sort_pin.py --input "<觉醒目录>/equipment-awakening-material.swf" --output-dir "<新目录>"
# 3) 独立核验
python -X utf8 client-patch/equipment-sort-pin/verify.py "<新目录>/equipment-sort-pin.swf" --base "<新目录>/baseline.swf"
# 4) 两层叠成一个 APK：底包是编成槽框 b 版 2f085757；口令只经环境变量传递
python -X utf8 client-patch/equipment-sort-pin/package_apk.py --base "<2f085757.apk>" `
  --swf "<新目录>/equipment-sort-pin.swf" --patch-report "<新目录>/patch-report.json" `
  --stack-report "<觉醒目录>/patch-report.json" --output "<新.apk>" --work "<新 work 目录>" `
  --zipalign "<build-tools>/34.0.0/zipalign.exe" --apksigner "<build-tools>/34.0.0/apksigner.bat" `
  --keystore "弹国服/instrument/wf_new.keystore" --ks-pass-env WF_BATTLE_KS_PASSWORD --key-pass-env WF_BATTLE_KEY_PASSWORD
```

`package_apk.py` 逐环核对叠加链（签名前全部拒绝条件）：置顶报告是本补丁、ABC 是锁定目标、SWF 与报告相符；觉醒报告是
equipment-awakening-material、ABC 是它的锁定目标、它的产物 SWF 正是置顶补丁的输入；底包里的主 SWF 正是觉醒补丁的输入；
底包是编成槽框 b 版 2f085757（除非 `--allow-foreign-base`）。`battle-rules/build_apk.py` 只认「底包 SWF → 候选 SWF」一跳，
所以脚本在输出旁写 `<输出>.stack-report.json`（两层合并成一跳，逐环哈希都在 `layers` 里）交给它；签名后钉死证书 729507c1…，
回读 APK 主 ABC，`candidate_capabilities` 改为 14 项。

### 移植到别的底包

- 先 `--check`。主 ABC 不是 `22292c21…` 就会拒绝——这是有意的，补丁没有兜底路径。
- 本补丁叠在觉醒专属素材之上：换底包时先把觉醒专属素材移植过去，再移植本补丁。两个补丁改的方法互不重叠，
  但能力声明按链计算（「底包 + 觉醒 + 置顶」），不支持跳过觉醒层单独打。
- 真要移植：按「类名/方法名」定位两个方法，确认体 sha256 与 header 仍等于 `baseline.json`（体下标可以不同），再把
  `overlay.BASE_ABC_SHA`、apply / package 的目标哈希、`STACK_TARGET_ABC_SHA` 和能力声明改成那个底包的，重跑 apply → verify
  （比较矩阵、全序模拟、负对照、变异体必须全绿）→ package。方法体 sha 不同就不能套用，只能对照新字节码重新定锚点。
- 还要复核：两个方法仍是这两个界面唯一的排序比较器（`EquipmentListScene.as:220/351/750`、
  `EquipmentSelectThumbnailListRepository.as:229/280` 的调用处，静态阅读结论）；两个类的 `globalLogic` 仍是 GlobalLogic、
  `getLogicAssets()` 仍返回 `ILogicAssetContainer`。多名全部按名字从 ABC 现取，有歧义或缺失会直接报错，不会猜。

## 验证

测试：`client-patch/tests/test_equipment_sort_pin.py`，需要本机的编成槽框 b 版 SWF 夹具（`D:\WF\out\PARADOX-20260928\apk\enhanced-look-party-20260928b\swf\`；
觉醒专属素材基线在 setUpClass 里现打并核对哈希）。a 版链的旧产物只用于「拒绝」测试，缺了就跳过。

```powershell
python -X utf8 -m unittest client-patch/tests/test_equipment_sort_pin.py -v
```

- **结构**：只有 2 个锁定体改变，两段插入都能还原出锁定 sha，header 与设计值一致，产物 ABC 等于锁定目标、可以复现；
  常量池只多 1 个字符串；重复打补丁、方法体被改过、入口形状或 id 收尾变了都拒绝；锁定体在更早 3 个 ABC 里逐字节相同。
- **静态隔离证明**：只写新局部；只读 `this` / `p1` / `p2`；调用白名单（`getLogicAssets` / `getMasterTableMaybe` / `get_data` / `getMaybe`，
  不含 `getMasterTable`）；`getlex` 只有 `CustomAbilityStringTable`；没有属性写、没有无返回值调用；每个方法恰好 3 处返回；
  分支只在段内或跳到原生入口；段外没有分支进入段内；每个分支与原生入口处栈为空。
- **比较矩阵**（真实字节码，两个方法 × 两个顺序）：31 个场景，9 个看得见的差别。诅咒（stack 0）压过官方（stack 7）、
  PARADOX < 诅咒、深渊末把 < 死亡使者、诅咒末把 < 深渊首把、置顶 ★4 压过官方 ★5（编成）；官方之间、表没加载、globalLogic 为 null、
  getLogicAssets 为 null、缺行、序号相等、14 种坏值（空串、null、0、负数、小数、前导 0、正号、首尾空白、指数、十六进制、逗号、文字、溢出）
  全部等于原生结果；`2147483647` 与 `1` 相减不溢出。
- **全序模拟**：70 件背包（我方 46 件 + 官方 24 件，stack 交错）用真实字节码排序：两个列表前 46 位都是
  PARADOX → 29 把诅咒 → 15 把深渊 → 死亡使者；其余 24 件的相对顺序与原生规则、与未打补丁基线的真实字节码逐项相同；
  编成列表第 47 位是官方 ★5 最小 id；30 件子集上两两反对称、三三传递。
- **截断执行**：每个场景只执行插入段（切片接哨兵）：原生场景到达原生入口，置顶场景自己返回同样的值。
- **负对照**：未打补丁的 `22292c21` 基线上 31 项全部是原生结果、从不访问 `custom_ability_string`，我方武器沉在 ★5 段末尾。
  9 个变异体全部让断言变红：删置顶判断、互换 -1 / 1、删规范整数判定、删正数判定、置顶放到第一比较键之后、删相等回落、
  前缀写错、删表判定、p2 的序号读成 p1。
- **叠加打包**：假签名替身下，链上任何一环哈希不符都在签名前拒绝；交给 `build_apk.py` 的是「底包 SWF → 候选 SWF」一跳报告；
  证书不符标 refused；正对照 14 项能力。
- 解释器是 `sort_interp.py`：以 v1 的同一个模块名加载 `equipment-enhanced-look/look_interp.py`，不另写、不复制。

## 真机验收清单（静态与解释器证据不等于真机；方案「真机验收」）

- 前提：46 行 `equipment_sort_pin_*` 已上线（可以先于 APK）。
- 编成 → 选武器：第一格「卸下」，然后 PARADOX → 29 把诅咒 → 15 把深渊 → 死亡使者 → 官方 ★5。
- 装备一览：第一页开头是同样的 46 把（有重复件的官方武器排在它们后面），往后仍按原生规则排；一括卖出、一括强化弹窗能正常打开。
- 两个列表打开不明显变卡。
- 回读缓存 SWF 的 sha，确认等于产物 SWF。

**未经真机的组合**：`getMasterTableMaybe` / `getMaybe` 与 v1 同源（v1 已在真机运行）；`globalLogic.getLogicAssets()` 在
`EquipmentListScene/buttonClicked` 有原生先例；无 `pushscope` 方法里 `getlex` 全局类有大量原生先例。这段组合没有真机跑过。

## 安装（须作者当次授权或常设授权；本目录不做）

同 `../equipment-awakening-material/README.md`：`kill -9` → `pm install -r` → 清 `cache/app` 并确认 → 启动 → 回读缓存 SWF 的 sha。
回滚：重装编成槽框 b 版 2f085757（它本身也未真机验收；不行再退回有「图标会消失」的 a 版 14396ce0），再清一次 `cache/app`；数据行可以留着（置顶键没有补丁时不被读取）。装好后按 build-summary 的
`candidate_capabilities`（14 项）更新 `mod-tools/client_profiles.json` 的 local-mumu 档案，并同步 `test_wfx_registry` 的档案测试。
