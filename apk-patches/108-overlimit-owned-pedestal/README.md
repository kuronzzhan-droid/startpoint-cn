# 108 像素小人改用持有角色的超限台座（O8）

玩家持有角色且 player 非空时，把已取得的 GeneralCharacterLogic 换为 player.getOwnedCharacter(id)，让原有全身/半身台座虚调用使用持有角色的突破阶段。未持有、player 为空或 character 为 None 的原路径保留。只插入单方法 P-code，不追加主 ABC 常量池。

- 首发 APK 版本：**v34**。适用测试包：`com.leiting.wt`。本轮设备验收未核实。
- 编号映射：来源 `102-overlimit-owned-pedestal` → 本草稿 `108-overlimit-owned-pedestal`。
- 依赖归档：#80, #81, #86。
- 与 R4 的 47 个目标方法、5 个合成方法及原 101 条的 611 个归档方法均无交集，无须合成；R4 目标中没有任何 OverLimitWindow 或 ExpodOverLimitByItemDialog 方法。
- O8/O9/O10/O11/O12 五个目标方法互不重叠。PartyCarousel.update 不在这些补丁目标中。
- 外来源只读；source 与 before/after P-code 均逐字节复制。每个原始文件路径和 SHA-256 记录在 entry.json。
- 行为边界：联机房间、排行榜里的同一角色也按玩家自己的持有角色突破状态显示；这是来源补丁明确列出的行为。

本条共享来源更新为 r2；O8 方法逻辑、before/after 指纹均未变化。

## 方法体锁与 P-code

### O8：`PixelArtCharacter/getPedestalImagePath`

主 ABC `boot_ffc6`；body `87354`。
输入 code SHA-256：`7a286e705e1416d02a1d9dcbb811f80d238fe48976b8b1b0ab4cbb54888330ed`；header `[3, 4, 1, 2]`。
打后 code SHA-256：`10eb1e21f915782bcd5715a3fb58670cb18737ae8a5f0f569781f774b1a48f0d`；header `[3, 5, 1, 2]`。
[before P-code](pcode/boot_ffc6--PixelArtCharacter_getPedestalImagePath.before.pcode.txt) / [after P-code](pcode/boot_ffc6--PixelArtCharacter_getPedestalImagePath.pcode.txt)。

## 重放与验证边界

单条源码入口：`python -B source/apply.py IN.swf OUT.swf O8`。共享工具只读依赖仍是 `D:\WF\perf-v30-20261015\tools`；须设置 `PYTHONIOENCODING=utf-8` 和 `PYTHONDONTWRITEBYTECODE=1`。
来源 v34_patches.py 是五个补丁共用的完整定义，四个归档的源码副本一致；单条回放必须显式选择上面的补丁 ID。
本任务重建优先使用根入口 `python -B scripts/build_v34.py`，经 scripts/overlimit_runner.py 加载本目录 incoming 下已锁定的来源副本与共享依赖，避免来源 apply.py 的外部路径假设。来源原文脚本仍逐字节保存，归档自身不是免依赖包。
脚本先核对 before/after 方法指纹，已打则跳过，未知方法体拒绝；不做整类反编译回编。
本轮实际产物哈希和静态保留证明见 [build-report.json](../../build-report.json)。最终方法实测：已核对实际最终 SWF。
[来源 README 原文](provenance/upstream-README.md) 保留来源线程的历史自测/真机陈述，不代表本轮验证。本轮仅离线，没有运行模拟器、adb、游戏或服务器；运行表现未核实。
