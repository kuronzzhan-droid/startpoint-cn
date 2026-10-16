# 五重决战道具图片更新

当前本地测试资源为 **1.4.111**。用户在 1.4.110 实机发现材料栏过小、武器详情溢出；本次按两种界面的实际缩放规则修正。客户端代码、APK 和战斗数据没有改动，未启动 AIR。

| 物品 | 本次替换 |
|---|---|
| 5900101 死亡使者·终式 | 基础与 120 级强化图片、交换所商品图采用 `死亡使者.png` |
| 10000145 深界结晶 | 道具图片及材料栏图集帧采用 `新·深界结晶.png` |
| 10000147 五王心核 | 道具图片及材料栏图集帧采用 `五王心核.png` |
| 10000143 深界连战凭证 | 交换所商品图片改为现用 `entry_ticket_v2`，对应 `新·深界连战凭证.png` |

道具和商店缩略图保持原始 **20×20**。`ItemThumbnailView` 固定放大 6 倍，20px 显示为 120px，可装入 168px 框；上一版武器提前放大到 40px 后显示为 240px，因而越框。本次基础、120 级武器都直接使用原图，并为两个详情图和商店图补入完整 `0,0,20,20` 纹理框。

材料栏直接使用图集原尺寸。结晶、心核各新增独立 **40×40** 小图，使用 nearest 整数二倍放大；道具表仅改 10000145、10000147 的第 4 列，指向 `item_icon/materials/mod/five_boss/deep_crystal_v2`、`five_king_core_v2`。有效 `item_icon` 图集追加两帧，原有 76 帧和旧像素不变。`item` 图集、20px 道具缩略图及商店商品图保持 1.4.110 内容。

原图归档在 `assets/asset-patch/artwork/five-boss/20260910/`，用户原图没有改写。`update_five_boss_item_art.py` 统一调用 `five_boss_art_contract.py`，分别生成 20px 缩略图和 40px 材料小图，检查实际显示大小、纹理框、图集预加载、PNG 签名和版本连续性。对修正后的资源再次生成时无变化，不能恢复旧尺寸。商品生成数据的门票引用仍保持上一版修正。

后续重 roll 从本地实际运行链读取资源；源仓库根 manifest 仍是另有用途的暂存链，不能拿它覆盖本地测试链。当前投影见 `assets/asset-patch/audit/five-boss-item-art-1.4.111-test/manifest.json`。更新应追加新版本，不能改写已发布 ZIP。

验证完成：六项实际资源回归（旧材料尺寸、超大武器、遗漏纹理框、最终尺寸、重复生成、错误版本依赖）；五种材料逐一删除图块的反向检查；317 个累计资源摘要；六个 Android/iOS 起始版本组合；21 个实际 HTTP 资源读取。新 ZIP 的 8 个资源与磁盘、实际下载入口逐字节一致，5 张 PNG 严格解码成功。实机显示待用户再次验收。

上一版工具还把图集循环变量写进了 1.4.110 的 `depends_on`。本次仅将该 manifest 字段纠正为 `1.4.109`，旧 ZIP 不变；新版本正确承接 `1.4.110`。新增全链连续性校验可拒绝这类错误。上一版已对齐的武器散文件索引保持原样。

本地服务沿用输入 APK 配套的内网地址运行。返回客户端标题页下载至 **1.4.111**，检查五重关卡及商店材料栏、死亡使者详情与两个商品。无需重装 APK。

当前分支 `staging`，HEAD 和 `origin/staging` 均为 `8f6252bb31c7f18a8cb61f11fa699282e68ebc4b`。本次内容保持未提交，未推送、未合并 main、未创建云端整合包。其他已有修改和根 manifest 暂存文件保留。

本次备份：`F:/startpoint-cn-main/.codex-backups/20260910-205430-five-boss-item-art/`。精确同步路径和摘要见 `assets/asset-patch/audit/five-boss-item-art-1.4.111-test/local-sync-report.json`：共 10 个运行文件，即新 ZIP、8 个散资源和最后写入的 manifest。工具与技能的修正前快照在 `F:/codex/work/five-boss-icon-size-20260910/`。

审计目录另含 `report.json`、`local-http-verification.json` 和 `resource-inventory.json`。当前补丁源文件为 `assets/asset-patch/active/candidates/pinball-1.4.110-1.4.111-1-five-boss-item-art-test.zip`；准确摘要见 `report.json`。
