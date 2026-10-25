# iOS R11 累计整合基线登记（2026-10-25）

装备修复与 R11 累计整合公网 IPA 登记为 `accepted_offline`，作为后续 iOS 开发的直接输入。包为 ARM64 未签名 IPA；未执行 iOS 原生代码、真机测试、重签安装、公网登录或云端部署。当前没有同功能内网变体，需要内网版时从本基线转换。

## 成品身份

| 项目 | 登记值 |
| --- | --- |
| IPA | `F:/codex/outputs/ios-r11-cumulative-compact-20261025/StarPoint-iOS-1.8.4-equipment-r11-compact-20261025-unsigned.ipa` |
| IPA SHA-256 | `339e19ca373284ed778dd3fcda5ee2aa2e93915f550add733629de5bd989c33b` |
| 字节数 | 171418786 |
| 原生程序 SHA-256 | `bcdf74c7f37aa22e4caa4f0abd1891947c70098467b0756413bd26f12c0a9ee1` |
| 主 SWF SHA-256 | `aef2b7b5d1a9ac48e3ec1e2ded06143515b9063e489b74e97f993e840b0b0c5a` |
| 完整 ABC SHA-256 | `ff1ac16421ed0d394b70612aed23584e30c0aa9ec1de0eebe4336cc1cb396388` |
| 完整 ABC SHA-1 / AOT 摘要 | `a2871566a3b18a8e7528b49534832d131289707f` |
| Bundle / 版本 / Build | `com.kulo.wf` / `1.8.4` / `1.8.46` |
| 架构 / AOT 方法数 | ARM64 / 101598 |
| 公网 origin | `http://124.222.203.221`，沿用既有配置 |
| iOS 准入 ID | `ios-184-pr43-compat-public-20261017`，沿用既有配对 |

配套完整 ABC 位于同一输出目录，文件名为 `ios-full-equipment-r11-compact-20261025.abc`。它与最终 IPA 的 AOT 摘要配对，不能用 stripped runtime ABC 替代。此登记不推进准入号、不重交准入配置；密钥与完整配对配置继续私有维护。

## 累计内容与源码入口

从 [10-17 PR43 iOS 基线](ACCEPTANCE-PR43-IOS-COMPAT-20261017.md)接续，先修复装备预载的局部槽转换、强类型调用桥与原生入口，再移植 Android R11 的内容运营、历史入口、时间栏、兑换请求身份、个人“一览”历史日期和主城外观控制。

最终从装备修复载体一次链接运营、个人资料和主城三批最终方法；新追加区只保留一份最终运行 ABC 与方法标记，不裁剪用途未确认的旧程序区，也不删除游戏资源。

| 来源范围 | 方法与工具 |
| --- | --- |
| 装备转换器、编译桥及稀疏原生计划 | [装备生成器修复](author-merge-20261001/ios/README.md) |
| 装备原生载体、重定位及展开信息 | [装备载体与增量链接](equipment-ios-repair/README.md) |
| 内容运营、历史入口、时间和兑换 | [R11 运营移植](content-operations-ios/README.md) |
| 个人历史及主城外观 | [个人资料与主城移植](profile-town-ios/README.md) |
| 最终累计构建、封包和独立回读 | [累计整合配方](ios-r11-port/CUMULATIVE-COMPACT.md)、[分阶段流程](ios-r11-port/README.md) |

完整旧登记嵌套保存在 [ios-accepted.json](ios-accepted.json) 的 `lineage.previous_ios_baseline_registration`，原日期、验收范围及更早历史保持。旧 IPA、原分阶段累计包和原始参考资料继续保留作追溯输入；它们不再是默认开发基线。保留 PR43 及此前平台累计功能、iOS 标题和编队差异，Android 专属标题隐藏、切队修复、R4 加载实现及离屏生命周期 guard 不纳入。

私有源码阅读与复现入口为 `F:/codex/references/starpoint-cn/client-source/ios-r11-compact-candidate-20261025/`；该资料含原生映射与固定来源，不是完整可重编工程，也不替代登记载荷。提交范围为补丁工具、方法说明与登记，不包括私有反编译资料、IPA、ABC 或密钥。

## 离线证据与限制

复用与本次成品哈希一致的独立回读证据：

- 129 个既有 R11 方法与 102 个辅助方法，共 231 个原生函数；6368 处重定位、18 个 ADDEND 元数据项、8 个内联 switch 函数及逐方法对象来源已检查。
- 完整 ABC、运行 ABC、主 SWF、方法标记和 activation 语义与原完整累计包一致。装备载体的 19 个代码块、9 项补丁及旧代码/表指针保留。
- 除主程序与主 SWF 外，3566 个成员的压缩字节保持一致；ZIP 成员、CRC、应用身份及元数据回读通过。
- dyld 重定位、EH/展开信息、函数起点、符号节索引、签名尾部与 TrollStore ldid 裁剪边界通过；覆盖六种替换签名尺寸模型。这不等于已重签或可在设备上启动。
- 既有构建器 13 项、独立验证器 9 项检查记录通过；累计整合的行为输入未变，沿用各移植批次的有界 AIR 证据。AIR 执行与离线原生核对不能代替 iOS 原生执行。
- 相较原完整累计包，IPA 减少 4216764 字节（约 2.40%），未压缩主程序减少 13115568 字节。未测设备内存、启动速度或长期稳定性，也没有确认或修复启动闪退根因。

证据位于 `F:/codex/outputs/ios-r11-cumulative-compact-20261025/` 下的 `RESULT.json`、`independent-verification.json`、`independent-verification-stage.json` 与 `linked/link-report.json`。构建回执保留生成时的候选状态和 `accepted_registry_updated=false`；本登记单独记录后续基线选择，不改写原回执。当前身份检查使用 [verify_ios_baseline.py](verify_ios_baseline.py)，沿用 schema 6。

本次登记不修改存档结构、库存 ID、玩家进度、服务器、CDN、运行准入配置或设备数据。相关功能仍依赖对应服务端与资源；公网准入 HTTP、实际游戏登录和云端部署未验证。
