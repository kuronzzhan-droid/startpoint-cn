# v34 新增补丁归档草稿（102 起）

本目录供后续并入 D:\WF\apkp1016\apk-patches；未修改原归档。编号 102–107 对应 liveness、refresh、network、data、resource、ui，48 个模块方法条目涉及 47 个唯一原方法，另新增 5 个 helper ABC。

组合顺序为 102→103→104→105→106→107。#103 与 #105 共用 PartyTranslator.translate；与旧 #18/#62/#63/#67 的 5 个方法采用保留 v33 语义的合成。各条 entry.json 记录方法、输入指纹、来源、源码哈希及最终 P-code 状态。

本目录只有文本；不含 APK/SWF/ABC/SWC、native 二进制、keystore、签名或 APK 构建脚本。源码仍保留原路径依赖，复现应使用任务根脚本和完整共享工具链。

最终哈希与验证见 ../build-report.json；上游历史测试数不得当作本次验证。未做 Android 设备验收。

## 本轮新增 108 / 109 / 110 / 111

原 102–107 继续保留，之后按 108→109→110→111 应用；新增后共 52 个唯一既有方法、53 个模块方法条目，helper ABC 仍是 5 个。

当前 109–111 为 **revision r2，r1 已废弃**，首发版本仍为 v34：O9–O12 的生效条件均为五星、overLimitStep ≥4 且 get_maxOverLimitStep()>4。最大突破次数为4的普通五星保留原按钮、列表与文案；仅真正可超限角色触发新增逻辑。108/O8 的方法体不变，仅刷新共享 r2 来源。

- [108：持有角色超限台座（O8）](108-overlimit-owned-pedestal/README.md)，来源原编号 102，首发 v34。
- [109：缺悖论之核禁止确认超限（O9）](109-overlimit-paradox-core-gate/README.md)，来源原编号 103，首发 v34。
- [110：超限窗口两个消耗框（O10/O11）](110-overlimit-two-cost-slots/README.md)，来源原编号 104，首发 v34。
- [111：超限确认框文案包含悖论之核（O12）](111-overlimit-dialog-paradox-text/README.md)，来源原编号 105，首发 v34。

五个目标只改 boot_ffc6 的 body 87354 / 73067 / 73055 / 73065 / 33543，不碰 PartyCarousel.update；与旧 101 条的 611 个归档方法、R4 47 目标及 5 合成方法均无交集。R4 目标没有任何 OverLimitWindow 或 ExpodOverLimitByItemDialog 方法。来源 README 原文、原始路径、文件哈希及精确副本在各条 provenance/source/pcode 与 entry.json。四个条目的 source/v34_patches.py 均为同一份最新共享定义；只应用单条时必须选择补丁 ID。

作者已取消零消耗方案，109/O9 与旧归档 101 保留；`--without-O9` 只保留为历史诊断开关，不再是候选，也不是完整零核版本。凉月觉醒入口属于数据边，本轮没有 APK 补丁。

本轮新增验证只声明离线结果。来源线程的真机自测不是本轮重跑，当前设备运行未核实。
