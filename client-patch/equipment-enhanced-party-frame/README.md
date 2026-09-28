# 编成装备槽强化框（equipment-enhanced-party-frame）

作者真机反馈「PARADOX在队伍界面还是粉框」。v1（`equipment-enhanced-look`）只改了 `ItemThumbnailView.setRarity`，
编成装备槽走的是另一个类 `PartyItemThumbnailView`，布局里没有 background 容器，v1 的换底通路在这里不存在。
本补丁单独补编成槽：强化态、图标路径有 `enhanced_party_frame_override_<图标路径>` 行时，隐藏粉框、显示该行指向的框图。

- 只做**单方法指令插入**：battle-rules 的 `core.Editor` + 本目录自己的方法锁（`baseline.json`）。不走 FFDec、不回编 AS3。
- 锁不符就拒绝，**没有任何自动降级或兜底**。
- 本目录只产出候选 SWF 和 APK。静态检查、解释器行为测试和 APK 验签都**不等于**已经安装，也不等于实机通过。

## b 版（2026-09-28，作者反馈「武器图标会消失」）

真机：a 版（14396ce0）出击前选队伍里 PARADOX Lv200 显示蓝金框、**没有图标**。

**结论级别：代码层确认，真机待证。** 下面的机制在反编译源码与真实字节码解释执行里成立；作者看到的现象是否就是它，
要靠下文「真机验收清单」里装 b 版之前的两项区分性检查来定。根因（代码层）不在编成槽框的插入段，是原生缺陷被框放大：

- 原生 `setItemImage(None)`（体 85274 #24–28）调 `itemImage.changeTexture(Option.None)`，
  `TextureReplaceableImage.changeTexture` 的 None 分支会 `texture.dispose()`。这张贴图是 `view.asset.getTexture(path)` 从
  **ItemThumbnail 缓存**取来的共享贴图（常驻 common 组，跨格子、跨画面）。
- 官方装备图标是 `item/sprite_sheet` 图集的 SubTexture（501 条 `item/equipment/...`），dispose 是空操作；
  自制武器图标（`item/equipment/mod/**`，PARADOX 三档、诅咒武器等）是独立 PNG，`trimmed_image` 里也没有行，
  缓存里存的是 ConcreteTexture 本体 —— dispose 直接释放 GPU 贴图，缓存却仍记为 Loaded。
- 之后任何格子、任何画面再 `setTexture` 这个路径都同步拿到已释放的贴图，直到重启游戏（ItemThumbnail 是
  `AssetGroupResolver.getCommonGroups` 里的常驻组，`AssetContainerBase.reset` 换场景时保留新旧场景都用的缓存）。
  真机上画一张已释放的 ConcreteTexture 是什么结果——空白、黑块，还是抛 #3694 被 CrashUtil 接住——**没有证据**；
  游戏代码里没有打开 `enableErrorChecking` 的地方，但这推不出「不抛错」。解释器替身只是把「贴图已 dispose」记为看不见。
- 触发：同一格「有图标 → 空槽」——编成里卸下、出击前选队伍编辑后刷新成空槽、**出击前选队伍切到这一格为空的队伍分组**
  （`NormalPartySelectLogic.tabChanged` → `PartySelectView.refreshCarousel` → `PartySelectCarouselView.refresh` →
  当前页 `initialize()`，同一批 `PartyItemThumbnailView` 按另一分组 `replaceEquipment(getEquipmentPeek)`）、
  联机房间成员面板切到空槽成员、魂珠槽清空。原样的「构造 None → run → replaceEquipment」本身**不**触发（a 版上是绿的）。
  蓝金框是自建图，从不 `changeTexture(None)`，所以照常显示；v1 下同样步骤是「粉框 + 图标贴图已释放」。
- 这个理论还有一个推论要真机对上：缓存跨画面共享，出事之后再打开编成画面，PARADOX 也应当没有图标
  （`A_party_screen_after_select_emptied`）。作者同一份反馈里编成画面正常——只有在「看编成画面早于出事」时才对得上，
  这一点没有核实。
- 插入段本身不会碰图标：自建图按 `name === 前缀` 认（图标的 name 是 null），`addChildAt(img, 0)` 放在图标下面，
  属性写只落在自建图与 rarity 容器（静态证明与变异体 `no_name_check` / `frame_above_icon` 都覆盖）。

修法（单方法插入，仍是本能力 `equipment-enhanced-party-frame-v1`，数据契约不变）：

| 方法 | 体 | 插入点 | 条数 | header | 常量池 |
|---|---:|---|---:|---|---|
| `PartyItemThumbnailView/setItemImage(Option)` | 85274 | #24：lookupswitch case 1（None）入口，ENTER | 4 | `[4,2,1,2]` 不变 | 不变 |

```
this.itemImage.texture = null;      // 与原生 changeTexture(None) 里的 texture = null 是同一个 setter，只少了 dispose
→ 原生 itemImage.changeTexture(Option.None)   // 看到 texture == null：跳过 dispose，再赋一次 null（无操作）
```

- 方法锁 `e17a429af55504f3…`（体 85274，header `[4,2,1,2]`），整条 30 条原生指令逐条钉形状、lookupswitch 目标钉死；
  已打过（多 4 条）或形状变了都拒绝，没有兜底。
- 对官方图集图标行为逐字节等价（SubTexture.dispose 本来就是空操作）；对独立 PNG 图标只去掉那次破坏共享缓存的 dispose。
  贴图始终归缓存所有，缓存重置时由缓存释放，不泄漏。`textureLoadCompleted` 的 None 分支此后只会遇到 `texture == null`，不需要改。
- 与原生的唯一边界差异：插入段排在 `changeTexture` 第一行 `if(_disposed) return` 之前。itemImage 已经 dispose 时原生什么都不做，
  补丁仍会多写一次 `style.texture = null`（`Image.set texture` → `MeshStyle.set texture(null)` 只 `setRequiresRedraw`；
  `Quad.setupVertices` 因 `_disposed` 提前返回）——无害：不可见、不抛错。
- 图标矩阵（verify.icon_matrix，11 个场景）：补丁版全绿；v1 基线与 a 版在「有图标 → 空槽」4 个场景上必然变红（负对照）；
  变异体 `keep_dispose`（插入段不置空）让这 4 个场景变红。
- 真机流程矩阵（verify.FLOWS，22 条）：A 编成（构造时带路径；另有「出击前选队伍出事之后才打开编成画面」）、
  B 出击前选队伍（每格构造 None 再 `replaceEquipment`，同一件装备编在两页、共享缓存；`B_select_tab_switch` = 同一页 3 格
  切到这一格为空的分组再切回）、C 联机房间成员面板（EmptyLabel，成员 / 魂珠切换）、D 格子复用；图标与框图贴图先到、后到、
  已就绪都覆盖。每一步之后逐格查图标（在容器里、可见、在框之上、贴图是缓存那张且未 dispose）与框（框 / rarity 恰好显示一个、
  框只给键图标），最后比对最终框。补丁版全绿；**同一组断言**在 v1 基线与 a 版（016cd927）上在 8 条「某格有图标 → 空槽」流程
  （`FLOW_DISPOSE_TARGETS`）上变红；原样的 `B_select_none_then_paradox` 在 a 版上是绿的。a 版在这些流程里的最终状态是
  「蓝金框在、图标贴图已 dispose」，与作者反馈的现象一致——这是代码层的对应，不等于真机已证实（回归测试钉住的是字节码行为）。
- 其他原生视图（`PartyCarouselAbilitySoulView`、`FramelessItemThumbnailView` 等）也有 `changeTexture(None)`，本补丁不改；
  数据侧另有不需要 APK 的加固：给自制图标路径补 `trimmed_image` 行（`x=0,y=0,w,h`），缓存就会存 SubTexture，所有视图的 dispose 都变成空操作。

## 构建链

| 环节 | APK | 主 SWF 容器 | 主 ABC |
|---|---|---|---|
| equipment-description-override | `cf91b29b…` | `cdc4c1d1…` | `4994e23d…` |
| equipment-enhanced-look（已装在作者 MuMu 上） | `7056f7dc072cb5d4…` | `45ca9985a896b644…` | `e87371b709c41b66…` |
| 本补丁 a 版（已装本机，有「图标会消失」缺陷） | `14396ce09a4cf236…` | `9986dea39831608e…` | `016cd9270a5b9c0d…` |
| **本补丁 b 版**（候选，未安装） | 见 `enhanced-look-party-20260928b/build-summary.json` | `5bd476f6effd1452…` | `2a9583cddd477868…` |

- 基线按**主 ABC** `e87371b7…` 判定；容器哈希只作参考。其他基线一律拒绝，已打过本补丁的输入报告 `already_patched`；
  a 版产物（`016cd927…`）明确拒绝，要求回到 7056f7dc 的主 SWF 重新打（b 版不叠在 a 版上）。
- 被改方法体在 1047（`d9559f3f…`）、equipment-rules（`d99246d9…`）、说明覆盖（`4994e23d…`）、v1（`e87371b7…`）里
  **逐字节相同、体下标相同**（测试核对）。但 apply 只认 v1 这一个主 ABC：候选 APK 的能力声明是「v1 的 11 项 + 本补丁 1 项」。
- 签名证书 `729507c10a893879…` 与 7056f7dc 相同，候选 APK 可以 `pm install -r` 覆盖安装。

## 补丁面

| 方法 | 体 | 插入点 | 条数 | header 前 → 后 | 常量池 |
|---|---:|---|---:|---|---|
| `PartyItemThumbnailView/updateEnhancedEffectAnimation()` | 85268 | #2：`getlocal_0; pushscope` 之后、原生 `findproperty isEnableEnhancedEffect` 之前 | 161 | `[2,2,1,2]` → `[4,15,1,2]` | `enhanced_party_frame_override_` |

- 方法锁 sha `f59e0a7ff974866716ed9a70920be87bd56ee110bfc30db3f3530f9926b2f2e8`，没有 activation、异常表、体内 trait。
- FORBID 策略：原方法的分支目标只有 #9/#10/#19/#21/#22/#24，没有指向 #2 的。插入段所有出口都落到原生入口，段内没有 return。
- 常量池只追加 1 个字符串（前缀，同时用作自建图的 `name`）；`"rarity"`、`"image"` 与 35 个多名全部复用 ABC 里已有的条目。
- 新局部从原 localcount 2 起编号（2–14），原方法体一个也读不到。插入段只读 `this`。
- 其余 92566 个方法体逐字节不变（b 版另改 setItemImage 一个体；含 v1 的 2 个体和它登记的整条叠加链），方法 / 实例 / 类 / 脚本 / 元数据表与 ABC 以外的 SWF 标签都不变。

### 为什么宿主是 `updateEnhancedEffectAnimation`

- 编成槽的粉框是布局 `rarity` 容器里的一张图集贴图（第 11 帧 `party_equipment_rainbow_enhanced`，72×72，圆角）。
  `setRarity` 只做 `rarity.goto(帧号)`，拿不到图标路径；类里也没有「按路径载图」的回调方法。
- 异步载图的回调必须是已有函数（单方法插入不能 `newfunction`、不能加方法），而且回调时要重跑同一段逻辑。
- 这个方法满足全部条件：不带参数、只读字段；在 run / replaceEquipment / replaceAbilitySoul 里都是最后一步
  （字段与 rarity 帧都已定）；原生部分幂等（被多调一次只是把扫光的 visible 再设一遍）。
- 原生 `setItemImage` 的回调 `textureLoadCompleted` 也是不带参数的方法闭包，写法有先例。

### 插入段

```
if (!gear.checkPhaseBeforeDispose()) → 原生                 // 回调可能在 dispose 之后才到
layout = this.layout;  null → 原生
rarity = layout.getContainer("rarity");  holder = layout.getContainer("image")   // item_layer：只放了 itemImage
img = holder.numChildren && holder.getChildAt(0).name === 前缀 ? getChildAt(0) : null   // 本格的自建图
isEnableEnhancedEffect 不是 Some(true)                → MISS
imagePath 不是 Some(path) 或 path 为空               → MISS
text = custom_ability_string[前缀 + path]?.string    // getMasterTableMaybe + getMaybe，绝不 getMasterTable
       view / asset / globalLogic / 表 / 行 为 null、string 为 null 或空 → MISS
tex = asset.forEach(asset._getTextureFunc, text)     // = getTexture 去掉 8004 抛错
tex 为 null → asset.setTexture(ItemThumbnail, text, this.updateEnhancedEffectAnimation); → MISS（载图期间先显示粉框）
命中：img 为 null 时 new TextureReplaceableImage()、name = 前缀、holder.addChildAt(img, 0)（图标下面）
      img.changeTexture(Some(tex)); img.readjustSize(72, 72)
      img.transformationMatrix = rarity.transformationMatrix   // 146×146，左上角 (-73,-73)，与粉框逐像素同位
      img.visible = true; rarity.visible = false
MISS：img 存在时 img.visible = false; rarity.visible = true    // 只在本格建过图时才碰 rarity
→ 原生入口（扫光显示 / 隐藏照旧）
```

- **过期回调**：回调不带路径，到达时按**当时**的字段重算。格子已换成别的装备 → 未命中、藏图、显示粉框；
  换成另一个命中键 → 探测新键，没就绪就再请求一次。
- **不会递归**：只有探测为 null 时才请求；而 `setTexture` 同步回调只发生在「subtextures 里有这个键」或「Loaded」两种情况，
  这两种情况探测都会返回非 null（探测遍历的缓存是 `setTexture` 的超集）。变异体「永远请求」在贴图已就绪时同步重入。
- **dispose 之后才到的回调**：跳过本段；原生部分只改已 dispose 的扫光动画的 visible，无害。
- **从不** `changeTexture(None)`（它会 dispose 共享贴图）。本类的字段一个也不写。
- `rarity.visible` 原生代码从不改，本补丁是唯一写入者；`goto` 只动容器里**声明过**的子图，不动容器自身的 visible，
  也不动 `image` 容器（它没有声明子节点），所以自建图不会被 goto 打开或挪走。
- 触摸：`image` 容器在 run() 里已设 `touchable=false`，touchObject 仍在最顶层。

### 层级与几何

`rarity`（命中时隐藏）< 蓝金框（`image` 第 0 位）< 物品图标 < 扫光（`background_effect`）< `empty_*` < 外框 < `used_overlay` < touchObject，
与粉框的层级相同。`image` 容器是单位矩阵、与 `rarity` 同属 layout；抄 `rarity.transformationMatrix`（a = d = 2.02777099609375，
tx = ty = -73，来自 `scene/common_ui/item_thumbnail.ui` 的 `layout/party_equipment_thumbnail`）后，框落在 146×146、左上角 (-73,-73)。
平滑与粉图同为双线性（Starling 默认）。框图任何分辨率都先归一到 72×72，所以 144 的图也不会撑大。

## 键与值（`custom_ability_string`，一列表 `string`）

| 键 | 值 | 效果 |
|---|---|---|
| `enhanced_party_frame_override_<编成槽正在显示的图标路径>` | `<框图路径>`（无扩展名） | 强化态时隐藏粉框、在图标下面显示该图 |

PARADOX 这一行：

```
enhanced_party_frame_override_item/equipment/mod/paradox/paradox_lv200  →  item/equipment/mod/paradox/paradox_party_frame_bluegold
```

- 键尾按 `imagePath` 字段逐字拼接。编成槽的图标就是 `get_pixelArtPath()`，经 v1 的第二图标档：Lv200 才是 lv200 图标，
  Lv120–199 仍是 lv120 图标 + 粉框。lv200 图标路径不能被别的装备复用。
- 与 v1 的 `enhanced_frame_override_` 是两个独立的键，互不回退。
- 框图走物品图标同一个载入器（`AssetGroupKind.ItemThumbnail`），PNG 必须与数据同一条发布边下发。缺图 = 取图失败（与缺任何物品图标相同），靠数据门禁保证不出现。
- 美术：`mod-tools/assets/paradox/paradox_party_frame_bluegold.png`，72×72 RGBA，由 `build_frame_bluegold.py` 用 v1 同一个 `recolor()`
  从官方 `party_equipment_rainbow_enhanced` 换色；α 逐像素照抄官方（24 个 0、46 个半透明），圆角像素的 RGB 取列表框同位置像素再换色、不预乘。
- 数据门禁：`mod-tools/wf_client_legality.py` 的 `ENHANCED_LOOK_PREFIX_CAPABILITIES` / `enhanced_look_capability` / `enhanced_look_problems`
  （新前缀映射到**新能力**，不归 v1，否则只装 v1 的客户端会被误判为支持），`wf_midautumn_verify` 的 `cas/equipment-enhanced-look-shape`，
  `wfx_registry.json` 的 capability 与 `string_keys`，`wf_paradox_weapon.py` 的 `LOOK_PARTY_FRAME_KEY` / `ASSET_FILES`。

能力：`equipment-enhanced-party-frame-v1`，行为型（cosmetic）。没打本补丁的客户端（含只装 v1 的）根本不读这个键，
编成槽照旧显示粉框，不崩溃，**数据可以先于 APK 发布**。

## 用法（换一个 APK 时照做）

```powershell
# 1) 检查基线（只认 v1 主 ABC e87371b7…；方法锁不符也拒绝）
python -X utf8 client-patch/equipment-enhanced-party-frame/apply_equipment_enhanced_party_frame.py --input "<7056f7dc.apk>" --check
# 2) 生成 SWF：输出目录必须是新的；同时写出 patch-report、verify-report（含负对照与变异体）、prepare-report
python -X utf8 client-patch/equipment-enhanced-party-frame/apply_equipment_enhanced_party_frame.py --input "<7056f7dc.apk>" --output-dir "<新目录>"
# 3) 独立核验（apply 已执行一次，可以复跑）
python -X utf8 client-patch/equipment-enhanced-party-frame/verify.py "<新目录>/equipment-enhanced-party-frame.swf" --base "<新目录>/baseline.swf"
# 4) 打包签名：口令只经环境变量传递，本目录的脚本不读取、不打印、不保存口令
python -X utf8 client-patch/equipment-enhanced-party-frame/package_apk.py --base "<7056f7dc.apk>" `
  --swf "<新目录>/equipment-enhanced-party-frame.swf" --patch-report "<新目录>/patch-report.json" `
  --output "<新.apk>" --work "<新 work 目录>" `
  --zipalign "<build-tools>/34.0.0/zipalign.exe" --apksigner "<build-tools>/34.0.0/apksigner.bat" `
  --keystore "弹国服/instrument/wf_new.keystore" --ks-pass-env WF_BATTLE_KS_PASSWORD --key-pass-env WF_BATTLE_KEY_PASSWORD
```

### 移植到别的底包

- 先 `--check`。主 ABC 不是 `e87371b7…` 就会拒绝——这是有意的，补丁没有兜底路径。
- 只装了 v1 以前层（说明覆盖 / equipment-rules / 1047 / 灰方）的底包：先打 v1，再打本补丁；本补丁不单独适配 v1 以前的 ABC，
  因为能力声明「v1 的 11 项 + 1」会失真。
- 真要移植：按「类名/方法名」定位 `PartyItemThumbnailView/updateEnhancedEffectAnimation`，确认体 sha256 与 header 仍等于 `baseline.json`
  （体下标可以不同），再把 `overlay.BASE_ABC_SHA`、apply / package 的目标哈希和能力声明改成那个底包的，重跑 apply → verify
  （行为矩阵、负对照、变异体必须全绿）→ package。方法体 sha 不同就不能套用，只能对照新字节码重新定锚点。
- 还要复核三个 `.ui` 前提：`layout/party_equipment_thumbnail` 里有 `rarity` 与 `image` 两个容器；`image` 是单位矩阵、没有声明子节点；
  粉框帧仍是 72×72 的 `party_equipment_rainbow_enhanced`。换了 `.ui` 资产就要重看几何。
- 多名全部按名字从 ABC 现取（`core.Editor.q` 要求唯一），新底包里有歧义或缺失会直接报错，不会猜。

`package_apk.py` 先拒绝几类不匹配：补丁报告不是本补丁、ABC 不是锁定目标、SWF 与报告不符、底包里的 SWF 不是当初打补丁的那份、
底包不是已装的 7056f7dc（除非 `--allow-foreign-base`）；再调用 `battle-rules/build_apk.py`（核对原签名证书、所有非 SWF 成员和压缩方式都不变）；
最后回读 APK 里的主 ABC，并把 `candidate_capabilities` 改为「v1 的 11 项 + `equipment-enhanced-party-frame-v1`」。

## 验证

测试：`client-patch/tests/test_equipment_enhanced_party_frame.py`，需要本机的 v1 SWF 夹具。

```powershell
python -X utf8 -m unittest client-patch/tests/test_equipment_enhanced_party_frame.py -v
```

- **结构**：只有 2 个锁定体改变（85268、85274），插入段能还原出锁定 sha，header 与设计值一致，产物 ABC 等于锁定目标、可以复现；常量池只多 1 个字符串；
  重复打补丁、方法体被改过（header 或字节不符）、锚点指令形状变了都拒绝。
- **静态隔离证明**（`verify.static_proof`）：只写新局部；只读 `this`；调用白名单（不含 `getMasterTable`、`getTexture`）；
  `getlex` 只有 4 个类；属性写逐条追踪接收者，只有「自建图的 name / visible / transformationMatrix」和「rarity 的 visible」；
  无返回值调用只有 `asset.setTexture`、`holder.addChildAt`、`img.changeTexture`、`img.readjustSize`；分支只在段内或跳到原生入口；
  段外没有分支跳进段内；每个分支与原生入口处栈为空（插一条 `pop` 必然下溢，探针本身有正反对照）。
- **行为矩阵**（真实字节码：一格编成槽先经真实 `run()` 建起来，再按步骤复用；贴图回调由测试决定何时到达）：30 个场景，其中 9 个看得见的命中。
  命中（贴图后到 / 已就绪 / 144 的图 / 经 run() 构造 / 同键重复）、载入前粉框、lv120 图标、键缺失、空串、null、表未加载、只有 v1 的键、
  非强化态、没有图标路径、空槽、魂珠；复用（蓝金 → 别的强化 / lv120 / 空槽 / 魂珠 / 同图标非强化、来回切换）；
  载入前就换走、贴图随后到达（含本格已有自建图的情况）；两个命中键先后切换、旧键贴图先到（中途快照仍是粉框）；dispose 之后回调到达。
- **截断执行**：每个场景跑完后再单独执行一次插入段（切片接哨兵），30 项全部到达原生入口且看到的框不变（幂等）。
- **负对照**：未打补丁的 v1 基线上 30 项全部是原生结果（粉框），从不访问 `custom_ability_string`、从不建图、从不请求框图。
  12 个变异体全部让断言变红：setItemImage 不置空（b 版修复撤掉）、删强化条件、删 dispose 判定、删恢复、不藏粉框、
  删探测（同步重入）、删尺寸、删矩阵、不认名字（把图标当自建图）、放到图标上面、前缀写成 v1 的、删空串判定。
- **图标矩阵与真机流程 A–D**（b 版）：见上文「b 版」一节；`red_assertions` 同时跑框矩阵、图标矩阵和流程矩阵，变异体按三者合计。
- 解释器是 `party_interp.py`：以 v1 的同一个模块名加载 `equipment-enhanced-look/look_interp.py`，不另写、不复制。

## 产物（2026-09-28，只构建）

`D:\WF\out\PARADOX-20260928\apk\enhanced-look-party-20260928\`：`build.py`、`swf/`（baseline、候选、三份报告）、
`WorldFlipper-equipment-enhanced-party-frame.apk` 与 `.build-report.json`、`build-summary.json`、`install-receipt.template.json`、
`research.md`（调研与规格）、`prototype/`（原型）、`preview_party_frame.png`（美术预览）。哈希见 `build-summary.json`。

b 版：`D:\WF\out\PARADOX-20260928\apk\enhanced-look-party-20260928b\`（同一套产物 + `repro/flows_icon.py` 复现脚本；
诊断阶段的副本构建移到 `diagnosis-build/`），哈希见其 `build-summary.json`。

## 真机验收清单（静态与解释器证据不等于真机）

- 编成画面（队伍轮播）：PARADOX Lv200 显示蓝金框，圆角透明，位置与粉框重合，扫光照常；翻页或换成别的强化满 5★ 时粉框恢复；
  卸下装备显示空槽框，换回 PARADOX 恢复蓝金。
- 出击前选队伍、联机房间成员面板：同上。
- Lv120–199 的 PARADOX 显示 lv120 图标 + 粉框；魂珠槽不受影响。
- 首次进入时可能先闪一下粉框再换成蓝金，这是异步载图的预期行为。
- 回读缓存 SWF 的 sha，确认等于产物 SWF。
- **装 b 版之前，先在仍装着 a 版的设备上做两项区分性检查**（结果填 install-receipt 的 `runtime_checks`）：
  ① 出现「有框没图标」之后**不要重启**，回编成画面看 PARADOX：按本理论这里也应当没有图标（缓存跨画面共享）；
  如果编成画面有图标，本理论解释不了作者的现象，先别装 b 版，回来重新查。
  ② 重启游戏，进出击前选队伍，确认 PARADOX 有图标；切到这一格为空的队伍分组，再切回来：按本理论图标应当消失、蓝金框还在。
  两项都符合才算真机证实根因；只做 ② 的话，可再做「编成里卸下 → 换回」作补充对照。
- b 版另查（先重启一次：a 版会话里已被 dispose 的贴图要重启才恢复，不算 b 版结果）：编成里卸下 PARADOX → 换回，图标仍在；
  再进出击前选队伍仍是图标 + 蓝金框；出击前选队伍切到这一格为空的分组再切回，图标仍在；出击前选队伍编辑把这格清空 → 回来 →
  装回，图标仍在；联机房间成员面板在有 / 无 PARADOX 的成员之间切换，图标仍在；诅咒武器等自制武器卸下 / 换回，图标仍在。

**未经真机的组合**：`constructprop TextureReplaceableImage`、`addChildAt`、两参 `readjustSize`、方法闭包作 `setTexture` 回调、
写 `transformationMatrix` 在原生代码里各有先例，取表与 Option 判定与 v1 同源（v1 已在真机运行），但这段组合没有真机跑过。

## 安装（须作者当次授权或常设授权；本目录不做）

1. `kill -9` 结束进程（作者正在对局时等对局结束）；
2. `pm install -r`；
3. `rm -rf /data/data/com.leiting.wf/cache/app`，并确认目录已不存在；
4. 启动游戏；
5. 回读缓存里 SWF 的 sha，应等于产物 SWF。

`Local Store` 不要动。回滚：重装 7056f7dc，再清一次 `cache/app`。装好后按 build-summary 的 `candidate_capabilities` 更新
`mod-tools/client_profiles.json` 的 local-mumu 档案（并同步 `test_wfx_registry` 里钉住 7056f7dc 的档案测试）。
