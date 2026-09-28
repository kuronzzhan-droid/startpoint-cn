# 物品品质底色覆盖（item-rarity-frame-override）

作者 0928：禁忌星铁（道具 10000311，图标 `item/materials/mod/cursed/forbidden_star_steel`）的缩略图要和 PARADOX Lv200
一样用蓝金底，而不是 ★5 彩虹底。数据做不到：品质底是 `ThumbnailFrameView` 按稀有度 `goto` 的帧，表里没有「底」这一列；
v1（`equipment-enhanced-look`）的换底只在**强化态**（`enhanced=true`）生效，道具永远是非强化态。

本补丁在 v1 已经改过的同一个方法里补上**非强化态**：

```
setRarity(rarity, enhanced):
  原生：rarity 选帧 → frame.setRarity(rarity, enhanced)   // 打开 rarity 层、关掉 background 层
  本段：enhanced 为真 → 交给 v1 段（本段不读任何键）
        itemImagePath 不是 Some(path) 或 path 为空 → 原生
        view / view.asset / asset.globalLogic / getLogicAssets() / 表 任一为 null → 原生
        text = 表.getMaybe("rarity_frame_override_" + path)?.string；null / "" → 原生
        hideRarity(); replaceBackgroundImage(text)          // 与称号缩略图 case 11、v1 强化框同一通路
  v1 段：enhanced 为真时查 enhanced_frame_override_ …（逐字节不变）
```

- 只做**单方法指令插入**（battle-rules 的 `core.Editor` + 本目录的方法锁 `baseline.json`），不走 FFDec、不回编 AS3。
- 锁不符就拒绝，**没有任何自动降级或兜底**。
- 本目录只产出候选 SWF / APK。静态检查、解释器行为测试和 APK 验签都**不等于**已经安装，也不等于实机通过。

## 补丁面

| 方法 | 体 | 插入点 | 条数 | header 前 → 后 | 常量池 |
|---|---:|---|---:|---|---|
| `ItemThumbnailView/setRarity(rarity, enhanced)` | 85197 | #29：原生 `frame.setRarity` 之后、v1 段第一条之前 | 66 | `[3,13,1,2]` → `[3,22,1,2]` | `rarity_frame_override_` |
| `ItemThumbnailView/replace(path, rarity)` | 85210 | #2：入口，原生 `setRarity(...)` 之前 | 6 | `[3,3,1,2]` 不变 | — |

- **锁的是 v1 打过补丁的 setRarity 体**（sha `cb8893ee…`，96 条：原生 30 + v1 段 66）。v1 之前的客户端（说明覆盖 4994e23d、
  equipment-rules d99246d9）setRarity 还是原生体，方法锁拒绝。
- 两把锁在 4 个登记底包里逐字节相同、体下标相同（测试核对）：编成槽框 a `016cd927`、b `2a9583cd`、觉醒专属素材 `22292c21`、
  最终合成链 `c39746e0`（= 觉醒专属素材 + 装备列表置顶，APK 71f420a8）。也就是说后两层补丁都没碰这两个方法体。
- 两处都用 FORBID 策略：原方法体里没有任何分支指向插入点；插入点处栈为空、作用域不变，maxstack 不变。
- 新局部从锁定体的 localcount（13）起编号，原方法体（含 v1 段）一个也读不到；插入段只读 `this` 与 `enhanced` 参数，不写任何属性。
- 常量池只追加 1 个字符串；全部多名复用已有条目。其余 92566 个方法体逐字节不变（含 v1 第二图标档、编成槽框两体、
  觉醒专属素材、装备列表置顶的锁定体），方法 / 实例 / 类 / 脚本 / 元数据表与 ABC 以外的 SWF 标签都不变。
- 取表只用 `getMasterTableMaybe` + `MasterMap.getMaybe`，**绝不**调用会抛 8013/8014 的 `getMasterTable`。

### 为什么还要改 replace

原生 `replace(path, rarity)` 的顺序是 `setRarity(...)` **先于** `replaceItemImage(path)`：setRarity 里看到的 `itemImagePath`
还是这一格上一件物品的路径。走 `replace` 的有商店格 `ShopCellContentsView`、星粒兑换、羁绊币兑换、玛那购买、体力回复、
魔法石购买列表。不修的话：新格子查不到键（不换底）、复用格会拿上一件物品的键（串色）。

本补丁在入口插 6 条，与 `replaceItemImage` 的 #2–#7 **逐字节相同**：`itemImagePath = Option.Some(path)`。原生随后
`replaceItemImage` 再写一次同值；两次写之间只有 `setRarity`，原生部分不读这个字段（v1 段只在强化态读，`replace` 恒传 false），
所以没有本补丁的键时行为与原生相同。

### 格子复用

原生 `ThumbnailFrameView.setRarity` 每次都会重新打开 rarity 层、关掉 background 层，所以同一格换成别的物品时彩虹 / 普通底恢复；
蓝金贴图在复用之后才加载完成时，`backgroundTextureLoadCompleted` 只会给已关闭的 background 层换贴图，不会重新显示（矩阵逐步复现）。

## 键与值（`custom_ability_string`，一列表 `string`）

| 键 | 值 | 效果 |
|---|---|---|
| `rarity_frame_override_<缩略图图标路径>` | `<底图路径>` | 非强化态时隐藏品质底、改显示该底图 |

禁忌星铁用到的一行（`mod-tools/wf_weapon_awaken.py` 的 `RARITY_FRAME_KEYS` 已产出）：

```
rarity_frame_override_item/materials/mod/cursed/forbidden_star_steel  →  item/equipment/mod/paradox/paradox_frame_bluegold
```

- 键尾是**正在显示的图标路径**：五重商店 034 的商品图（boss_coin_shop c12）与道具 c3 是同一路径，一键两处。
  这个图标路径不能被别的物品复用，否则它们也会换底。
- 值是 144×144 不透明 PNG（与 PARADOX Lv200 同一张），按原尺寸显示在 background 层；物品图标、白色扫光在它上面。必须随同一条发布边下发。
- 强化态仍归 v1 的 `enhanced_frame_override_`；两个前缀互不回退。编成槽归 `enhanced_party_frame_override_`（另一个类）。
- 数据门禁：`mod-tools/wf_client_legality.py`（`ITEM_RARITY_FRAME_OVERRIDE`、`enhanced_look_capability` / `enhanced_look_problems`：
  键尾是路径、值是一个路径）、`wf_midautumn_verify` 的 `cas/equipment-enhanced-look-shape` 与 `KNOWN_CAPABILITIES`、
  `wfx_registry.json` 的 capability 与 `string_keys`。

能力：`item-rarity-frame-override-v1`，行为型（cosmetic）。没打本补丁的客户端（含只装 v1 / 编成槽框的）根本不读这一行，
显示原生稀有度底，不崩，**数据可以先于 APK 发布**（门禁只警告）。

## 覆盖面（按反编译源码逐个入口核对）

**生效**（都经过 `ItemThumbnailView.setRarity(…, false)`，且 `itemImagePath` 已是当前物品）：

- 道具箱：`ItemListScene` → `ItemThumbnailTableView` → `ComplexThumbnailView.showItem` → `showAnyThumbnail(Custom)`。
- 商店商品列表（含五重领主币商店 034）：`ProductListContentView` → `ComplexThumbnailView.showItem`。
- 兑换 / 购买确认对话框的大图：`ShopProductBuyDialog` → `DialogContent.ItemDetail` → `DialogItemDetailView(Custom)`；
  `MultipleProductDialogView` 同。
- 道具详情对话框：`DialogItemDetailView`、`DialogItemDetailWithExpiryTimeView`（构造传路径 → `run()`：先 `replaceItemImage` 再 `setRarity`）。
- 奖励缩略图：结算 `ItemCardView` / 关卡详情 / 礼物箱 `PresentDialogView` / 邮件 / 各奖励表（`RewardThumbnailView` 与
  `ComplexThumbnailView.showAnyItem`）。
- `replace` 入口的列表格（`ShopCellContentsView` 等，靠入口先写 `itemImagePath`）。

**不生效**（不经过 `ItemThumbnailView`，保持原样）：

- `ItemShortThumbnailView` 自带的小品质底：购买确认对话框里「持有数 前 → 后」那一行（`ItemVariationView`）、
  商店商品的消耗物小图（`CostItemShortThumbnailView`）、`DialogItemShortThumbnailGroupView`、成长基金。禁忌星铁在这些地方仍是小彩虹底。
- 没有品质底的纯图标：关卡页右下角的持有数（`DropItemContentsView`，`smallVectorIconId` + 数字）、
  觉醒对话框里的素材行（`DialogVariationTitleView` 的 `getImage`）。
- 编成装备槽（`PartyItemThumbnailView`，另一个类）。
- 先画进 RenderTexture 再显示的动画缩略图（宝箱扭蛋结果、排名奖励动画）：`textureCompletedDispatcher` 只等物品图标，不等底图，
  底图若未缓存可能画不进去 —— 与称号缩略图同一局限，禁忌星铁目前不出现在这些入口。

## 用法

```powershell
# 1) 检查底包（只认登记的 4 个主 ABC，或显式给底包构建报告；两把方法锁不符也拒绝）
python -X utf8 client-patch/item-rarity-frame-override/apply_item_rarity_frame_override.py --input "<71f420a8.apk>" --check
# 2) 生成 SWF：输出目录必须是新的；同时写出 patch-report、verify-report（含负对照与变异体）、prepare-report
python -X utf8 client-patch/item-rarity-frame-override/apply_item_rarity_frame_override.py --input "<71f420a8.apk>" --output-dir "<新目录>"
# 3) 独立核验（可复跑）
python -X utf8 client-patch/item-rarity-frame-override/verify.py "<新目录>/item-rarity-frame-override.swf" --base "<新目录>/baseline.swf"
# 4) 打包签名：口令只经环境变量传递，本目录脚本不读取、不打印、不保存口令
python -X utf8 client-patch/item-rarity-frame-override/package_apk.py --base "<71f420a8.apk>" `
  --swf "<新目录>/item-rarity-frame-override.swf" --patch-report "<新目录>/patch-report.json" `
  --output "<新.apk>" --work "<新 work 目录>" `
  --zipalign "<build-tools>/34.0.0/zipalign.exe" --apksigner "<build-tools>/34.0.0/apksigner.bat" `
  --keystore "弹国服/instrument/wf_new.keystore" --ks-pass-env WF_BATTLE_KS_PASSWORD --key-pass-env WF_BATTLE_KEY_PASSWORD
```

`package_apk.py` 先拒绝：补丁报告不是本补丁、SWF / 主 ABC 与报告不符、登记底包的产物 ABC 不是钉住的目标、底包 APK 不是
报告记下的那个（中间层 22292c21 没有 APK，不能打包）、底包里的 SWF 不是当初打补丁的那份；签名后证书不是 `729507c1…` 就把
构建报告标成 refused。能力声明 = 底包声明 + `item-rarity-frame-override-v1`（最终合成链上是 14 + 1 = 15 项）。

## 验证

```powershell
python -X utf8 -m unittest client-patch/tests/test_item_rarity_frame_override.py -v
```

- **结构**：只有 2 个锁定体改变，插入段能还原出锁定 sha，header 与设计值一致，产物 ABC 等于钉住的目标、可以复现；
  4 个登记底包各自打到各自的目标 ABC；v1 之前的客户端、方法体被改过、锚点形状变了、重复打补丁都拒绝。
- **静态隔离证明**（`verify.static_proof`）：只写新局部；只读允许的寄存器；调用白名单（不含 `getMasterTable`）；
  setRarity 段零属性写、replace 段恰好一条 `initproperty itemImagePath` 且与 `replaceItemImage` #2–#7 逐字节相同；
  分支只在段内或跳到原生入口；段外没有分支跳进段内；原生入口处栈为空；setRarity 段之后紧跟完整的 v1 段。
- **行为矩阵**（真实字节码，v1 的 `look_interp` 执行一格缩略图，贴图异步回调由测试决定何时到达）：34 个场景，15 项命中。
  showItem / 商品列表 Custom / CustomWithEnhancedEffect 非强化 / replace / 非强化装备；键缺失、空串、null、表未加载、别的图标的键、
  v1 的键在非强化态不被读、itemImagePath 为 None、空格、view 为 null；强化态只归 v1；格子复用（→ 普通道具 / 空格 / 强化装备 / 称号 / 再回来，
  贴图晚于复用到达）；replace 复用往返。每个场景还核对本补丁前缀的查表序列。
- **v1 回归**：v1 自己的强化框矩阵（17 个场景）在产物上逐项不变，v1 前缀的查表序列也不变。
- **截断执行**：只跑两段插入段（切片接哨兵），13 项全部到达原生入口；setRarity 段未命中落到 v1 段入口，replace 段写好 itemImagePath。
- **负对照**：同一矩阵在底包上全部是原生结果、从不查本补丁的前缀；8 个变异体全部让指定断言变红（删 / 反 `enhanced` 条件、删空串判定、
  删 `itemImagePath` 的 Some 判定、删 `hideRarity`、前缀换成 v1 的、replace 不先写路径、replace 写成 rarity 参数）。
  `Option.None` 按真客户端建模为 `params = null`（`new Option("None",1,null)`）：删掉 Some 判定后空格 / 无图标读 `null[0]`，
  `item_image_none`、`empty_cell`、`reuse_hit_then_empty` 变红。v1 模块共用的 `NONE_OPTION`（`params = []`）不改，只在本补丁的世界里替换。

## 产物（2026-09-28，只构建）

`D:\WF\out\item-rarity-frame-20260928\`：`build.py`、`refresh_verify.py`（核验器补 Some 判定变异体后只复跑核验，SWF / APK 未重建）、`swf/`（baseline、候选、三份报告）、候选 APK 与 `.build-report.json`、
`five-boss-check.json`（五重三项补丁回读）、`build-summary.json`、`install-receipt.template.json`。哈希见 `build-summary.json`。

## 安装（须作者授权或常设授权；本目录不做）

`kill -9` → `pm install -r` → `rm -rf /data/data/com.leiting.wf/cache/app`（确认已不存在）→ 启动 → 回读缓存 SWF 的 sha。
回滚：重装 71f420a8 后再清一次 `cache/app`。装好后按 `candidate_capabilities` 更新 `mod-tools/client_profiles.json` 的
local-mumu 档案（15 项），并同步 `test_wfx_registry` 里钉住现装 APK 的档案测试。
