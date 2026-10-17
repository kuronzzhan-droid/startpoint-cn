# 109 缺悖论之核时禁止确认超限（O9）

目标角色为五星、overLimitStep >= 4 且 get_maxOverLimitStep() > 4、悖论之核 10000302 持有量 <= 0 时，把传入原 getOverLimitState 的突破道具列表置空。原逻辑据此判定道具不足，禁用确认入口，避免零可突破次数被对话框抬成 count=1。只插入单方法 P-code，不追加主 ABC 常量池。

- 首发 APK 版本：**v34**。适用测试包：`com.leiting.wt`。本轮设备验收未核实。
- 编号映射：来源 `103-overlimit-paradox-core-gate` → 本草稿 `109-overlimit-paradox-core-gate`。
- 依赖归档：#84, #101。
- 与 R4 的 47 个目标方法、5 个合成方法及原 101 条的 611 个归档方法均无交集，无须合成；R4 目标中没有任何 OverLimitWindow 或 ExpodOverLimitByItemDialog 方法。
- O8/O9/O10/O11/O12 五个目标方法互不重叠。PartyCarousel.update 不在这些补丁目标中。
- 外来源只读；source 与 before/after P-code 均逐字节复制。每个原始文件路径和 SHA-256 记录在 entry.json。
- 行为边界：作者已取消零消耗方案；本条 109 与原归档 101 均保留。--without-O9 仅为历史诊断开关，不再是候选，也不是完整零核实现。

## 修订 r2（r1 已废弃）

在五星且 overLimitStep >= 4 条件后追加 get_maxOverLimitStep() > 4 能力门控。最大突破次数为 4 的普通五星保持原按钮状态路径。r1 已废弃；首发版本仍为 v34。

本条 after P-code 与共享 source 已替换为 r2；旧 r1 指纹只用于识别已废弃版本。重建必须从精确 v33＋R4 基线应用新版，不能把 r2 脚本直接覆盖到 r1 SWF 上。

## 方法体锁与 P-code

### O9：`OverLimitWindow/getOverLimitState`

主 ABC `boot_ffc6`；body `73067`。
输入 code SHA-256：`d39a4847f5adfd05c660a4bacd1ea2bad9b13bdabe8b72a72927fa9bbca7bc9b`；header `[2, 3, 1, 2]`。
打后 code SHA-256：`ae683cc1f5574ac7b415c43cf779ea642535cd6a66531aa1ee51a150d1492068`；header `[4, 3, 1, 2]`。
[before P-code](pcode/boot_ffc6--OverLimitWindow_getOverLimitState.before.pcode.txt) / [after P-code](pcode/boot_ffc6--OverLimitWindow_getOverLimitState.pcode.txt)。
已废弃 r1 的 after code SHA-256：`28703c0dae17f7d2e4def4b6e5f3cc0b9183ea87dadcf392b4b9aa2f2469a126`，不再作为可交付结果。

## 重放与验证边界

单条源码入口：`python -B source/apply.py IN.swf OUT.swf O9`。共享工具只读依赖仍是 `D:\WF\perf-v30-20261015\tools`；须设置 `PYTHONIOENCODING=utf-8` 和 `PYTHONDONTWRITEBYTECODE=1`。
来源 v34_patches.py 是五个补丁共用的完整定义，四个归档的源码副本一致；单条回放必须显式选择上面的补丁 ID。
本任务重建优先使用根入口 `python -B scripts/build_v34.py`，经 scripts/overlimit_runner.py 加载本目录 incoming 下已锁定的来源副本与共享依赖，避免来源 apply.py 的外部路径假设。来源原文脚本仍逐字节保存，归档自身不是免依赖包。
脚本先核对 before/after 方法指纹，已打则跳过，未知方法体拒绝；不做整类反编译回编。
本轮实际产物哈希和静态保留证明见 [build-report.json](../../build-report.json)。最终方法实测：已核对实际最终 SWF。
[来源 README 原文](provenance/upstream-README.md) 保留来源线程的历史自测/真机陈述，不代表本轮验证。本轮仅离线，没有运行模拟器、adb、游戏或服务器；运行表现未核实。
