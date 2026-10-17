# 111 超限确认框文案包含悖论之核（O12）

目标角色为五星、overLimitStep >= 4 且 get_maxOverLimitStep() > 4 时，在原超限结晶 itemName 后拼接主 ABC 已有字符串「＋」与 globalLogic.getItem(10000302).get_name() 返回的悖论之核名称。只改变本次确认框模板的 itemName 参数，不改公共文案数据；普通突破保留原路径。只插入单方法 P-code，不追加主 ABC 常量池。

- 首发 APK 版本：**v34**。适用测试包：`com.leiting.wt`。本轮设备验收未核实。
- 编号映射：来源 `105-overlimit-dialog-paradox-text` → 本草稿 `111-overlimit-dialog-paradox-text`。
- 依赖归档：无硬依赖。
- 与 R4 的 47 个目标方法、5 个合成方法及原 101 条的 611 个归档方法均无交集，无须合成；R4 目标中没有任何 OverLimitWindow 或 ExpodOverLimitByItemDialog 方法。
- O8/O9/O10/O11/O12 五个目标方法互不重叠。PartyCarousel.update 不在这些补丁目标中。
- 外来源只读；source 与 before/after P-code 均逐字节复制。每个原始文件路径和 SHA-256 记录在 entry.json。
- 行为边界：本条只改确认框显示文字，不改消耗数量、可否突破或服务端规则；与 101/109/110 配套。作者已取消零消耗方案，本条随双消耗方案保留；设备显示效果未核实。

## 修订 r2（r1 已废弃）

在五星且 overLimitStep >= 4 条件后追加 get_maxOverLimitStep() > 4。最大突破次数为 4 的普通五星不查询/拼接悖论之核名称，保留原文案。r1 已废弃；首发版本仍为 v34。

本条 after P-code 与共享 source 已替换为 r2；旧 r1 指纹只用于识别已废弃版本。重建必须从精确 v33＋R4 基线应用新版，不能把 r2 脚本直接覆盖到 r1 SWF 上。

## 方法体锁与 P-code

### O12：`ExpodOverLimitByItemDialog/getDescription`

主 ABC `boot_ffc6`；body `33543`。
输入 code SHA-256：`479e1323bda6560e5033a2f4d303e2932412d19c39b340844ecfb9a2d46fbbec`；header `[6, 2, 1, 2]`。
打后 code SHA-256：`a0468818a62ad753f0d18a755b29af19c61ebf5c3cd4a145c7a5a8cfc8a8be55`；header `[9, 2, 1, 2]`。
[before P-code](pcode/boot_ffc6--ExpodOverLimitByItemDialog_getDescription.before.pcode.txt) / [after P-code](pcode/boot_ffc6--ExpodOverLimitByItemDialog_getDescription.pcode.txt)。
已废弃 r1 的 after code SHA-256：`6e55a92902831e873f57f66e6725e751266466e45d903bad58a648ef409921fc`，不再作为可交付结果。

## 重放与验证边界

单条源码入口：`python -B source/apply.py IN.swf OUT.swf O12`。共享工具只读依赖仍是 `D:\WF\perf-v30-20261015\tools`；须设置 `PYTHONIOENCODING=utf-8` 和 `PYTHONDONTWRITEBYTECODE=1`。
来源 v34_patches.py 是五个补丁共用的完整定义，四个归档的源码副本一致；单条回放必须显式选择上面的补丁 ID。
本任务重建优先使用根入口 `python -B scripts/build_v34.py`，经 scripts/overlimit_runner.py 加载本目录 incoming 下已锁定的来源副本与共享依赖，避免来源 apply.py 的外部路径假设。来源原文脚本仍逐字节保存，归档自身不是免依赖包。
脚本先核对 before/after 方法指纹，已打则跳过，未知方法体拒绝；不做整类反编译回编。
本轮实际产物哈希和静态保留证明见 [build-report.json](../../build-report.json)。最终方法实测：已核对实际最终 SWF。
[来源 README 原文](provenance/upstream-README.md) 保留来源线程的历史自测/真机陈述，不代表本轮验证。本轮仅离线，没有运行模拟器、adb、游戏或服务器；运行表现未核实。
