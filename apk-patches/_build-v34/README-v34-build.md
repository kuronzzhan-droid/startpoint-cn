# 测试服 v34-x86：双 ABI 主交付，ARM 备用

主交付为 **v34-x86**，从核对过的 v33-x86 APK 直接替换 v34 SWF，并将 versionCode 升至 **1008002**；ARM 备用从核对过的 v33 APK 生成。两份均未签名、已 zipalign，包名为 **com.leiting.wt**。

## 产物与哈希

| 用途 | 文件 | ABI 目录 | versionCode | SHA-256 |
|---|---|---|---:|---|
| 主交付 | [v34-x86-unsigned-aligned.apk](v34-x86-unsigned-aligned.apk) | arm64-v8a + x86_64 | 1008002 | `41e20a07d0d87e7f89ef0973b230ed2b041eb8a40e7f5240999660b08b9acce7` |
| 备用 | [v34-arm64-unsigned-aligned.apk](v34-arm64-unsigned-aligned.apk) | arm64-v8a | 1008002 | `b6d64900b51fd35b6f3164d73a184b3e47d7202e4c291df056752fdeb31cfa8b` |
| 共用 SWF | [v34.swf](v34.swf) | 共用 | — | `3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a` |

输入 ARM APK SHA-256：`3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532`。输入 v33-x86 APK SHA-256：`572dd17256de6708b9cdcbe752e184a97b44781bce8fd5ffacf7be7413e0c331`。两输入主 SWF 均为 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4`，每次重跑在写包前重新核对。

## 版本与身份究竟改了哪里

两份 AndroidManifest.xml 只改 `manifest/@android:versionCode` 的 typed integer data 槽：**1008001 → 1008002**，槽绝对偏移 **10976**，四字节 `81610f00 → 82610f00`，实际只有该偏移的一个字节变化。槽外 raw bytes 完全相同；aapt2 独立回读版本通过。

`versionName` 保留 **1.8.1**；`assets/META-INF/AIR/application.xml` **0 处修改**，其中 AIR id、versionNumber/versionLabel 均保留。resources.arsc、包名、AIR 身份、服务端地址和准入沿用各自基包。这里的 v34 是交付标签，没有用版本名改动触发 AIR 身份变化。

APK 唯一载荷变化为 **AndroidManifest.xml 与主 SWF**，旧签名条目及 APK 签名块移除。全部 DEX、native 库、ANE XML 和平台资源的成员载荷及压缩类型原样保留。主包保留两个 ABI 目录各 15 库，13 个 ANE Android-x64 平台的 1,938 个成员；备用保留原 ARM 目录。个别原 lib/arm64-v8a 目录成员的 ELF 架构已有例外，本次按原字节保留，ABI 清单按目录统计。证据见 [输入审计](audits/x86-input-audit.md)、[x86 输出验证](verification/apk-x86-verification.json)、[ARM 输出验证](verification/apk-arm64-verification.json)。

## R4 SWF 与原补丁保留

当前带入 6 个 R4 模块：编队动画存活、编队刷新、网络独立超时预算、数据优化（含角色徽标延迟求值）、资源优化、UI 优化。47 个唯一目标方法、5 helper ABC／102 个新方法体；42 个直接应用、5 个合成、0 个缺失依赖项。

五个合成方法为 PartyCarousel/update、CharacterTable/applyCharacters、CharacterTable/updateCells、CharacterTableView/present、CharacterTableView/applyPatch。保留 v33 current-only、线性排序、屏外省帧与无效日志求值跳过，并补入 R4 完成敏感动画与增量绑定语义。详见 [中文合成审计](audits/overlap-audit.md) 与 [最终 P-code](final-pcode/manifest.json)。全部为单方法 P-code 拼接，没有整类反编译回编替换。

已验证的 R4 基线中，原 96,733 个方法体有 96,686 个 raw 记录逐字节保留，变化集合精确等于 47 个 R4 目标；独立 FFDec 对照通过。611 个原归档方法中 606 个完整 body 相同、5 个合成。追加启用项共 5 项，另见 build-report.json 的逐阶段校验。此前 ARM 范围报告中的 #97–100「不适用」只说明首轮 ARM 输入；现在主包直接保留 x86 输入中这四项的全部 native/ANE 成员，见新版 APK 验证。

StartupCache 原生 R4 改动仍未带入：wf 包名双守卫对 wt 不生效，输入也没有其 Periodic 路径；DEX 均保留原样，见 [原生审计](audits/native-audit.md)。

## O8–O12 r2：仅可超限角色启用悖论之核逻辑

本轮使用 r2 共享 `v34_patches.py`，SHA-256 `4a67d7aefeee19eadbd344c9f07af7cc089b154135d287ea35acad8611613497`。外来原编号 102–105 对应本目录 [108–111](apk-patches-additions/README.md)，首发均为 v34；109/110/111 修订为 r2，108/O8 方法体不变，只同步共享来源。旧源与旧归档保留在 previous-build/round5-sources/，外来目录始终只读。**旧 r1 O9–O12 已废弃，当前构建只使用 r2。**

r1 只判断五星且突破步数≥4，误把不能超限的普通五星也当成超限角色。r2 在 O9、O10、O11、O12 四个方法中统一增加 **`get_maxOverLimitStep() > 4`**；完整条件为 `rarity==5 && overLimitStep>=4 && get_maxOverLimitStep()>4`。最大步数≤4 的角色走原路径：不额外加核心槽、不拼核心文案、不因缺核心额外锁按钮；已达原上限时按钮仍按原规则置灰。

| 补丁 | 唯一目标方法 | 行为 |
|---|---|---|
| [O8 / 108](apk-patches-additions/108-overlimit-owned-pedestal/README.md) | PixelArtCharacter/getPedestalImagePath | 持有角色按本账号突破阶段显示台座，空 player／未持有仍走原分支 |
| [O9 / 109 r2](apk-patches-additions/109-overlimit-paradox-core-gate/README.md) | OverLimitWindow/getOverLimitState | 仅可超限模式核不足时禁止确认 |
| [O10 / 110 r2](apk-patches-additions/110-overlimit-two-cost-slots/README.md) | OverLimitWindow/run | 仅可超限模式追加核心格，并注册道具详情按钮 |
| [O11 / 110 r2](apk-patches-additions/110-overlimit-two-cost-slots/README.md) | OverLimitWindow/getStatusInformation | 仅可超限模式显示两格，各显示持有数，0 个置灰 |
| [O12 / 111 r2](apk-patches-additions/111-overlimit-dialog-paradox-text/README.md) | ExpodOverLimitByItemDialog/getDescription | 仅可超限模式将道具名拼为「超限结晶＋悖论之核」 |

O12 在满足上述完整条件时，从道具表读取核心名，与原结晶名及主 ABC 已有全角「＋」拼接；数量与模板沿用原逻辑。数量为 1 时，确认文案为「确定要消耗1个超限结晶＋悖论之核吗？」。普通突破保持原文，不改共享文案键或数据。四个 r2 最终方法体 code SHA-256 独立核对如下：

| 方法 | r2 after SHA-256 |
|---|---|
| O9 | `ae683cc1f5574ac7b415c43cf779ea642535cd6a66531aa1ee51a150d1492068` |
| O10 | `b96160fc0f1046a50cf78065ed8d907861a2a65fb13c4f365abad60cbd4b2a7e` |
| O11 | `c64d19bbf7957fd9490406d4d251abb9d1e16eeb3062e1b49148f56afbd29aa4` |
| O12 | `a0468818a62ad753f0d18a755b29af19c61ebf5c3cd4a145c7a5a8cfc8a8be55` |

R4 的 47 个目标中没有任何 `OverLimitWindow` 或 `ExpodOverLimitByItemDialog` 方法。五个追加方法彼此互异，均与 R4 47 目标、5 个既有合成及原 101 条映射的 611 方法无交集，方法锁全部命中，**无需新增合成**。全部只做单方法 P-code 拼接，不追加常量池、字段或 traits。

O10/O11 仅可超限模式显示两格；普通模式、各自库存、0 灰及原生 `33554432 + itemId` 详情路由保留。突破判定仍由原 101 与 O9 r2 决定。O8 仍按来源设计：别人的同一角色也会按本账号持有角色的突破阶段显示台座。

## 一条命令与正式方案

运行 `python -B scripts/build_v34.py`，从固定 R4 基线按 [patch-list.json](patch-list.json) 顺序应用 O8→O9 r2→O10 r2→O11 r2→O12 r2，生成 `v34.swf` 与两版未签名、zipalign APK，versionCode 均为 **1008002**。当前共用 SWF SHA-256：`3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a`。补丁列表可追加，需导入源码、固定源码及输入/输出哈希、声明目标方法并通过流水线范围检查。

**零消耗方案已取消，O9 与原归档 101 保留。** `--without-O9` 仅作显式历史诊断，使用独立 [配置](patch-list-without-O9.json)，只生成 diagnostics/v34-without-O9.swf；不生成 APK，不改主 SWF／报告／APK，不是候选交付，也不是完整零核版本。默认不生成该变体。凉月觉醒入口属于数据边，本次不改。

## 本轮重新验证

- v33 控制重放得到 `e30172b369db214bb681d135a7a6fc0442ab483c75be9c5225989e231419b4b2`，符合 `e30172b3…`；R4＋O8–O12 r2 得到当前 `3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a`。五项再次应用均 already_present，输出逐字节相同，见 [重放与幂等报告](work/overlimit-round6/source-replay-verification.json)。
- 原 101 条重新核验：611 个归档方法＝606 个完整 body 保留＋5 个既有 R4 合成，零失败。相对 v33 只变 **52** 个目标（R4 47＋O8–O12 5），其余 **96,681** 个原方法记录逐字节相同；5 个 R4 helper／102 个新方法体保留。
- 与固定 R4 相比只变五个追加目标；与第五轮 r1 相比只变 O9–O12，O8 及 R4 所有目标保持原样。类布局、签名、既有常量池及非 ABC tag 保留。独立 FFDec 全量比较及四个 r2 code SHA 锁通过，见 [全 SWF 报告](verification/swf-o8-o12-r2-verification.json) 与 [原 101 报告](verification/v33-patches-preserved-o8-o12-r2.json)。
- **653** 个解码生产字节码用例、**248** 个负例通过，覆盖旧行为、maxStep≤4 普通五星原路径、maxStep>4 可超限分支、数量及道具名，见 [来源审计](audits/round6-source-audit.md) 与 [语义探针](audits/round6-bytecode-probes.json)。类型／主表值使用受控夹具，整体 AIR／Android 设备运行**未核实**。

## 验证、安装与归档

当前 SWF 已追加补丁；历史 9 组／18,615 项证据只绑定不可变 R4 基线，当前追加结果整体 AIR 验证未核实。 实际 SDK 为 51.1.4.1；R4 原 51.2.1.5 未使用，历史 R2/R3 对照未跑。详见 [测试汇总](tests-output/summary.json)。两 APK 的成员、ABI、版本、对齐及无签名检查为本次重新执行。

**Android 安装、完整游戏场景与设备性能未核实。** 本任务不联网，不接触服务器/SSH/禁止目录，不运行模拟器/adb，不安装，不签名或读取 keystore。签名由另一个线程负责；签名后测试需清旧 AIR 提取缓存 cache/app，或清除应用数据／卸载重装，不能只靠升 versionCode 判断新 SWF 已生效。

新增归档草稿 [102–111](apk-patches-additions/README.md) 已更新，109/110/111 为 r2，首发仍为 v34；108/O8 方法体不变。首轮 versionCode 1008001 的 ARM 成品与报告移入 [previous-build/arm64-versionCode1008001](previous-build/arm64-versionCode1008001/)，不作为当前交付。完整输入/输出哈希、版本、ABI 及流水线状态见 [build-report.json](build-report.json)。当前目录非 Git 仓库，未初始化或向外部仓库提交。

本轮完整默认命令已连续运行两次，两 APK 与 SWF 均逐字节相同，见 [重复构建证明](verification/dual-build-repeatability.json)。

两 APK 通过 [独立全成员读回](verification/dual-apk-independent.json)，包括原压缩字节、全部 stored 成员对齐、aapt2 版本与无签名检查。

历史诊断开关 [副作用检查](verification/round6-diagnostic-switch.json) 通过；诊断 SHA-256 `d1591cabb0120036ca133da8125d9717de8db83faba941ca92b55e626d6ad912`，不是候选交付。

第五轮 r1 成品、报告及旧诊断 SWF 保留在 previous-build/round5-o8-o12-r1-versionCode1008002/，旧 O9–O12 不再作为当前交付。
