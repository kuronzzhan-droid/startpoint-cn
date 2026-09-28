# 武器觉醒与新掉落：材料图标

设计稿：`D:/WF/out/武器觉醒与新掉落-20260928/设计.md` §6（规范、范围、流程、图集规程）。
评审拼板：`D:/WF/out/武器觉醒与新掉落-20260928/icons_review.png`（`build_review.py` 生成）。

本目录只放图和生成脚本。不写 store、`.cdn`、`item_icon` 图集和道具表。追加图集、改道具行由构建器单元按 §6.6 分两条边发布。

## 文件

| 道具 | 名 | ★ | c3（20×20） | c4（40×40 = c3×2） | 逻辑路径（c3 / c4） |
|---|---|---|---|---|---|
| 10000310 | 深界王币 | 4 | `icons/king_coin.png` | `icons/king_coin_c4.png` | `item/materials/mod/five_boss/king_coin` / `item_icon/…/five_boss/king_coin` |
| 10000311 | 禁忌星铁 | 5 | `icons/forbidden_star_steel.png` | `icons/forbidden_star_steel_c4.png` | `item/materials/mod/cursed/forbidden_star_steel` / `item_icon/…/cursed/forbidden_star_steel` |
| 10000144 | 终式武装图纸 | 3 | `icons/deathbringer_blueprint_v2.png` | `…_c4.png` | `…/five_boss/deathbringer_blueprint_v2`（两边同名） |
| 10000145 | 深界结晶 | 4 | `icons/deep_crystal_v2.png` | `…_c4.png` | `…/five_boss/deep_crystal_v2` |
| 10000146 | 五重决战之证 | 3 | `icons/fivefold_clear_badge_v2.png` | `…_c4.png` | `…/five_boss/fivefold_clear_badge_v2` |
| 10000147 | 五王心核 | 5 | `icons/five_king_core_v2.png` | `…_c4.png` | `…/five_boss/five_king_core_v2` |
| 10000301 | 矛盾结晶 | 4 | `icons/contradiction_crystal.png` | `icons/contradiction_crystal_c4.png` | `item/materials/mod/paradox/contradiction_crystal_v2` / `item_icon/materials/mod/paradox/contradiction_crystal` |
| 10000302 | 悖论之核 | 5 | `icons/paradox_core.png` | `icons/paradox_core_c4.png` | `item/materials/mod/paradox/paradox_core_v2` / `item_icon/materials/mod/paradox/paradox_core` |
| 10000143 | 深界连战凭证 | 5 | `icons/five-boss-v2-handoff/ticket_icon_20.png` | `…/ticket_icon_41.png`（41×41） | 五重线原位替换（见下） |

`manifest.json` 按道具记录逻辑路径、母本、门禁指标，以及解码后 RGBA 像素的 sha256。

## 生成与核对

```bash
python mod-tools/assets/weapon-awaken/build_icons.py           # 重写 icons/ 与 manifest.json
python mod-tools/assets/weapon-awaken/build_icons.py --check   # 核对像素、manifest 与源码一致，并跑门禁
python mod-tools/assets/weapon-awaken/build_review.py          # 重出评审拼板（只读 live store）
python -m unittest mod-tools/tests/test_weapon_awaken_icons.py
```

- 每张 c3 都是 `build_icons.py` 里手摆的 20×20 字符格加调色板，没有随机数，也不读网络和 store。
- c4 由 c3 最近邻放大 ×2 得到，不单独画。
- 门禁照 §6.5 设置：
  - 20×20，alpha 只有 0/255；
  - 包围盒长边不小于 ★3 14、★4 16、★5 19，代币和券不小于 19；
  - 描边取主色相压暗：最大通道 ≥40（不是近黑）、饱和度 ≥0.4、明度 0.2–0.5，主体有彩像素至少 20% 落在描边色相 ±45° 内；前两种描边色占比 ≥0.9；
  - 色数 ≤17，孤立杂色 ≤0.10；
  - 不能右下受光；
  - c4 等于 c3 ×2。
- 测试给每条门禁都配了负向对照：把合格的图改坏，对应门禁必须报红。描边另有近黑 (24,24,42)、(20,14,40) 和色相不符三组样本。
- 描边阈值、色数、杂色和描边集中度与构建器 `wf_weapon_awaken.py` 的 `icon_problems`（非彩虹件）逐项相同。
  测试核对两边阈值一致；交付件按非彩虹口径两边都过；坏样本两边都报红。本目录没有彩虹配色的图，禁忌星铁也不是。

## 交接注意

- **深界连战凭证 10000143 归五重线**（`five_boss_v2_spec.json`）。本单元不改对方的 `mod-tools/assets/five-boss-v2/`。
  - 按 §6.4 母本高难多人勋章 `extreme_multi_battle_token` 画成徽记：交叉双剑加紫盾，盾面嵌紫水晶。
  - 不用横票结构。凭证在五重商店类目 99 与武器扭蛋券 999019、十连券 999020（`ticket_equipment_001/002`，横票）同列出售，
    三者都是 ★5 彩虹底框。评审拼板的凭证行放了这两张券的 live 实图。
  - 五重线拿 `icons/five-boss-v2-handoff/` 下的两张图覆盖同名文件即可。
  - `ticket_icon_41.png` 必须保持 41×41，因为 live 子纹理是 41×41，尺寸不一致时 `plan_item_icons` 会拒绝。
  - 内容是 40×40 的 c3×2，贴在 (0,1)，顶行和右列留透明。掉落条按左下角对齐，所以显示位置与新式 40×40 一致。
- **PARADOX 两件的 c3 源图归 PARADOX 线**（`mod-tools/assets/paradox/paradox_shard.png`、`paradox_core.png`，由 `wf_paradox_weapon.py` MATERIALS 引用）。
  - 重画理由：§6.3/§6.4 要求悖论之核修描边和对比（金半边改深褐描边；左右亮度差 107 过强，门禁不设上限，靠重画降到 63）。
    矛盾结晶旧图杂色 0.188，超过门禁上限 0.10。
    两张旧图的描边都是 (24,24,42)，明度 0.16，按对齐构建器后的门禁（明度 ≥0.2）也不过。
  - 本目录给出了重画版。c3 用新逻辑名 `_v2`，c4 用 `mod/paradox/` 下的专属子纹理。
  - **c3 和 c4 必须在同一条边一起切换**，否则缩略图（旧）和小图标（新）会是两张不同的画。
  - 切换时要同步改 `wf_paradox_weapon.py` 的 MATERIALS，否则下一次暂存会把道具行改回去。也可以由 PARADOX 线直接用本目录的 c3 覆盖它的源图。
- 五重旧的 5 个子纹理和两件 PARADOX 借用的子纹理不删，保留成孤儿（§6.6）。
- 顺序照 §6.6：E1 先发图集 png 和 atlas（同一条边），E2 再改道具行 c3/c4。反过来会先报 C8004。

## 取材

- 成品里没有 AI 生成的像素。
- 只有五王心核在定构图时用 RetroDiffusion rd_fast 试过一次（64px×4 张，$0.069），参考了「核心被外座托住」的构图，没有采用任何像素。
- 母本都取自 live store 的官方 `item/sprite_sheet`，逐张写在 `build_icons.py` 各项的 `mother` 字段里。
- 禁忌星铁的像素格由 ★4 星铁钢逐色映射而来，再手修出星纹和禁纹。
