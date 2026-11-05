# 星见镇的摇曳 · 卡池页面片段

`gacha_feature_content.990006.json` 是外层键 `990006` 的合并片段。作者 test-server 提交 `6b405811795cbd6e4fddf83f0bfbbfb81d720893` 的已跟踪源表只有第 1 页封面，片段保留该行，并新增 6 个原生技能页与 6 个角色海报页。作者 main 提交 `440a5c964ea82f1fb7bc05dc11dbbd0bb928309b` 尚无此池。片段应随原卡池进入接入分支。

## 合并与绑定

1. 对照 `FEATURE-BINDINGS.json` 的基线，从接入分支取最新 `assets/cdndata/gacha_feature_content.json`。只合并外层键 `990006`，现有第 1 页须与片段一致。如同池已新增其他页面，先逐行合并冲突。其他外层键保持原样。
2. 对客户端资源，使用同一接入基线有效的 `master/gacha/gacha_feature_content.orderedmap`，把 `990006` 编为内层数字键 1 到 13 的 orderedmap。每个内层键对应一个九字段 CSV 行。回读顺序、字段与片段相等，并核实其余外层键保持原字节。
3. 页面顺序为封面，随后每人依次显示原生技能与海报。角色顺序与 test-server 的五星推荐顺序一致。技能页 `kind=2` 的选择器为 `1`，使用配套的 `skill_preview_gacha_starview_sway_<roleId>` 键。电影页 `kind=0` 使用字段中的 Movie 逻辑名。九字段形状和两种页面的搭配可对照该分支官方池 1534、1574 的既有行。
4. 选池横幅继续使用卡池现有第 4 字段 `dynamic/gacha_list_banner/cnmod_starview_sway`，资源逻辑名为同路径加 `.png`。按资源清单接入新图即可。卡池规则和票券配置由原池提供。

## 回读与来源

13 个内层行已在内存中编码并逐字段读回。七套 Movie 所需的 28 个资源和一张横幅均已核对实物大小与 SHA-256。配套技能页来自同批的独立场景片段。作者 test-server 的 manifest 将生效的旧卡池页面表和选池横幅定位到 1.4.367。此次核查读回了已跟踪的源 JSON 和 manifest，生效 ZIP 未随工作树提供，编译后整表需在接入侧按实际资源链读回。

海报和封面的角色立绘引用该卡池作者资源链中的既有角色素材。此说明仅记录出处，素材原有权利和许可条件由相应权利方决定。
