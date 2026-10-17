# 110 超限窗口显示超限结晶与悖论之核两个消耗框（O10/O11）

两个方法取回本次新建的 getAwakingCrystalToOverLimit() 数组后，目标角色为五星、overLimitStep >= 4 且 get_maxOverLimitStep() > 4 时追加悖论之核 10000302。run 注册第二格的道具详情按钮；getStatusInformation 提供第二格持有量与显示数据。原生两格布局与按钮 33554432+itemId 分支继续使用；两种道具各显示持有数，0 个灰掉。只插入单方法 P-code，不追加主 ABC 常量池。

- 首发 APK 版本：**v34**。适用测试包：`com.leiting.wt`。本轮设备验收未核实。
- 编号映射：来源 `104-overlimit-two-cost-slots` → 本草稿 `110-overlimit-two-cost-slots`。
- 依赖归档：#78, #101, #109。
- 与 R4 的 47 个目标方法、5 个合成方法及原 101 条的 611 个归档方法均无交集，无须合成；R4 目标中没有任何 OverLimitWindow 或 ExpodOverLimitByItemDialog 方法。
- O8/O9/O10/O11/O12 五个目标方法互不重叠。PartyCarousel.update 不在这些补丁目标中。
- 外来源只读；source 与 before/after P-code 均逐字节复制。每个原始文件路径和 SHA-256 记录在 entry.json。
- 行为边界：本条只改变显示与道具详情按钮注册。突破可否和可选次数仍由 101/109 决定；服务端扣除规则属于外部来源说明，本轮没有访问或验证服务器。

## 修订 r2（r1 已废弃）

O10/O11 都在五星且 overLimitStep >= 4 条件后追加 get_maxOverLimitStep() > 4。最大突破次数为 4 的普通五星不追加悖论之核格，保留原按钮/显示列表。r1 已废弃；首发版本仍为 v34。

本条 after P-code 与共享 source 已替换为 r2；旧 r1 指纹只用于识别已废弃版本。重建必须从精确 v33＋R4 基线应用新版，不能把 r2 脚本直接覆盖到 r1 SWF 上。

## 方法体锁与 P-code

### O10：`OverLimitWindow/run`

主 ABC `boot_ffc6`；body `73055`。
输入 code SHA-256：`2787a647de463c9493d6347076db09a4b4417434174a9394f4e77c7352fbc14a`；header `[11, 12, 1, 2]`。
打后 code SHA-256：`b96160fc0f1046a50cf78065ed8d907861a2a65fb13c4f365abad60cbd4b2a7e`；header `[11, 12, 1, 2]`。
[before P-code](pcode/boot_ffc6--OverLimitWindow_run.before.pcode.txt) / [after P-code](pcode/boot_ffc6--OverLimitWindow_run.pcode.txt)。
已废弃 r1 的 after code SHA-256：`d309b01594bb4e93464b089d9554ec5d5472a2439d1861e14e8c40dcdd4d5493`，不再作为可交付结果。

### O11：`OverLimitWindow/getStatusInformation`

主 ABC `boot_ffc6`；body `73065`。
输入 code SHA-256：`5a3d0744321eb787d738b56df42059611df979f493b0c121fdc239ce491ad83d`；header `[10, 7, 1, 2]`。
打后 code SHA-256：`c64d19bbf7957fd9490406d4d251abb9d1e16eeb3062e1b49148f56afbd29aa4`；header `[10, 7, 1, 2]`。
[before P-code](pcode/boot_ffc6--OverLimitWindow_getStatusInformation.before.pcode.txt) / [after P-code](pcode/boot_ffc6--OverLimitWindow_getStatusInformation.pcode.txt)。
已废弃 r1 的 after code SHA-256：`cf8cca3dcf9d4d27f7b49ce430953321752d9e5ed7b00fdd307954f40bfb8176`，不再作为可交付结果。

## 重放与验证边界

单条源码入口：`python -B source/apply.py IN.swf OUT.swf O10 O11`。共享工具只读依赖仍是 `D:\WF\perf-v30-20261015\tools`；须设置 `PYTHONIOENCODING=utf-8` 和 `PYTHONDONTWRITEBYTECODE=1`。
来源 v34_patches.py 是五个补丁共用的完整定义，四个归档的源码副本一致；单条回放必须显式选择上面的补丁 ID。
本任务重建优先使用根入口 `python -B scripts/build_v34.py`，经 scripts/overlimit_runner.py 加载本目录 incoming 下已锁定的来源副本与共享依赖，避免来源 apply.py 的外部路径假设。来源原文脚本仍逐字节保存，归档自身不是免依赖包。
脚本先核对 before/after 方法指纹，已打则跳过，未知方法体拒绝；不做整类反编译回编。
本轮实际产物哈希和静态保留证明见 [build-report.json](../../build-report.json)。最终方法实测：已核对实际最终 SWF。
[来源 README 原文](provenance/upstream-README.md) 保留来源线程的历史自测/真机陈述，不代表本轮验证。本轮仅离线，没有运行模拟器、adb、游戏或服务器；运行表现未核实。
